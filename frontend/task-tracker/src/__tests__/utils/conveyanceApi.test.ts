import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(() => Promise.resolve({})),
  apiPost: vi.fn(() => Promise.resolve({})),
  apiPatch: vi.fn(() => Promise.resolve({})),
  apiDelete: vi.fn(() => Promise.resolve(undefined)),
  apiPostForm: vi.fn(() => Promise.resolve({})),
}));

import { apiDelete, apiGet, apiPatch, apiPostForm } from "@/lib/api";
import { fetchSummary, listEntries, addAttachment, updateEntry, deleteEntry } from "@/utils/conveyanceApi";

describe("conveyanceApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("listEntries drops empty/undefined filter values from the query", async () => {
    await listEntries({ month: "2026-04", status: undefined, search: "" });
    expect(apiGet).toHaveBeenCalledTimes(1);
    const [path, query] = (apiGet as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(path).toBe("/conveyance_entries/");
    expect(query).toEqual({ month: "2026-04" });
  });

  it("fetchSummary builds a trailing-mode query with months and end", async () => {
    await fetchSummary({ group_by: "client", mode: "trailing", months: 6, end: "2026-04" });
    const [path, query] = (apiGet as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(path).toBe("/conveyance_entries/summary/");
    expect(query).toEqual({ group_by: "client", mode: "trailing", months: 6, end: "2026-04" });
  });

  it("fetchSummary single mode omits months and end", async () => {
    await fetchSummary({ group_by: "employee", mode: "single", month: "2026-04" });
    const [, query] = (apiGet as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(query).toEqual({ group_by: "employee", mode: "single", month: "2026-04" });
    expect(query.months).toBeUndefined();
    expect(query.end).toBeUndefined();
  });

  it("addAttachment packages entry_uid, file, and label into FormData", async () => {
    const file = new File(["x"], "bill.jpg", { type: "image/jpeg" });
    await addAttachment("entry-uid-123", file, "Breakfast");
    expect(apiPostForm).toHaveBeenCalledTimes(1);
    const [path, form] = (apiPostForm as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] as [
      string,
      FormData,
    ];
    expect(path).toBe("/conveyance_attachments/");
    expect(form.get("entry_uid")).toBe("entry-uid-123");
    expect(form.get("label")).toBe("Breakfast");
    expect(form.get("file")).toBeInstanceOf(File);
  });
});

describe("updateEntry / deleteEntry — scope query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("updateEntry without scope hits the bare URL", async () => {
    (apiPatch as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce({ uid: "x" });
    await updateEntry("u-123", { reason: "fix" });
    expect(apiPatch).toHaveBeenCalledWith(
      "/conveyance_entries/u-123/",
      { reason: "fix" },
    );
  });

  it("updateEntry with scope appends the query string", async () => {
    (apiPatch as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce({ uid: "x" });
    await updateEntry("u-123", { reason: "fix" }, "series");
    expect(apiPatch).toHaveBeenCalledWith(
      "/conveyance_entries/u-123/?scope=series",
      { reason: "fix" },
    );
  });

  it("deleteEntry with scope=series_forward appends the query string", async () => {
    (apiDelete as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce(undefined);
    await deleteEntry("u-456", "series_forward");
    expect(apiDelete).toHaveBeenCalledWith(
      "/conveyance_entries/u-456/?scope=series_forward",
    );
  });
});
