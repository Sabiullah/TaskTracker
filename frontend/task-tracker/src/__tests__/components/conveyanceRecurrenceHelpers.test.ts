import { describe, expect, it } from "vitest";

import {
  groupBySeries,
  pickHeadline,
  formatSeriesBadge,
} from "@/components/conveyance/conveyanceRecurrenceHelpers";
import type { ConveyanceEntry } from "@/types/api/conveyance";

function row(partial: Partial<ConveyanceEntry>): ConveyanceEntry {
  return {
    uid: "u-" + Math.random(),
    date: "2026-04-01",
    employee_detail: { uid: "e", username: "e", full_name: "E" },
    client_detail: { uid: "c", name: "C", type: "client" },
    reason: "r",
    amount: "100.00",
    claimable: true,
    status: "pending",
    review_note: "",
    reviewed_by_detail: null,
    reviewed_at: null,
    attachments: [],
    created_by_detail: null,
    created_at: "",
    updated_at: "",
    frequency: "one_time",
    series_uid: null,
    start_month: null,
    end_month: null,
    ...partial,
  };
}

describe("groupBySeries", () => {
  it("treats one-time entries as singleton groups", () => {
    const r1 = row({ uid: "a", series_uid: null });
    const r2 = row({ uid: "b", series_uid: null });
    const groups = groupBySeries([r1, r2]);
    expect(groups).toHaveLength(2);
    expect(groups[0].entries).toEqual([r1]);
    expect(groups[1].entries).toEqual([r2]);
  });

  it("buckets siblings by series_uid", () => {
    const r1 = row({ uid: "a", series_uid: "s1", date: "2026-01-01" });
    const r2 = row({ uid: "b", series_uid: "s1", date: "2026-02-01" });
    const r3 = row({ uid: "c", series_uid: null, date: "2026-03-01" });
    const groups = groupBySeries([r1, r2, r3]);
    expect(groups).toHaveLength(2);
    const series = groups.find((g) => g.seriesUid === "s1")!;
    expect(series.entries.map((e) => e.uid)).toEqual(["a", "b"]);
  });

  it("preserves chronological order within a series", () => {
    const r2 = row({ uid: "b", series_uid: "s", date: "2026-02-01" });
    const r1 = row({ uid: "a", series_uid: "s", date: "2026-01-01" });
    const r3 = row({ uid: "c", series_uid: "s", date: "2026-03-01" });
    const groups = groupBySeries([r2, r1, r3]);
    expect(groups[0].entries.map((e) => e.uid)).toEqual(["a", "b", "c"]);
  });
});

describe("pickHeadline", () => {
  const today = new Date("2026-04-15T12:00:00Z");

  it("picks the most recent on-or-before today", () => {
    const r1 = row({ uid: "a", date: "2026-01-01" });
    const r2 = row({ uid: "b", date: "2026-04-01" });
    const r3 = row({ uid: "c", date: "2026-08-01" });
    expect(pickHeadline([r1, r2, r3], today).uid).toBe("b");
  });

  it("picks earliest sibling when all are future", () => {
    const r1 = row({ uid: "a", date: "2027-01-01" });
    const r2 = row({ uid: "b", date: "2027-06-01" });
    expect(pickHeadline([r1, r2], today).uid).toBe("a");
  });

  it("picks the most recent past sibling when all are past", () => {
    const r1 = row({ uid: "a", date: "2025-01-01" });
    const r2 = row({ uid: "b", date: "2025-06-01" });
    expect(pickHeadline([r1, r2], today).uid).toBe("b");
  });
});

describe("formatSeriesBadge", () => {
  it("formats a monthly Jan–Dec window", () => {
    const r = row({
      uid: "a",
      frequency: "monthly",
      start_month: "2026-01-01",
      end_month: "2026-12-01",
      date: "2026-04-01",
    });
    expect(formatSeriesBadge(r, 12)).toBe("Monthly · Jan–Dec 2026 · 4/12");
  });

  it("formats a yearly multi-year window", () => {
    const r = row({
      uid: "a",
      frequency: "yearly",
      start_month: "2026-01-01",
      end_month: "2028-01-01",
      date: "2027-01-01",
    });
    expect(formatSeriesBadge(r, 3)).toBe("Yearly · Jan 2026 – Jan 2028 · 2/3");
  });
});
