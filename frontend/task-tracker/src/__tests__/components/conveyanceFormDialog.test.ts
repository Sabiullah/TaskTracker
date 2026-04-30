/**
 * Pure-logic tests for ConveyanceFormDialog helpers.
 *
 * No React Testing Library — imports only the exported pure functions.
 * The test environment is "node" (vitest.config / vite.config), so no DOM
 * globals are needed here.
 */

import { describe, expect, it } from "vitest";

import {
  buildCreateFormData,
  validateFormInputs,
} from "@/components/conveyance/conveyanceFormHelpers";
import type { ConveyanceFrequency } from "@/types/api/conveyance";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(name: string, sizeBytes: number): File {
  // File constructor: (parts, filename, options)
  // Vitest runs in Node so File is available from the globals polyfill via
  // vite's test environment — if not, we fall back to Blob cast.
  const content = new Uint8Array(sizeBytes);
  return new File([content], name, { type: "application/octet-stream" });
}

// ---------------------------------------------------------------------------
// validateFormInputs
// ---------------------------------------------------------------------------

describe("validateFormInputs", () => {
  const base = {
    reason: "fuel for client visit",
    amount: "150",
    client: "client-uid-abc",
    org: "org-uid-abc",
    files: [],
  };

  it("returns ok:true for a fully valid input with no files", () => {
    const result = validateFormInputs(base);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns ok:false when reason is fewer than 3 chars", () => {
    const result = validateFormInputs({ ...base, reason: "ok" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /reason/i.test(e))).toBe(true);
  });

  it("returns ok:false when reason is only whitespace (< 3 trimmed chars)", () => {
    const result = validateFormInputs({ ...base, reason: "   " });
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when amount is 0", () => {
    const result = validateFormInputs({ ...base, amount: "0" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /amount/i.test(e))).toBe(true);
  });

  it("returns ok:false when amount is negative", () => {
    const result = validateFormInputs({ ...base, amount: "-5" });
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when amount is not a number", () => {
    const result = validateFormInputs({ ...base, amount: "abc" });
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when client is empty string", () => {
    const result = validateFormInputs({ ...base, client: "" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /client/i.test(e))).toBe(true);
  });

  it("returns ok:false when any file exceeds 20 MB", () => {
    const bigFile = makeFile("receipt.pdf", 21 * 1024 * 1024);
    const result = validateFormInputs({
      ...base,
      files: [{ file: bigFile }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /20 MB/i.test(e))).toBe(true);
  });

  it("returns ok:true when file is exactly 20 MB", () => {
    const edgeFile = makeFile("edge.pdf", 20 * 1024 * 1024);
    const result = validateFormInputs({
      ...base,
      files: [{ file: edgeFile }],
    });
    expect(result.ok).toBe(true);
  });

  it("accumulates errors for multiple failures", () => {
    const result = validateFormInputs({
      reason: "x",
      amount: "0",
      client: "",
      org: "",
      files: [{ file: makeFile("big.pdf", 21 * 1024 * 1024) }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  it("returns ok:false when org is empty string", () => {
    const result = validateFormInputs({ ...base, org: "" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /organisation/i.test(e))).toBe(true);
  });

  it("returns ok:true when org is provided alongside a valid payload", () => {
    const result = validateFormInputs({ ...base, org: "org-uid-123" });
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildCreateFormData
// ---------------------------------------------------------------------------

describe("buildCreateFormData", () => {
  const baseInput = {
    date: "2026-04-23",
    client: "client-uid-xyz",
    reason: "  fuel expenses  ",
    amount: "250.50",
    claimable: true,
    files: [] as { file: File; label: string }[],
  };

  it("packs the 5 core fields correctly", () => {
    const fd = buildCreateFormData(baseInput);
    expect(fd.get("date")).toBe("2026-04-23");
    expect(fd.get("client")).toBe("client-uid-xyz");
    // reason should be trimmed
    expect(fd.get("reason")).toBe("fuel expenses");
    expect(fd.get("amount")).toBe("250.50");
    expect(fd.get("claimable")).toBe("true");
  });

  it("serialises claimable=false as the string 'false'", () => {
    const fd = buildCreateFormData({ ...baseInput, claimable: false });
    expect(fd.get("claimable")).toBe("false");
  });

  it("appends attachments and attachment_labels in order for two files", () => {
    const f1 = makeFile("bill1.jpg", 100);
    const f2 = makeFile("bill2.jpg", 200);
    const fd = buildCreateFormData({
      ...baseInput,
      files: [
        { file: f1, label: "Breakfast" },
        { file: f2, label: "Lunch" },
      ],
    });

    const attachments = fd.getAll("attachments");
    const labels = fd.getAll("attachment_labels");

    expect(attachments).toHaveLength(2);
    expect(labels).toHaveLength(2);
    expect((attachments[0] as File).name).toBe("bill1.jpg");
    expect((attachments[1] as File).name).toBe("bill2.jpg");
    expect(labels[0]).toBe("Breakfast");
    expect(labels[1]).toBe("Lunch");
  });

  it("with 3 files and 1 explicit label, attachment_labels still has 3 entries (remaining are empty strings)", () => {
    const f1 = makeFile("a.jpg", 10);
    const f2 = makeFile("b.jpg", 20);
    const f3 = makeFile("c.jpg", 30);
    const fd = buildCreateFormData({
      ...baseInput,
      files: [
        { file: f1, label: "First label" },
        { file: f2, label: "" },
        { file: f3, label: "" },
      ],
    });

    const labels = fd.getAll("attachment_labels");
    expect(labels).toHaveLength(3);
    expect(labels[0]).toBe("First label");
    expect(labels[1]).toBe("");
    expect(labels[2]).toBe("");
  });

  it("produces no attachment or attachment_labels entries when files is empty", () => {
    const fd = buildCreateFormData({ ...baseInput, files: [] });
    expect(fd.getAll("attachments")).toHaveLength(0);
    expect(fd.getAll("attachment_labels")).toHaveLength(0);
  });

  it("appends org when provided", () => {
    const fd = buildCreateFormData({ ...baseInput, org: "org-uid-777" });
    expect(fd.get("org")).toBe("org-uid-777");
  });

  it("omits org from the form data when not provided", () => {
    const fd = buildCreateFormData(baseInput);
    expect(fd.has("org")).toBe(false);
  });
});

describe("validateFormInputs — frequency", () => {
  const baseRecurring = {
    reason: "monthly subscription",
    amount: "500",
    client: "client-uid-abc",
    org: "org-uid-abc",
    files: [],
    frequency: "monthly" as ConveyanceFrequency,
    start_month: "2026-01",
    end_month: "2026-12",
  };

  it("ok for a valid recurring window", () => {
    const result = validateFormInputs(baseRecurring);
    expect(result.ok).toBe(true);
  });

  it("flags missing start_month for recurring", () => {
    const result = validateFormInputs({ ...baseRecurring, start_month: "" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /start month/i.test(e))).toBe(true);
  });

  it("flags missing end_month for recurring", () => {
    const result = validateFormInputs({ ...baseRecurring, end_month: "" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /end month/i.test(e))).toBe(true);
  });

  it("rejects end before start", () => {
    const result = validateFormInputs({
      ...baseRecurring,
      start_month: "2026-06",
      end_month: "2026-03",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /on or after/i.test(e))).toBe(true);
  });

  it("ignores start/end for one-time", () => {
    const result = validateFormInputs({
      reason: "fuel",
      amount: "100",
      client: "c",
      org: "o",
      files: [],
      frequency: "one_time" as ConveyanceFrequency,
      start_month: "",
      end_month: "",
    });
    expect(result.ok).toBe(true);
  });
});

describe("buildCreateFormData — frequency", () => {
  it("emits frequency + months for recurring submissions", () => {
    const fd = buildCreateFormData({
      date: "2026-04-30",
      client: "c",
      reason: "subscription",
      amount: "500",
      claimable: true,
      org: "o",
      files: [],
      frequency: "monthly",
      start_month: "2026-01",
      end_month: "2026-12",
    });
    expect(fd.get("frequency")).toBe("monthly");
    expect(fd.get("start_month")).toBe("2026-01-01");
    expect(fd.get("end_month")).toBe("2026-12-01");
  });

  it("omits start/end for one-time submissions", () => {
    const fd = buildCreateFormData({
      date: "2026-04-30",
      client: "c",
      reason: "fuel",
      amount: "100",
      claimable: false,
      org: "o",
      files: [],
      frequency: "one_time",
      start_month: "",
      end_month: "",
    });
    expect(fd.get("frequency")).toBe("one_time");
    expect(fd.get("start_month")).toBeNull();
    expect(fd.get("end_month")).toBeNull();
  });
});
