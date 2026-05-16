// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Profile } from "@/types/auth";
import type { Task } from "@/types";
import type { ID } from "@/types/common";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    isAdminInAny: () => true,
    isManagerInAny: () => false,
  }),
}));

vi.mock("@/hooks/useWorkPlans", () => ({
  useWorkPlans: () => ({ plans: [] }),
}));

import CalendarPage from "@/pages/CalendarPage";

const profile: Profile = {
  id: "p1",
  username: "alice",
  full_name: "Alice",
  email: "a@x.com",
  manager_ids: null,
  avatar_color: null,
  orgs: [],
  highest_role: "admin",
};

const now = new Date();
const yyyy = now.getFullYear();
const mm = String(now.getMonth() + 1).padStart(2, "0");
const monthPrefix = `${yyyy}-${mm}`;

const parentGoal: Task = {
  id: "goal-1" as ID,
  serialNo: 1,
  client: "Acme",
  category: "Statutory",
  description: "Acme Engagement",
  status: "Pending",
  targetDate: `${monthPrefix}-05`,
  expectedDate: "",
  completedDate: "",
  responsible: "Alice",
  reportingManager: "",
  remarks: "",
  recurrence: "Onetime",
  organization: "",
  createdBy: null,
  createdAt: null,
  parentId: null,
};

const subA: Task = {
  ...parentGoal,
  id: "sub-a" as ID,
  serialNo: 2,
  description: "GSTR-1 filing",
  targetDate: `${monthPrefix}-10`,
  parentId: "goal-1" as ID,
  planUid: "plan-a",
};

const subB: Task = {
  ...parentGoal,
  id: "sub-b" as ID,
  serialNo: 3,
  description: "Bank reconciliation",
  targetDate: `${monthPrefix}-15`,
  parentId: "goal-1" as ID,
  planUid: "plan-b",
};

const tasks: Task[] = [parentGoal, subA, subB];

const mainsById = new Map<
  ID,
  { category: string; responsible: string; description: string }
>([
  [
    "goal-1" as ID,
    {
      category: "Statutory",
      responsible: "Alice",
      description: "Acme Engagement",
    },
  ],
]);

beforeEach(() => {
  cleanup();
  localStorage.clear();
});

describe("CalendarPage — Subtasks-only filter", () => {
  it("shows parent goal and subtasks by default; toggling the pill hides the parent and prefixes subtask pills", () => {
    render(
      <CalendarPage
        tasks={tasks}
        profile={profile}
        profiles={[]}
        mainsById={mainsById}
      />,
    );

    // Default state: all three rows visible in the grid.
    expect(screen.queryAllByText(/Acme Engagement/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/GSTR-1 filing/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/Bank reconcilia/).length).toBeGreaterThan(0);

    // Toggle the pill.
    const pill = screen.getByRole("button", { name: /show subtasks only/i });
    fireEvent.click(pill);

    // Parent goal pill is gone.
    expect(screen.queryByText(/^Acme Engagement$/)).toBeNull();

    // Subtask pills now carry the parent prefix "Acme Engag… › ".
    expect(
      screen.queryAllByText((_, el) => {
        const text = el?.textContent ?? "";
        return /Acme Engag.*›.*GSTR-1/.test(text);
      }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryAllByText((_, el) => {
        const text = el?.textContent ?? "";
        return /Acme Engag.*›.*Bank reconci/.test(text);
      }).length,
    ).toBeGreaterThan(0);
  });

  it("hydrates the pill from localStorage on mount", () => {
    localStorage.setItem("tasktracker.calendar.subtasksOnly", "1");
    render(
      <CalendarPage
        tasks={tasks}
        profile={profile}
        profiles={[]}
        mainsById={mainsById}
      />,
    );

    const pill = screen.getByRole("button", { name: /show subtasks only/i });
    expect(pill.getAttribute("aria-pressed")).toBe("true");
    // Parent goal pill is hidden because the filter starts ON.
    expect(screen.queryByText(/^Acme Engagement$/)).toBeNull();
  });
});
