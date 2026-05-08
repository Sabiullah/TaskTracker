// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { Task } from "@/types";

const mockUseAuth = vi.fn();
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

// useMasters / useProfiles are stubbed because the drill modal renders
// dropdowns for admins and the test environment has no API. Returning empty
// lists keeps the dropdown shape valid without coupling to real data.
vi.mock("@/hooks/useMasters", () => ({
  useMasters: () => ({ clients: [], cats: [], loading: false, saving: false }),
}));
vi.mock("@/hooks/useProfiles", () => ({
  useProfiles: () => ({ profiles: [], loading: false }),
}));

import TaskDrillModal, {
  type TaskDrillPatch,
} from "@/components/dashboard/TaskDrillModal";

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
    parentId: null,
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
  it("admin click enters inline-edit with all fields and does NOT call onEditTaskFull", () => {
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
    expect(onEditTaskFull).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // Admin gets all 3 date inputs, plus dropdowns for Client / Responsible /
    // Reporting Manager — verify the row is now in the inline-edit state.
    const dateInputs = document.querySelectorAll('input[type="date"]');
    expect(dateInputs.length).toBeGreaterThanOrEqual(3);
    const selects = document.querySelectorAll("select");
    expect(selects.length).toBeGreaterThanOrEqual(3);
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
    // Managers don't get FK dropdowns — only admins do.
    const selects = document.querySelectorAll("select");
    expect(selects.length).toBe(0);
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
});

describe("TaskDrillModal — admin save patch shape", () => {
  // Mirror `TaskDrillModal.onPatchTask` so `vi.fn` infers a non-empty call
  // tuple — the default zero-arg signature fails strict project-references
  // typecheck (`tsc -b`) the same way `mock.calls[0]` would as `[]`.
  type PatchHandler = (taskId: string, patch: TaskDrillPatch) => Promise<void>;

  it("omits description from the patch when admin only edits remarks", async () => {
    setRole("admin");
    const onPatchTask = vi.fn<PatchHandler>(async () => {});
    const tasks = [makeTask({ description: "Existing description" })];
    render(
      <TaskDrillModal
        title="Akilan — Overdue"
        tasks={tasks}
        onClose={() => {}}
        onPatchTask={onPatchTask}
        profile={null}
      />,
    );
    fireEvent.click(screen.getByText("Existing description"));
    const remarksInput = document.querySelector(
      'input[placeholder="Add remarks…"]',
    ) as HTMLInputElement;
    fireEvent.change(remarksInput, { target: { value: "Now with remarks" } });
    fireEvent.click(screen.getByText(/Save/));
    await waitFor(() => expect(onPatchTask).toHaveBeenCalled());
    expect(onPatchTask).toHaveBeenCalledWith(
      "task-1",
      expect.not.objectContaining({ description: expect.anything() }),
    );
    expect(onPatchTask).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ remarks: "Now with remarks" }),
    );
  });

  it("does NOT send empty description for legacy/sub-task rows with no body", async () => {
    setRole("admin");
    const onPatchTask = vi.fn<PatchHandler>(async () => {});
    // Sub-task / legacy row with empty description. The board renders
    // "Sub of #N" but the input value is "". Without the change-detect
    // guard, the save would PATCH `description: ""` and fail
    // `validate_description` server-side.
    const tasks = [
      makeTask({
        id: "sub-1",
        description: "",
        parentId: "main-1",
        serialNo: 7,
      }),
    ];
    render(
      <TaskDrillModal
        title="Akilan — Overdue"
        tasks={tasks}
        onClose={() => {}}
        onPatchTask={onPatchTask}
        profile={null}
      />,
    );
    fireEvent.click(screen.getByText(/Sub of #7/));
    const remarksInput = document.querySelector(
      'input[placeholder="Add remarks…"]',
    ) as HTMLInputElement;
    fireEvent.change(remarksInput, { target: { value: "Picked up" } });
    fireEvent.click(screen.getByText(/Save/));
    await waitFor(() => expect(onPatchTask).toHaveBeenCalled());
    expect(onPatchTask).toHaveBeenCalledWith(
      "sub-1",
      expect.not.objectContaining({ description: expect.anything() }),
    );
  });

  it("DOES send description when admin actually edits it", async () => {
    setRole("admin");
    const onPatchTask = vi.fn<PatchHandler>(async () => {});
    const tasks = [makeTask({ description: "Original" })];
    render(
      <TaskDrillModal
        title="Akilan — Overdue"
        tasks={tasks}
        onClose={() => {}}
        onPatchTask={onPatchTask}
        profile={null}
      />,
    );
    fireEvent.click(screen.getByText("Original"));
    const descInput = document.querySelector(
      'input[type="text"]',
    ) as HTMLInputElement;
    fireEvent.change(descInput, { target: { value: "Reworked" } });
    fireEvent.click(screen.getByText(/Save/));
    await waitFor(() => expect(onPatchTask).toHaveBeenCalled());
    expect(onPatchTask).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ description: "Reworked" }),
    );
  });
});

describe("TaskDrillModal — sync with upstream tasks", () => {
  it("re-renders rows when the tasks prop changes", async () => {
    setRole("user");
    const t1 = makeTask({ id: "a", description: "Original task" });
    const t2 = makeTask({ id: "b", description: "Updated task" });
    const { rerender } = render(
      <TaskDrillModal
        title="Test"
        tasks={[t1]}
        onClose={() => {}}
        profile={null}
      />,
    );
    expect(screen.getByText("Original task")).toBeTruthy();
    rerender(
      <TaskDrillModal
        title="Test"
        tasks={[t2]}
        onClose={() => {}}
        profile={null}
      />,
    );
    await waitFor(() => {
      expect(screen.queryByText("Original task")).toBeNull();
    });
    expect(screen.getByText("Updated task")).toBeTruthy();
  });
});
