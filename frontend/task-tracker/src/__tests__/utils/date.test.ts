import { describe, it, expect } from "vitest";
import { fmtCreatedAt, fmtCreatedDate } from "@/utils/date";

// Local (no "Z") input → parsed as local time, so the rendered time is
// deterministic regardless of the runner's timezone.
const LOCAL = "2026-07-18T15:42:00";

describe("fmtCreatedAt", () => {
  it("formats day, short month, and 24h time with no year", () => {
    expect(fmtCreatedAt(LOCAL)).toBe("18 Jul 15:42");
  });

  it("returns empty string for null/empty", () => {
    expect(fmtCreatedAt(null)).toBe("");
    expect(fmtCreatedAt("")).toBe("");
    expect(fmtCreatedAt(undefined)).toBe("");
  });
});

describe("fmtCreatedDate", () => {
  it("formats day and short month only", () => {
    expect(fmtCreatedDate(LOCAL)).toBe("18 Jul");
  });

  it("returns empty string for null/empty", () => {
    expect(fmtCreatedDate(null)).toBe("");
    expect(fmtCreatedDate("")).toBe("");
    expect(fmtCreatedDate(undefined)).toBe("");
  });
});
