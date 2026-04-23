import { describe, it, expect } from "vitest";

import {
  buildTooltip,
  formatAmount,
} from "@/components/conveyance/conveyanceSummaryHelpers";

describe("formatAmount", () => {
  it("formats INR with symbol and grouping", () => {
    expect(formatAmount("1234.5")).toMatch(/₹/);
    expect(formatAmount("1234.5")).toMatch(/1,234/);
  });

  it("returns the input unchanged if not a number", () => {
    expect(formatAmount("not-a-number")).toBe("not-a-number");
  });
});

describe("buildTooltip", () => {
  const top = [
    { uid: "1", date: "2026-04-18", reason: "taxi", amount: "100.00" },
    { uid: "2", date: "2026-04-20", reason: "hotel", amount: "200.00" },
    { uid: "3", date: "2026-04-22", reason: "food", amount: "50.00" },
  ];

  it("returns an empty string when there are no top entries", () => {
    expect(buildTooltip([], 0)).toBe("");
  });

  it("joins top entries one per line", () => {
    const t = buildTooltip(top, 3);
    expect(t.split("\n")).toHaveLength(3);
    expect(t).toContain("taxi");
    expect(t).toContain("hotel");
  });

  it("appends \"…and N more\" when entry_count exceeds top.length", () => {
    const t = buildTooltip(top, 7);
    expect(t).toContain("…and 4 more");
  });

  it("omits the \"…and more\" suffix when entry_count equals top.length", () => {
    const t = buildTooltip(top, 3);
    expect(t).not.toContain("more");
  });
});
