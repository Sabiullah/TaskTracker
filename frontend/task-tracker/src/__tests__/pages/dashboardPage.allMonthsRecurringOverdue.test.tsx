// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Task, Profile } from "@/types";
import type { ID } from "@/types/common";

const mockUseAuth = vi.fn();
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockUseAuth() }));

// Expose the STATUS of each row the dashboard hands to ClientTable so we can
// assert whether a completed recurring slot leaks back in as Overdue.
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
  id: "p1", username: "tamil", full_name: "Tamil", email: "t@x.com",
  manager_ids: null, avatar_color: null, orgs: [], highest_role: "admin",
} as unknown as Profile;

// A monthly "DB Update - Monthly" series with two materialised children:
//  - a MAY child (stored two months before "today"), and
//  - a JUNE child (stored last month) that was COMPLETED in its own cycle.
// On July 1 both project onto the same most-recent-past cycle (June 10). The
// June child keeps its completion (Ontime/Delay); the May child projected onto
// June has its completion blanked → Overdue. Collapse should keep the completed
// one — but only if it survives the "past months → keep only Overdue" filter.
const base: Omit<Task, "id" | "serialNo" | "targetDate" | "completedDate"> = {
  client: "Focus",
  category: "DB Update - Monthly",
  description: "DB Submission to Client",
  status: "Overdue",
  expectedDate: "",
  responsible: "Tamil",
  reportingManager: "Gunasekaran M",
  remarks: "",
  recurrence: "Monthly",
  organization: "org-1",
  createdBy: null,
  createdAt: null,
  parentId: "goal-db" as ID,
} as unknown as Omit<Task, "id" | "serialNo" | "targetDate" | "completedDate">;

const mayChild: Task = {
  ...base,
  id: "db-may" as ID,
  serialNo: 5001,
  targetDate: "2026-05-10",
  completedDate: "2026-05-12", // completed in the MAY cycle
} as Task;

const juneChild: Task = {
  ...base,
  id: "db-june" as ID,
  serialNo: 5084,
  targetDate: "2026-06-10",
  completedDate: "2026-06-11", // completed in the JUNE cycle
} as Task;

beforeEach(() => {
  cleanup();
  vi.useFakeTimers();
  // Pin "today" to 2026-07-01 so the most-recent-past monthly cycle is June.
  vi.setSystemTime(new Date(2026, 6, 1, 12, 0, 0));
  mockUseAuth.mockReset();
  mockUseAuth.mockReturnValue({ isAdminInAny: () => true, isManagerInAny: () => false });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DashboardPage — All Months view of a completed recurring series", () => {
  it("does NOT surface a completed monthly slot as Overdue in the All-Months view", () => {
    // Default period is "" (All Months).
    render(
      <DashboardPage tasks={[mayChild, juneChild]} profile={profile} profiles={[profile]} />,
    );
    const rows = screen.queryAllByTestId(/^client-row-db-/);
    const statuses = rows.map((r) => r.textContent);
    expect(statuses).not.toContain("Overdue");
  });
});
