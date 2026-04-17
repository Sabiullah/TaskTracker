import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeStatus,
  dateStatus,
  getMonthKey,
  getProjectedDate,
  hasRecurringInstance,
} from "@/utils/task";

// Fix "today" to a stable reference so date-relative branches are deterministic.
const TODAY_ISO = "2026-04-17T00:00:00Z";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(TODAY_ISO));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("computeStatus", () => {
  it("returns 'TBC' when targetDate is empty", () => {
    expect(computeStatus({ targetDate: "", completedDate: "" })).toBe("TBC");
  });

  it("returns 'Tomorrow' when targetDate is exactly +1 day", () => {
    expect(
      computeStatus({ targetDate: "2026-04-18", completedDate: "" }),
    ).toBe("Tomorrow");
  });

  it("returns 'TodayTask' when targetDate is today and not completed", () => {
    expect(
      computeStatus({ targetDate: "2026-04-17", completedDate: "" }),
    ).toBe("TodayTask");
  });

  it("returns 'Overdue' when targetDate is in the past and not completed", () => {
    expect(
      computeStatus({ targetDate: "2026-04-10", completedDate: "" }),
    ).toBe("Overdue");
  });

  it("returns 'Pending' when targetDate is far in the future and not completed", () => {
    expect(
      computeStatus({ targetDate: "2026-05-20", completedDate: "" }),
    ).toBe("Pending");
  });

  it("returns 'Ontime' when completedDate <= targetDate", () => {
    expect(
      computeStatus({
        targetDate: "2026-04-20",
        completedDate: "2026-04-19",
      }),
    ).toBe("Ontime");

    expect(
      computeStatus({
        targetDate: "2026-04-20",
        completedDate: "2026-04-20",
      }),
    ).toBe("Ontime");
  });

  it("returns 'Completed Delay' when completedDate > targetDate", () => {
    expect(
      computeStatus({
        targetDate: "2026-04-15",
        completedDate: "2026-04-20",
      }),
    ).toBe("Completed Delay");
  });
});

describe("getMonthKey", () => {
  it("returns YYYY-MM for a valid date", () => {
    expect(getMonthKey("2026-04-17")).toBe("2026-04");
    expect(getMonthKey("2026-12-31")).toBe("2026-12");
  });

  it("pads single-digit months", () => {
    expect(getMonthKey("2026-01-05")).toBe("2026-01");
    expect(getMonthKey("2026-09-15")).toBe("2026-09");
  });

  it("returns null for empty / null / undefined input", () => {
    expect(getMonthKey("")).toBeNull();
    expect(getMonthKey(null)).toBeNull();
    expect(getMonthKey(undefined)).toBeNull();
  });

  it("returns null for unparseable strings", () => {
    expect(getMonthKey("not-a-date")).toBeNull();
  });
});

describe("hasRecurringInstance", () => {
  const BASE = "2026-01-15"; // base month: Jan 2026 (index 0)

  it("returns false for Onetime tasks", () => {
    expect(
      hasRecurringInstance(
        { recurrence: "Onetime", targetDate: BASE },
        2026,
        3,
      ),
    ).toBe(false);
  });

  it("returns false for any recurrence without a targetDate", () => {
    expect(
      hasRecurringInstance({ recurrence: "Monthly", targetDate: "" }, 2026, 3),
    ).toBe(false);
  });

  it("returns false for months before the base", () => {
    expect(
      hasRecurringInstance(
        { recurrence: "Monthly", targetDate: BASE },
        2025,
        11,
      ),
    ).toBe(false);
  });

  it("Monthly recurs every month at or after base", () => {
    expect(
      hasRecurringInstance(
        { recurrence: "Monthly", targetDate: BASE },
        2026,
        3,
      ),
    ).toBe(true);
    expect(
      hasRecurringInstance(
        { recurrence: "Monthly", targetDate: BASE },
        2027,
        0,
      ),
    ).toBe(true);
  });

  it("Quarterly recurs every 3 months from base", () => {
    // base Jan (0) → hits Jan, Apr, Jul, Oct
    expect(
      hasRecurringInstance(
        { recurrence: "Quarterly", targetDate: BASE },
        2026,
        3,
      ),
    ).toBe(true);
    expect(
      hasRecurringInstance(
        { recurrence: "Quarterly", targetDate: BASE },
        2026,
        4,
      ),
    ).toBe(false);
  });

  it("Halfyearly recurs every 6 months", () => {
    expect(
      hasRecurringInstance(
        { recurrence: "Halfyearly", targetDate: BASE },
        2026,
        6,
      ),
    ).toBe(true);
    expect(
      hasRecurringInstance(
        { recurrence: "Halfyearly", targetDate: BASE },
        2026,
        5,
      ),
    ).toBe(false);
  });

  it("Yearly recurs only in the anniversary month", () => {
    expect(
      hasRecurringInstance(
        { recurrence: "Yearly", targetDate: BASE },
        2027,
        0,
      ),
    ).toBe(true);
    expect(
      hasRecurringInstance(
        { recurrence: "Yearly", targetDate: BASE },
        2027,
        1,
      ),
    ).toBe(false);
  });
});

describe("getProjectedDate", () => {
  it("projects the base day into the target month", () => {
    expect(getProjectedDate({ targetDate: "2026-01-15" }, 2026, 3)).toBe(
      "2026-04-15",
    );
  });

  it("clamps day 31 to the last day of a 30-day month", () => {
    // Base day 31 into April (30 days) → 2026-04-30
    expect(getProjectedDate({ targetDate: "2026-01-31" }, 2026, 3)).toBe(
      "2026-04-30",
    );
  });

  it("clamps day 31 to the last day of February", () => {
    // Base day 31 into Feb 2026 (28 days) → 2026-02-28
    expect(getProjectedDate({ targetDate: "2026-01-31" }, 2026, 1)).toBe(
      "2026-02-28",
    );
  });

  it("pads single-digit month and day", () => {
    expect(getProjectedDate({ targetDate: "2026-01-05" }, 2026, 0)).toBe(
      "2026-01-05",
    );
  });
});

describe("dateStatus", () => {
  it("returns '' when dateStr is missing", () => {
    expect(dateStatus("", "Pending")).toBe("");
    expect(dateStatus(null, "Pending")).toBe("");
  });

  it("returns 'ontime' for any completion status regardless of date", () => {
    expect(dateStatus("2020-01-01", "Completed")).toBe("ontime");
    expect(dateStatus("2030-01-01", "Ontime")).toBe("ontime");
    expect(dateStatus("2020-01-01", "Completed Delay")).toBe("ontime");
  });

  it("returns 'overdue' when date is before today", () => {
    expect(dateStatus("2026-04-10", "Pending")).toBe("overdue");
  });

  it("returns 'today' when date equals today", () => {
    expect(dateStatus("2026-04-17", "Pending")).toBe("today");
  });

  it("returns 'due-soon' when date is within the next 3 days", () => {
    expect(dateStatus("2026-04-18", "Pending")).toBe("due-soon");
    expect(dateStatus("2026-04-20", "Pending")).toBe("due-soon");
  });

  it("returns '' when date is more than 3 days away", () => {
    expect(dateStatus("2026-04-21", "Pending")).toBe("");
  });
});
