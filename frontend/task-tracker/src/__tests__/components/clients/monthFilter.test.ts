import { describe, expect, it } from "vitest";
import { matchesMonth } from "@/components/clients/monthFilter";

describe("matchesMonth", () => {
  it("returns true when month filter is empty (no filter active)", () => {
    expect(matchesMonth("2026-04-15", "")).toBe(true);
    expect(matchesMonth(null, "")).toBe(true);
  });

  it("returns true when dateStr is null regardless of month", () => {
    expect(matchesMonth(null, "2026-04")).toBe(true);
  });

  it("returns true when dateStr falls in the selected month", () => {
    expect(matchesMonth("2026-04-01", "2026-04")).toBe(true);
    expect(matchesMonth("2026-04-30", "2026-04")).toBe(true);
  });

  it("returns false when dateStr is in a different month", () => {
    expect(matchesMonth("2026-03-31", "2026-04")).toBe(false);
    expect(matchesMonth("2026-05-01", "2026-04")).toBe(false);
  });

  it("respects year boundaries", () => {
    expect(matchesMonth("2026-12-31", "2026-12")).toBe(true);
    expect(matchesMonth("2027-01-01", "2026-12")).toBe(false);
    expect(matchesMonth("2025-12-31", "2026-01")).toBe(false);
  });

  it("returns false when dateStr is in a different year but same month number", () => {
    expect(matchesMonth("2025-04-15", "2026-04")).toBe(false);
  });
});
