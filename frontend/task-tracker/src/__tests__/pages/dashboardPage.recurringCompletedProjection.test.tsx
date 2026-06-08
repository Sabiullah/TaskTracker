// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Task, Profile } from "@/types";
import type { ID } from "@/types/common";

const mockUseAuth = vi.fn();
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockUseAuth() }));

// Expose the STATUS of each row the dashboard hands to ClientTable so we can
// assert the recurring-projection didn't recompute a completed row back to
// Overdue.
vi.mock("@/components/dashboard/ClientTable", () => ({
  default: ({ tasks }: { tasks: Task[] }) => (
    <div data-testid="client-table">
      {tasks.map((t) => (
        <div key={t.id} data-testid={`client-row-${t.id}`}>{t.status}</div>
      ))}
    </div>
  ),
}));
vi.mock("@/components/dashboard/TeamTable", () => ({ default: () => <div /> }));
vi.mock("@/components/dashboard/StatusDist", () => ({ default: () => <div /> }));
vi.mock("@/components/dashboard/TaskDetailTable", () => ({ default: () => <div /> }));
vi.mock("@/components/dashboard/ReportView", () => ({ default: () => <div /> }));

import DashboardPage from "@/pages/DashboardPage";

const profile: Profile = {
  id: "p1", username: "alice", full_name: "Alice", email: "a@x.com",
  manager_ids: null, avatar_color: null, orgs: [], highest_role: "admin",
} as unknown as Profile;

const today = new Date();
today.setHours(0, 0, 0, 0);
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Anchor a monthly recurring child two months back (so its stored month differs
// from the current cycle the dashboard projects to), with the day = 1 so the
// current-month cycle (e.g. Jun 1) is in the past relative to "today" (Jun 4).
const twoMonthsAgo = new Date(today);
twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
const anchor = `${twoMonthsAgo.getFullYear()}-${String(twoMonthsAgo.getMonth() + 1).padStart(2, "0")}-01`;

const recurringCompleted: Task = {
  id: "rec-completed" as ID,
  serialNo: 4944,
  client: "JMS",
  category: "Custom DB",
  description: "P&L Data Collection - Sales",
  status: "Overdue",
  targetDate: anchor,            // stored month = two months ago
  expectedDate: "",
  completedDate: ymd(today),     // completed in the CURRENT cycle
  responsible: "Alice",
  reportingManager: "",
  remarks: "",
  recurrence: "Monthly",
  organization: "org-1",
  createdBy: null,
  createdAt: null,
  parentId: "main-1" as ID,
};

beforeEach(() => {
  cleanup();
  mockUseAuth.mockReset();
  mockUseAuth.mockReturnValue({ isAdminInAny: () => true, isManagerInAny: () => false });
});

describe("DashboardPage — recurring projection preserves a current-cycle completion", () => {
  it("does NOT recompute a monthly task completed this cycle back to Overdue", () => {
    render(<DashboardPage tasks={[recurringCompleted]} profile={profile} profiles={[profile]} />);
    const row = screen.queryByTestId("client-row-rec-completed");
    // The row may be filtered out of the dashboard entirely (completed, not
    // overdue) — that's fine. What must NOT happen is it showing as Overdue.
    if (row) {
      expect(row.textContent).not.toBe("Overdue");
    }
  });
});

describe("DashboardPage — recurring series shows once per shown cycle", () => {
  // Two materialised monthly children of the SAME series (same goal + category)
  // stored in different months. The projection maps both onto the current
  // cycle's date; without dedupe the dashboard surfaced the same task twice
  // (the real "TDS Payment appears twice" bug). Expect a single row.
  const firstOfThisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
  const prev = new Date(today);
  prev.setMonth(prev.getMonth() - 1);
  const firstOfPrevMonth = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}-01`;

  const dupBase: Task = {
    ...recurringCompleted,
    description: "TDS Payment",
    category: "TDS Payment",
    completedDate: "",
    parentId: "goal-2" as ID,
  };
  const childThisMonth: Task = { ...dupBase, id: "dupA" as ID, serialNo: 2750, targetDate: firstOfThisMonth };
  const childPrevMonth: Task = { ...dupBase, id: "dupB" as ID, serialNo: 2754, targetDate: firstOfPrevMonth };

  it("collapses two monthly children that project onto the same cycle to ONE row", () => {
    render(
      <DashboardPage tasks={[childThisMonth, childPrevMonth]} profile={profile} profiles={[profile]} />,
    );
    const rows = screen.queryAllByTestId(/^client-row-dup/);
    expect(rows.length).toBe(1);
  });
});
