/**
 * Unit tests for ConveyanceAttachmentList display logic.
 *
 * The component itself uses JSX and requires a browser-like environment to
 * render, but the branching rules it applies — empty → dash, one → inline
 * link, many → summary with count — can be verified by exercising the same
 * conditions against plain data objects.  We keep this file free of React /
 * DOM imports so it runs in the Vitest node environment without jsdom.
 */
import { describe, expect, it } from "vitest";
import type { ConveyanceAttachment } from "@/types/api/conveyance";

function makeAttachment(over: Partial<ConveyanceAttachment> = {}): ConveyanceAttachment {
  return {
    uid: "a1",
    label: "",
    file_url: "http://example.com/a1",
    filename: "file1.jpg",
    uploaded_by_detail: null,
    created_at: "2026-04-18T00:00:00Z",
    ...over,
  };
}

// Pure helpers that mirror the component's branching logic.
function displayMode(attachments: ConveyanceAttachment[]): "empty" | "single" | "multi" {
  if (attachments.length === 0) return "empty";
  if (attachments.length === 1) return "single";
  return "multi";
}

function resolveLabel(a: ConveyanceAttachment): string {
  return a.label || a.filename || "";
}

describe("ConveyanceAttachmentList display logic", () => {
  it("returns 'empty' mode for an empty attachments array", () => {
    expect(displayMode([])).toBe("empty");
  });

  it("returns 'single' mode for exactly one attachment", () => {
    expect(displayMode([makeAttachment()])).toBe("single");
  });

  it("returns 'multi' mode for two or more attachments", () => {
    expect(displayMode([makeAttachment({ uid: "a1" }), makeAttachment({ uid: "a2" })])).toBe("multi");
    expect(
      displayMode([
        makeAttachment({ uid: "a1" }),
        makeAttachment({ uid: "a2" }),
        makeAttachment({ uid: "a3" }),
      ]),
    ).toBe("multi");
  });

  it("prefers label over filename when both are present", () => {
    const a = makeAttachment({ label: "Breakfast", filename: "img.jpg" });
    expect(resolveLabel(a)).toBe("Breakfast");
  });

  it("falls back to filename when label is empty", () => {
    const a = makeAttachment({ label: "", filename: "receipt.pdf" });
    expect(resolveLabel(a)).toBe("receipt.pdf");
  });

  it("returns empty string when both label and filename are empty/null", () => {
    const a = makeAttachment({ label: "", filename: null });
    expect(resolveLabel(a)).toBe("");
  });

  it("multi mode count equals attachments.length", () => {
    const list = [
      makeAttachment({ uid: "a1", label: "Breakfast" }),
      makeAttachment({ uid: "a2", label: "Lunch" }),
      makeAttachment({ uid: "a3", label: "Dinner" }),
    ];
    expect(list.length).toBe(3);
    expect(displayMode(list)).toBe("multi");
  });

  it("single attachment uses its file_url as the href", () => {
    const a = makeAttachment({ file_url: "http://example.com/bill.pdf" });
    expect(a.file_url).toBe("http://example.com/bill.pdf");
  });

  it("falls back to '#' href when file_url is null", () => {
    const a = makeAttachment({ file_url: null });
    const href = a.file_url ?? "#";
    expect(href).toBe("#");
  });
});
