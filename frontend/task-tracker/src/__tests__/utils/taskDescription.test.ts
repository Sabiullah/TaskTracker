import { describe, it, expect } from "vitest";
import { taskDisplayDescription } from "@/utils/taskDescription";
import type { Task } from "@/types";

// Minimal Task factory — only the fields the helper reads matter; the rest
// are filled with harmless defaults.
function makeTask(overrides: Partial<Task>): Task {
  return {
    id: "1",
    serialNo: 1,
    description: "BRS",
    targetDate: "2026-07-10",
    recurrence: "Monthly",
    parentId: "99",
    ...overrides,
  } as Task;
}

describe("taskDisplayDescription", () => {
  it("appends the previous month for a Monthly occurrence", () => {
    expect(taskDisplayDescription(makeTask({}))).toBe("BRS — Jun 2026");
  });

  it("leaves a Monthly main goal (no parent) unchanged", () => {
    expect(taskDisplayDescription(makeTask({ parentId: null }))).toBe("BRS");
  });

  it("leaves a Weekly occurrence unchanged", () => {
    expect(taskDisplayDescription(makeTask({ recurrence: "Weekly" }))).toBe("BRS");
  });

  it("leaves a Monthly occurrence with no target date unchanged", () => {
    expect(
      taskDisplayDescription(makeTask({ targetDate: null as unknown as Task["targetDate"] })),
    ).toBe("BRS");
  });

  it("appends exactly one month to an already-clean name", () => {
    const out = taskDisplayDescription(makeTask({ description: "Sales" }));
    expect(out).toBe("Sales — Jun 2026");
    expect(out.match(/—/g)?.length).toBe(1);
  });
});
