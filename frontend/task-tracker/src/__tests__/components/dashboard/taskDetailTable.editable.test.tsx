// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { Task } from "@/types";

const mockUseAuth = vi.fn();
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

import TaskDetailTable from "@/components/dashboard/TaskDetailTable";

function setRole(role: "admin" | "manager" | "user") {
  mockUseAuth.mockReturnValue({
    isAdminInAny: () => role === "admin",
    isManagerInAny: () => role === "admin" || role === "manager",
  });
}

const task = (id = "t-1"): Task =>
  ({
    id,
    serialNo: 1,
    client: "JMS",
    category: "Custom DB",
    description: "PO and Sale Invoice Not Generated Report",
    status: "Pending",
    targetDate: "2026-06-05",
    expectedDate: "",
    completedDate: "",
    responsible: "Gunasekaran M",
    reportingManager: "Sulthan Alavutheen",
    remarks: "",
    recurrence: "Monthly",
    organization: "org-1",
    createdBy: null,
    createdAt: null,
    parentId: null,
  }) as unknown as Task;

beforeEach(() => {
  cleanup();
  mockUseAuth.mockReset();
});

describe("TaskDetailTable — inline edit access", () => {
  it("lets a normal (non-manager) user click a row and edit when editable", () => {
    setRole("user");
    const onPatchTask = vi.fn().mockResolvedValue(undefined);
    render(
      <TaskDetailTable
        tasks={[task()]}
        title="Tasks for client: JMS"
        editable={true}
        onPatchTask={onPatchTask}
      />,
    );

    // The "click a row to edit" hint should be visible to a normal user.
    expect(screen.getByText(/Click a row to edit/i)).toBeTruthy();

    // Clicking the row should open the inline date editor.
    fireEvent.click(screen.getByText("PO and Sale Invoice Not Generated Report"));
    const dateInputs = document.querySelectorAll('input[type="date"]');
    expect(dateInputs.length).toBeGreaterThan(0);
  });

  it("does not enable editing when editable is false", () => {
    setRole("user");
    render(
      <TaskDetailTable
        tasks={[task()]}
        title="Tasks for client: JMS"
        editable={false}
      />,
    );
    fireEvent.click(screen.getByText("PO and Sale Invoice Not Generated Report"));
    expect(document.querySelectorAll('input[type="date"]').length).toBe(0);
  });
});
