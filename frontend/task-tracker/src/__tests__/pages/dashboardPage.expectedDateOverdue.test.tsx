// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import type { Task, Profile } from "@/types";
import type { ID } from "@/types/common";

const mockUseAuth = vi.fn();
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("@/components/dashboard/TeamTable", () => ({
  default: () => <div data-testid="team-table" />,
}));
vi.mock("@/components/dashboard/ClientTable", () => ({
  default: () => <div data-testid="client-table" />,
}));
vi.mock("@/components/dashboard/StatusDist", () => ({
  default: () => <div data-testid="status-dist" />,
}));
vi.mock("@/components/dashboard/TaskDetailTable", () => ({
  default: ({
    tasks,
    title,
  }: {
    tasks: Task[];
    title?: ReactNode;
  }) => (
    <div data-testid="task-detail-table">
      <div data-testid="task-detail-title">{title}</div>
      {tasks.map((t) => (
        <div key={t.id} data-testid={`row-${t.id}`}>{t.description}</div>
      ))}
    </div>
  ),
}));
vi.mock("@/components/dashboard/ReportView", () => ({
  default: () => <div data-testid="report-view" />,
}));

import DashboardPage from "@/pages/DashboardPage";

const profile: Profile = {
  id: "p1",
  username: "alice",
  full_name: "Alice",
  email: "a@x.com",
  manager_ids: null,
  avatar_color: null,
  orgs: [],
  highest_role: "admin",
} as unknown as Profile;

const today = new Date();
today.setHours(0, 0, 0, 0);
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  return iso(d);
};
const daysAhead = (n: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() + n);
  return iso(d);
};

const taskBase: Task = {
  id: "t-base" as ID,
  serialNo: 1,
  client: "Acme",
  category: "Audit",
  description: "task",
  status: "Pending",
  targetDate: "",
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

// Fixture: 3 rows, one per "of interest" bucket combination.
//   row-no-exp:    targetDate past, expectedDate empty       → Per Target + No Expected Set
//   row-past-exp:  targetDate past, expectedDate past        → Per Target + Past Expected Date
//   row-future-exp: targetDate past, expectedDate in future  → Per Target only
const tasks: Task[] = [
  { ...taskBase, id: "row-no-exp" as ID, description: "no-exp", targetDate: daysAgo(10), status: "Overdue", expectedDate: "" },
  { ...taskBase, id: "row-past-exp" as ID, description: "past-exp", targetDate: daysAgo(10), status: "Overdue", expectedDate: daysAgo(2) },
  { ...taskBase, id: "row-future-exp" as ID, description: "future-exp", targetDate: daysAgo(10), status: "Overdue", expectedDate: daysAhead(3) },
];

beforeEach(() => {
  cleanup();
  mockUseAuth.mockReset();
  mockUseAuth.mockReturnValue({
    isAdminInAny: () => true,
    isManagerInAny: () => false,
  });
});

describe("DashboardPage — Overdue drill-down (default tab = Per Target)", () => {
  it("clicking the Overdue stat card opens the drill-down with all three Per-Target rows", () => {
    render(<DashboardPage tasks={tasks} profile={profile} profiles={[profile]} />);

    const overdueLabel = screen.getByText("Overdue");
    fireEvent.click(overdueLabel.closest(".dm-stat-card") as HTMLElement);

    const table = screen.getByTestId("task-detail-table");
    expect(within(table).getByTestId("row-row-no-exp")).toBeTruthy();
    expect(within(table).getByTestId("row-row-past-exp")).toBeTruthy();
    expect(within(table).getByTestId("row-row-future-exp")).toBeTruthy();
  });

  it("renders three tabs with correct counts", () => {
    render(<DashboardPage tasks={tasks} profile={profile} profiles={[profile]} />);
    fireEvent.click(screen.getByText("Overdue").closest(".dm-stat-card") as HTMLElement);

    expect(screen.getByRole("button", { name: /Per Target.*\(3\)/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Past Expected Date.*\(1\)/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /No Expected Set.*\(1\)/ })).toBeTruthy();
  });

  it("clicking 'Past Expected Date' tab shows only the past-expected row", () => {
    render(<DashboardPage tasks={tasks} profile={profile} profiles={[profile]} />);
    fireEvent.click(screen.getByText("Overdue").closest(".dm-stat-card") as HTMLElement);

    fireEvent.click(screen.getByRole("button", { name: /Past Expected Date/ }));

    const table = screen.getByTestId("task-detail-table");
    expect(within(table).queryByTestId("row-row-no-exp")).toBeNull();
    expect(within(table).getByTestId("row-row-past-exp")).toBeTruthy();
    expect(within(table).queryByTestId("row-row-future-exp")).toBeNull();
  });

  it("clicking 'No Expected Set' tab shows only the no-exp row", () => {
    render(<DashboardPage tasks={tasks} profile={profile} profiles={[profile]} />);
    fireEvent.click(screen.getByText("Overdue").closest(".dm-stat-card") as HTMLElement);

    fireEvent.click(screen.getByRole("button", { name: /No Expected Set/ }));

    const table = screen.getByTestId("task-detail-table");
    expect(within(table).getByTestId("row-row-no-exp")).toBeTruthy();
    expect(within(table).queryByTestId("row-row-past-exp")).toBeNull();
    expect(within(table).queryByTestId("row-row-future-exp")).toBeNull();
  });

  it("active tab is visually highlighted (red background)", () => {
    render(<DashboardPage tasks={tasks} profile={profile} profiles={[profile]} />);
    fireEvent.click(screen.getByText("Overdue").closest(".dm-stat-card") as HTMLElement);

    const perTarget = screen.getByRole("button", { name: /Per Target/ });
    expect((perTarget as HTMLElement).style.background).toMatch(/#dc2626|rgb\(220,\s*38,\s*38\)/i);

    fireEvent.click(screen.getByRole("button", { name: /Past Expected Date/ }));
    const pastExpected = screen.getByRole("button", { name: /Past Expected Date/ });
    expect((pastExpected as HTMLElement).style.background).toMatch(/#dc2626|rgb\(220,\s*38,\s*38\)/i);
  });
});
