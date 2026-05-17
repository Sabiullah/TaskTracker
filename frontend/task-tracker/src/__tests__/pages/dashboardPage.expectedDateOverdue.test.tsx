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

// Mocks expose the rows the dashboard passes to each summary widget so we can
// assert the bucket filter has narrowed them.
vi.mock("@/components/dashboard/TeamTable", () => ({
  default: ({ tasks }: { tasks: Task[] }) => (
    <div data-testid="team-table">
      {tasks.map((t) => (
        <div key={t.id} data-testid={`team-row-${t.id}`}>{t.responsible}</div>
      ))}
    </div>
  ),
}));
vi.mock("@/components/dashboard/ClientTable", () => ({
  default: ({ tasks }: { tasks: Task[] }) => (
    <div data-testid="client-table">
      {tasks.map((t) => (
        <div key={t.id} data-testid={`client-row-${t.id}`}>{t.client}</div>
      ))}
    </div>
  ),
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
//   row-no-exp:     targetDate past, expectedDate empty       → Overdue + No Expected Set
//   row-past-exp:   targetDate past, expectedDate past        → Overdue + Past Expected
//   row-future-exp: targetDate past, expectedDate in future   → Overdue only (Per Target)
const tasks: Task[] = [
  { ...taskBase, id: "row-no-exp" as ID, description: "no-exp", client: "Focus", responsible: "Alice", targetDate: daysAgo(10), status: "Overdue", expectedDate: "" },
  { ...taskBase, id: "row-past-exp" as ID, description: "past-exp", client: "Zoom Fashion", responsible: "Bob", targetDate: daysAgo(10), status: "Overdue", expectedDate: daysAgo(2) },
  { ...taskBase, id: "row-future-exp" as ID, description: "future-exp", client: "Moon Mart", responsible: "Carol", targetDate: daysAgo(10), status: "Overdue", expectedDate: daysAhead(3) },
];

beforeEach(() => {
  cleanup();
  mockUseAuth.mockReset();
  mockUseAuth.mockReturnValue({
    isAdminInAny: () => true,
    isManagerInAny: () => false,
  });
});

describe("DashboardPage — Overdue View filter bar dropdown", () => {
  it("renders the 'All Overdue Views' dropdown when at least one row has status='Overdue' or expectedDate set", () => {
    render(<DashboardPage tasks={tasks} profile={profile} profiles={[profile]} />);
    expect(screen.getByDisplayValue("All Overdue Views")).toBeTruthy();
  });

  it("does NOT render the dropdown when no row has status='Overdue' or expectedDate", () => {
    const clean: Task[] = [
      { ...taskBase, id: "clean" as ID, status: "Pending", targetDate: daysAhead(5), expectedDate: "" },
    ];
    render(<DashboardPage tasks={clean} profile={profile} profiles={[profile]} />);
    expect(screen.queryByDisplayValue("All Overdue Views")).toBeNull();
  });

  it("default 'All' filter: Team and Client tables receive all 3 fixture rows", () => {
    render(<DashboardPage tasks={tasks} profile={profile} profiles={[profile]} />);

    const team = screen.getByTestId("team-table");
    expect(within(team).getByTestId("team-row-row-no-exp")).toBeTruthy();
    expect(within(team).getByTestId("team-row-row-past-exp")).toBeTruthy();
    expect(within(team).getByTestId("team-row-row-future-exp")).toBeTruthy();

    const client = screen.getByTestId("client-table");
    expect(within(client).getByTestId("client-row-row-no-exp")).toBeTruthy();
    expect(within(client).getByTestId("client-row-row-past-exp")).toBeTruthy();
    expect(within(client).getByTestId("client-row-row-future-exp")).toBeTruthy();
  });

  it("'Past Expected Date' filter narrows Team and Client tables to the past-expected row only", () => {
    render(<DashboardPage tasks={tasks} profile={profile} profiles={[profile]} />);
    const dropdown = screen.getByDisplayValue("All Overdue Views") as HTMLSelectElement;
    fireEvent.change(dropdown, { target: { value: "expected" } });

    const team = screen.getByTestId("team-table");
    expect(within(team).queryByTestId("team-row-row-no-exp")).toBeNull();
    expect(within(team).getByTestId("team-row-row-past-exp")).toBeTruthy();
    expect(within(team).queryByTestId("team-row-row-future-exp")).toBeNull();

    const client = screen.getByTestId("client-table");
    expect(within(client).queryByTestId("client-row-row-no-exp")).toBeNull();
    expect(within(client).getByTestId("client-row-row-past-exp")).toBeTruthy();
    expect(within(client).queryByTestId("client-row-row-future-exp")).toBeNull();
  });

  it("'No Expected Set' filter narrows Team and Client tables to the no-exp row only", () => {
    render(<DashboardPage tasks={tasks} profile={profile} profiles={[profile]} />);
    const dropdown = screen.getByDisplayValue("All Overdue Views") as HTMLSelectElement;
    fireEvent.change(dropdown, { target: { value: "no-expected" } });

    const team = screen.getByTestId("team-table");
    expect(within(team).getByTestId("team-row-row-no-exp")).toBeTruthy();
    expect(within(team).queryByTestId("team-row-row-past-exp")).toBeNull();
    expect(within(team).queryByTestId("team-row-row-future-exp")).toBeNull();

    const client = screen.getByTestId("client-table");
    expect(within(client).getByTestId("client-row-row-no-exp")).toBeTruthy();
    expect(within(client).queryByTestId("client-row-row-past-exp")).toBeNull();
    expect(within(client).queryByTestId("client-row-row-future-exp")).toBeNull();
  });

  it("Clear button resets fOverdueView along with the other filters", () => {
    render(<DashboardPage tasks={tasks} profile={profile} profiles={[profile]} />);
    const dropdown = screen.getByDisplayValue("All Overdue Views") as HTMLSelectElement;
    fireEvent.change(dropdown, { target: { value: "expected" } });

    fireEvent.click(screen.getByRole("button", { name: /Clear/ }));

    const dropdownAfter = screen.getByDisplayValue("All Overdue Views") as HTMLSelectElement;
    expect(dropdownAfter.value).toBe("");

    // And the summary tables are back to showing all rows.
    const team = screen.getByTestId("team-table");
    expect(within(team).getByTestId("team-row-row-no-exp")).toBeTruthy();
    expect(within(team).getByTestId("team-row-row-past-exp")).toBeTruthy();
    expect(within(team).getByTestId("team-row-row-future-exp")).toBeTruthy();
  });
});

describe("DashboardPage — Overdue card drill-down (still works)", () => {
  it("clicking the Overdue stat card shows the Per-Target task list", () => {
    render(<DashboardPage tasks={tasks} profile={profile} profiles={[profile]} />);

    const overdueLabel = screen.getByText("Overdue");
    fireEvent.click(overdueLabel.closest(".dm-stat-card") as HTMLElement);

    const table = screen.getByTestId("task-detail-table");
    expect(within(table).getByTestId("row-row-no-exp")).toBeTruthy();
    expect(within(table).getByTestId("row-row-past-exp")).toBeTruthy();
    expect(within(table).getByTestId("row-row-future-exp")).toBeTruthy();
  });

  it("with the bar filter active, drill-down reflects the intersection (bucket ∩ Per Target)", () => {
    render(<DashboardPage tasks={tasks} profile={profile} profiles={[profile]} />);
    const dropdown = screen.getByDisplayValue("All Overdue Views") as HTMLSelectElement;
    fireEvent.change(dropdown, { target: { value: "expected" } });

    fireEvent.click(screen.getByText("Overdue").closest(".dm-stat-card") as HTMLElement);

    const table = screen.getByTestId("task-detail-table");
    expect(within(table).queryByTestId("row-row-no-exp")).toBeNull();
    expect(within(table).getByTestId("row-row-past-exp")).toBeTruthy();
    expect(within(table).queryByTestId("row-row-future-exp")).toBeNull();
  });
});
