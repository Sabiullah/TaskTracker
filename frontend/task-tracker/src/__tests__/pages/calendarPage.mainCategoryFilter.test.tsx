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

const dbParent: Task = {
  id: "goal-db" as ID,
  serialNo: 1,
  client: "Acme",
  category: "DB Update",
  description: "DB Update Goal",
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

const dbSub: Task = {
  ...dbParent,
  id: "sub-db" as ID,
  serialNo: 2,
  category: "Report Submission",
  description: "Report submission",
  targetDate: `${monthPrefix}-10`,
  parentId: "goal-db" as ID,
  planUid: "plan-db",
};

const cashflowTask: Task = {
  ...dbParent,
  id: "task-cf" as ID,
  serialNo: 3,
  category: "Cash flow",
  description: "Cashflow Standalone",
  targetDate: `${monthPrefix}-15`,
  parentId: null,
};

const tasks: Task[] = [dbParent, dbSub, cashflowTask];

const mainsById = new Map<
  ID,
  { category: string; responsible: string; description: string }
>([
  [
    "goal-db" as ID,
    {
      category: "DB Update",
      responsible: "Alice",
      description: "DB Update Goal",
    },
  ],
]);

beforeEach(() => {
  cleanup();
  localStorage.clear();
});

describe("CalendarPage — Main Category filter", () => {
  it("lists both parent-derived and own categories in the dropdown", () => {
    render(
      <CalendarPage
        tasks={tasks}
        profile={profile}
        profiles={[]}
        mainsById={mainsById}
      />,
    );

    const select = screen.getByLabelText(
      /filter by main category/i,
    ) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain("");
    expect(options).toContain("DB Update");
    expect(options).toContain("Cash flow");
    expect(options).not.toContain("Report Submission"); // sub-cat must not surface
  });

  it("filters the grid by selected main category", () => {
    render(
      <CalendarPage
        tasks={tasks}
        profile={profile}
        profiles={[]}
        mainsById={mainsById}
      />,
    );

    // Default state: all three rows present somewhere in the grid.
    expect(screen.queryAllByText(/DB Update Goal/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/Report submi/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/Cashflow Stand/).length).toBeGreaterThan(
      0,
    );

    const select = screen.getByLabelText(
      /filter by main category/i,
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "DB Update" } });

    // Cashflow gone, DB rows still present (parent + sub via parent's category).
    expect(screen.queryAllByText(/Cashflow Stand/).length).toBe(0);
    expect(screen.queryAllByText(/DB Update Goal/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/Report submi/).length).toBeGreaterThan(0);

    fireEvent.change(select, { target: { value: "Cash flow" } });

    // Only the cashflow row remains.
    expect(screen.queryAllByText(/Cashflow Stand/).length).toBeGreaterThan(
      0,
    );
    expect(screen.queryAllByText(/DB Update Goal/).length).toBe(0);
    expect(screen.queryAllByText(/Report submi/).length).toBe(0);
  });

  it("Clear button resets the dropdown along with the others", () => {
    render(
      <CalendarPage
        tasks={tasks}
        profile={profile}
        profiles={[]}
        mainsById={mainsById}
      />,
    );

    const select = screen.getByLabelText(
      /filter by main category/i,
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "DB Update" } });
    expect(select.value).toBe("DB Update");

    const clear = screen.getByRole("button", { name: /clear/i });
    fireEvent.click(clear);

    expect(select.value).toBe("");
    // All rows visible again.
    expect(screen.queryAllByText(/Cashflow Stand/).length).toBeGreaterThan(
      0,
    );
    expect(screen.queryAllByText(/DB Update Goal/).length).toBeGreaterThan(0);
  });

  it("options list narrows with Subtasks-only ON (top-level-only category disappears)", () => {
    render(
      <CalendarPage
        tasks={tasks}
        profile={profile}
        profiles={[]}
        mainsById={mainsById}
      />,
    );

    const pill = screen.getByRole("button", { name: /show subtasks only/i });
    fireEvent.click(pill);

    const select = screen.getByLabelText(
      /filter by main category/i,
    ) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);

    // With only subtasks visible, "Cash flow" (contributed by the top-level
    // task with no children) should not appear; "DB Update" still does
    // because its subtask inherits it via mainsById.
    expect(options).toContain("DB Update");
    expect(options).not.toContain("Cash flow");
  });
});
