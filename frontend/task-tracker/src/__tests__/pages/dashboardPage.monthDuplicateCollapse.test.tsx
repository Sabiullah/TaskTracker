// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Task, Profile } from "@/types";
import type { ID } from "@/types/common";

const mockUseAuth = vi.fn();
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => mockUseAuth() }));

vi.mock("@/components/dashboard/ClientTable", () => ({
  default: ({ tasks }: { tasks: Task[] }) => (
    <div data-testid="client-table">
      {tasks.map((t) => (
        <div key={t.id} data-testid={`client-row-${t.id}`}>
          {t.targetDate}
        </div>
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
  id: "p1", username: "swathi", full_name: "Swathi", email: "s@x.com",
  manager_ids: null, avatar_color: null, orgs: [], highest_role: "admin",
} as unknown as Profile;

// A monthly goal that ended up with TWO "Book Review" children in the same
// month at different days — a master plan (day 10) and a hand-typed free-entry
// twin (day 15). The Board shows one card (per goal); before the fix the
// Dashboard listed both raw rows. Cadenced series must collapse by month.
const base: Omit<Task, "id" | "serialNo" | "targetDate" | "category"> = {
  client: "Lily Aura",
  description: "Book Review",
  status: "Overdue",
  expectedDate: "",
  completedDate: "",
  responsible: "Swathi",
  reportingManager: "Akilan",
  remarks: "",
  recurrence: "Monthly",
  organization: "org-1",
  createdBy: null,
  createdAt: null,
  parentId: "goal-bk" as ID,
} as unknown as Omit<Task, "id" | "serialNo" | "targetDate" | "category">;

const masterChild: Task = {
  ...base,
  id: "br-master" as ID,
  serialNo: 2836,
  category: "Book Review",
  targetDate: "2026-07-10",
} as Task;

const freeChild: Task = {
  ...base,
  id: "br-free" as ID,
  serialNo: 2822,
  category: "", // free-entry child carries its name in `description`
  targetDate: "2026-07-15",
} as Task;

beforeEach(() => {
  cleanup();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 6, 20, 12, 0, 0)); // 2026-07-20
  mockUseAuth.mockReset();
  mockUseAuth.mockReturnValue({ isAdminInAny: () => true, isManagerInAny: () => false });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DashboardPage — same-month cadenced duplicate", () => {
  it("collapses two monthly 'Book Review' children in the same month to one row", () => {
    render(
      <DashboardPage tasks={[masterChild, freeChild]} profile={profile} profiles={[profile]} />,
    );
    const rows = screen.queryAllByTestId(/^client-row-br-/);
    expect(rows).toHaveLength(1);
  });
});
