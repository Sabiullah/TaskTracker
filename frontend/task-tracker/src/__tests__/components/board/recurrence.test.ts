import { describe, it, expect } from "vitest";

import {
  addMonthsToYearMonth,
  generateOccurrences,
  lastDayOfMonth,
  monthsBetween,
  parseStartMonth,
  parseYearMonth,
  thisMonthString,
} from "@/components/board/recurrence";

describe("recurrence helpers", () => {
  it("lastDayOfMonth handles leap years and 30/31-day months", () => {
    expect(lastDayOfMonth(2026, 1)).toBe(31); // Jan
    expect(lastDayOfMonth(2026, 2)).toBe(28); // Feb non-leap
    expect(lastDayOfMonth(2024, 2)).toBe(29); // Feb leap
    expect(lastDayOfMonth(2026, 4)).toBe(30); // Apr
    expect(lastDayOfMonth(2026, 12)).toBe(31); // Dec
  });

  it("parseStartMonth accepts YYYY-MM and rejects garbage", () => {
    expect(parseStartMonth("2026-05")).toEqual({ year: 2026, month: 5 });
    expect(parseStartMonth("2026-1")).toBeNull();
    expect(parseStartMonth("2026-13")).toBeNull();
    expect(parseStartMonth("not-a-date")).toBeNull();
    expect(parseStartMonth("")).toBeNull();
  });

  it("thisMonthString returns YYYY-MM in local time", () => {
    const out = thisMonthString(new Date(2026, 4, 9)); // Local May 9 2026
    expect(out).toBe("2026-05");
  });

  describe("generateOccurrences", () => {
    it("Monthly with day 15 over 12 months emits 12 dates on the 15th", () => {
      const dates = generateOccurrences({
        recurrence: "Monthly",
        targetDay: 15,
        startMonth: "2026-05",
        engagementMonths: 12,
      });
      expect(dates).toHaveLength(12);
      expect(dates[0]).toBe("2026-05-15");
      expect(dates[1]).toBe("2026-06-15");
      expect(dates[8]).toBe("2027-01-15");
      expect(dates[11]).toBe("2027-04-15");
    });

    it("Quarterly steps every 3 months", () => {
      const dates = generateOccurrences({
        recurrence: "Quarterly",
        targetDay: 20,
        startMonth: "2026-05",
        engagementMonths: 12,
      });
      expect(dates).toEqual([
        "2026-05-20",
        "2026-08-20",
        "2026-11-20",
        "2027-02-20",
      ]);
    });

    it("Halfyearly steps every 6 months", () => {
      const dates = generateOccurrences({
        recurrence: "Halfyearly",
        targetDay: 1,
        startMonth: "2026-01",
        engagementMonths: 18,
      });
      expect(dates).toEqual(["2026-01-01", "2026-07-01", "2027-01-01"]);
    });

    it("Yearly emits one row per 12-month chunk", () => {
      const dates = generateOccurrences({
        recurrence: "Yearly",
        targetDay: 31,
        startMonth: "2026-03",
        engagementMonths: 24,
      });
      expect(dates).toEqual(["2026-03-31", "2027-03-31"]);
    });

    it("Onetime returns a single occurrence at the start month", () => {
      const dates = generateOccurrences({
        recurrence: "Onetime",
        targetDay: 10,
        startMonth: "2026-05",
        engagementMonths: 24,
      });
      expect(dates).toEqual(["2026-05-10"]);
    });

    it("clamps day 31 to month-end for short months", () => {
      const dates = generateOccurrences({
        recurrence: "Monthly",
        targetDay: 31,
        startMonth: "2026-01",
        engagementMonths: 4,
      });
      // Jan 31, Feb 28 (clamped), Mar 31, Apr 30 (clamped).
      expect(dates).toEqual([
        "2026-01-31",
        "2026-02-28",
        "2026-03-31",
        "2026-04-30",
      ]);
    });

    it("clamps day 31 to Feb 29 in leap years", () => {
      const dates = generateOccurrences({
        recurrence: "Monthly",
        targetDay: 31,
        startMonth: "2024-02",
        engagementMonths: 1,
      });
      expect(dates).toEqual(["2024-02-29"]);
    });

    it("targetDay null produces empty-string dates so the user can fill them", () => {
      const dates = generateOccurrences({
        recurrence: "Monthly",
        targetDay: null,
        startMonth: "2026-05",
        engagementMonths: 3,
      });
      expect(dates).toEqual(["", "", ""]);
    });

    it("returns empty list for malformed startMonth", () => {
      const dates = generateOccurrences({
        recurrence: "Monthly",
        targetDay: 15,
        startMonth: "garbage",
        engagementMonths: 12,
      });
      expect(dates).toEqual([]);
    });

    it("clamps engagementMonths to at least 1", () => {
      const dates = generateOccurrences({
        recurrence: "Monthly",
        targetDay: 1,
        startMonth: "2026-05",
        engagementMonths: 0,
      });
      // Even with 0 length we always emit at least the start month.
      expect(dates).toEqual(["2026-05-01"]);
    });

    it("legacy empty recurrence acts like Onetime", () => {
      const dates = generateOccurrences({
        recurrence: "",
        targetDay: 7,
        startMonth: "2026-05",
        engagementMonths: 12,
      });
      expect(dates).toEqual(["2026-05-07"]);
    });
  });
});

describe("month helpers", () => {
  it("parseYearMonth returns first-of-month or null", () => {
    expect(parseYearMonth("2026-05")).toEqual(new Date(2026, 4, 1));
    expect(parseYearMonth("2026-13")).toBeNull();
    expect(parseYearMonth("nonsense")).toBeNull();
  });

  it("addMonthsToYearMonth handles year wrap-around", () => {
    expect(addMonthsToYearMonth("2026-11", 3)).toBe("2027-02");
    expect(addMonthsToYearMonth("2026-05", -7)).toBe("2025-10");
  });

  it("monthsBetween returns inclusive list of YYYY-MM strings", () => {
    expect(monthsBetween("2026-05", "2026-07")).toEqual([
      "2026-05",
      "2026-06",
      "2026-07",
    ]);
    expect(monthsBetween("2026-05", "2026-05")).toEqual(["2026-05"]);
    expect(monthsBetween("2026-07", "2026-05")).toEqual([]);
  });
});
