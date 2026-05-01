// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { Task } from "@/types";

const mockUseAuth = vi.fn();
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

import TaskDrillModal from "@/components/dashboard/TaskDrillModal";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    serialNo: 1,
    client: "Acme",
    category: "Audit",
    description: "Review Q1 ledger",
    status: "Overdue",
    targetDate: "2026-04-25",
    expectedDate: "",
    completedDate: "",
    responsible: "Akilan",
    reportingManager: "",
    remarks: "",
    recurrence: "Onetime",
    organization: "org-1",
    createdBy: null,
    createdAt: null,
    ...overrides,
  };
}

function setRole(role: "admin" | "manager" | "user") {
  mockUseAuth.mockReturnValue({
    isAdminInAny: () => role === "admin",
    isManagerInAny: () => role === "admin" || role === "manager",
  });
}

beforeEach(() => {
  cleanup();
  mockUseAuth.mockReset();
});

describe("TaskDrillModal — module shape", () => {
  it("is a function component", () => {
    expect(typeof TaskDrillModal).toBe("function");
  });
});

describe("TaskDrillModal — Reporting Manager column", () => {
  it("renders a Reporting Manager header and cell value", () => {
    setRole("user");
    const tasks = [makeTask({ reportingManager: "Sabiullah N" })];
    render(
      <TaskDrillModal
        title="Akilan — Overdue"
        tasks={tasks}
        onClose={() => {}}
        profile={null}
      />,
    );
    expect(screen.getByText("Reporting Manager")).toBeTruthy();
    expect(screen.getByText("Sabiullah N")).toBeTruthy();
  });

  it("renders an em-dash when reportingManager is empty", () => {
    setRole("user");
    const tasks = [makeTask({ reportingManager: "" })];
    render(
      <TaskDrillModal
        title="Akilan — Overdue"
        tasks={tasks}
        onClose={() => {}}
        profile={null}
      />,
    );
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(3);
  });
});

describe("TaskDrillModal — row click behavior", () => {
  it("admin click calls onEditTaskFull and onClose, does NOT enter inline-edit", () => {
    setRole("admin");
    const onEditTaskFull = vi.fn();
    const onClose = vi.fn();
    const tasks = [makeTask()];
    render(
      <TaskDrillModal
        title="Akilan — Overdue"
        tasks={tasks}
        onClose={onClose}
        onEditTaskFull={onEditTaskFull}
        profile={null}
      />,
    );
    fireEvent.click(screen.getByText("Review Q1 ledger"));
    expect(onEditTaskFull).toHaveBeenCalledWith(tasks[0]);
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryAllByDisplayValue("2026-04-25")).toHaveLength(0);
  });

  it("manager click enters inline-edit with Target Date input", () => {
    setRole("manager");
    const onEditTaskFull = vi.fn();
    const onClose = vi.fn();
    render(
      <TaskDrillModal
        title="Team — Overdue"
        tasks={[makeTask()]}
        onClose={onClose}
        onEditTaskFull={onEditTaskFull}
        profile={null}
      />,
    );
    fireEvent.click(screen.getByText("Review Q1 ledger"));
    expect(onEditTaskFull).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    const dateInputs = document.querySelectorAll('input[type="date"]');
    expect(dateInputs.length).toBeGreaterThanOrEqual(3);
  });

  it("regular user click enters inline-edit WITHOUT Target Date input", () => {
    setRole("user");
    const onEditTaskFull = vi.fn();
    render(
      <TaskDrillModal
        title="My — Tasks"
        tasks={[makeTask()]}
        onClose={() => {}}
        onEditTaskFull={onEditTaskFull}
        profile={null}
      />,
    );
    fireEvent.click(screen.getByText("Review Q1 ledger"));
    expect(onEditTaskFull).not.toHaveBeenCalled();
    const dateInputs = document.querySelectorAll('input[type="date"]');
    expect(dateInputs.length).toBe(2);
  });

  it("when admin but no onEditTaskFull is passed, falls back to inline-edit", () => {
    setRole("admin");
    render(
      <TaskDrillModal
        title="Team — Overdue"
        tasks={[makeTask()]}
        onClose={() => {}}
        profile={null}
      />,
    );
    fireEvent.click(screen.getByText("Review Q1 ledger"));
    const dateInputs = document.querySelectorAll('input[type="date"]');
    expect(dateInputs.length).toBeGreaterThanOrEqual(3);
  });
});
