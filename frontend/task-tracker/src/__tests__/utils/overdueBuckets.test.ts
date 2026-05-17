import { describe, it, expect } from "vitest";
import type { Task } from "@/types";
import type { ID } from "@/types/common";
import {
  isOverduePerTarget,
  isOverduePerExpected,
  isOverdueNoExpectedSet,
} from "@/utils/overdueBuckets";

const today = new Date("2026-05-17");
today.setHours(0, 0, 0, 0);

const past = "2026-05-10";
const future = "2026-05-25";

const base: Task = {
  id: "t-1" as ID,
  serialNo: 1,
  client: "Acme",
  category: "Audit",
  description: "x",
  status: "Overdue",
  targetDate: past,
  expectedDate: "",
  completedDate: "",
  responsible: "Alice",
  reportingManager: "",
  remarks: "",
  recurrence: "Onetime",
  organization: "org-1",
  createdBy: null,
  createdAt: null,
  parentId: null,
};

describe("overdueBuckets predicates", () => {
  it("Per Target: rows with status='Overdue' qualify", () => {
    expect(isOverduePerTarget(base)).toBe(true);
  });

  it("Per Target: rows with any other status do not qualify", () => {
    expect(isOverduePerTarget({ ...base, status: "Pending" })).toBe(false);
    expect(isOverduePerTarget({ ...base, status: "Ontime" })).toBe(false);
    expect(isOverduePerTarget({ ...base, status: "Completed Delay" })).toBe(false);
  });

  it("Past Expected: expectedDate set + before today + not completed", () => {
    const t = { ...base, expectedDate: past };
    expect(isOverduePerExpected(t, today)).toBe(true);
  });

  it("Past Expected: future expectedDate does NOT qualify", () => {
    const t = { ...base, expectedDate: future };
    expect(isOverduePerExpected(t, today)).toBe(false);
  });

  it("Past Expected: empty expectedDate does NOT qualify", () => {
    expect(isOverduePerExpected({ ...base, expectedDate: "" }, today)).toBe(false);
  });

  it("Past Expected: completed rows do NOT qualify even if expectedDate is past", () => {
    const t = { ...base, expectedDate: past, completedDate: past };
    expect(isOverduePerExpected(t, today)).toBe(false);
  });

  it("Past Expected: future target + lapsed expectedDate DOES qualify (edge case)", () => {
    const t = { ...base, targetDate: future, status: "Pending", expectedDate: past };
    expect(isOverduePerExpected(t, today)).toBe(true);
  });

  it("No Expected Set: status='Overdue' AND empty expectedDate qualifies", () => {
    expect(isOverdueNoExpectedSet({ ...base, expectedDate: "" })).toBe(true);
  });

  it("No Expected Set: status='Overdue' with expectedDate set does NOT qualify", () => {
    expect(isOverdueNoExpectedSet({ ...base, expectedDate: future })).toBe(false);
  });

  it("No Expected Set: non-overdue rows do NOT qualify even with empty expectedDate", () => {
    expect(
      isOverdueNoExpectedSet({ ...base, status: "Pending", expectedDate: "" }),
    ).toBe(false);
  });
});
