// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { Task, Profile } from "@/types";

const mockUseAuth = vi.fn();
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("@/components/dashboard/TeamTable", () => ({
  default: ({ teamNames }: { teamNames: string[] }) => (
    <div data-testid="team-table">{teamNames.join(",")}</div>
  ),
}));
vi.mock("@/components/dashboard/ClientTable", () => ({
  default: () => <div data-testid="client-table" />,
}));
vi.mock("@/components/dashboard/StatusDist", () => ({
  default: () => <div data-testid="status-dist" />,
}));
vi.mock("@/components/dashboard/TaskDetailTable", () => ({
  default: () => <div data-testid="task-detail-table" />,
}));
vi.mock("@/components/dashboard/RecentCompletions", () => ({
  default: () => <div data-testid="recent-completions" />,
}));
vi.mock("@/components/dashboard/ReportView", () => ({
  default: () => <div data-testid="report-view" />,
}));

import DashboardPage from "@/pages/DashboardPage";

function setRole(role: "admin" | "manager" | "user") {
  mockUseAuth.mockReturnValue({
    isAdminInAny: () => role === "admin",
    isManagerInAny: () => role === "admin" || role === "manager",
  });
}

const profile = (id: string, full_name: string): Profile =>
  ({
    id,
    username: full_name.toLowerCase(),
    email: `${full_name.toLowerCase()}@x.com`,
    full_name,
    manager_ids: null,
    avatar_color: null,
    orgs: [],
    highest_role: "employee",
  }) as unknown as Profile;

const task = (
  responsible: string,
  reportingManager: string,
  id = `t-${responsible}-${reportingManager}`,
): Task =>
  ({
    id,
    serialNo: 1,
    client: "Acme",
    category: "Audit",
    description: "x",
    status: "Pending",
    targetDate: "",
    expectedDate: "",
    completedDate: "",
    responsible,
    reportingManager,
    remarks: "",
    recurrence: "Onetime",
    organization: "org-1",
    createdBy: null,
    createdAt: null,
  }) as unknown as Task;

beforeEach(() => {
  cleanup();
  mockUseAuth.mockReset();
});

describe("DashboardPage — Reporting Manager filter", () => {
  it("admin sees the Reporting Manager dropdown when at least one task has an RM", () => {
    setRole("admin");
    const profiles = [profile("1", "Alice"), profile("2", "Bob")];
    render(
      <DashboardPage
        tasks={[task("Alice", "Bob"), task("Bob", "")]}
        profile={profiles[0]}
        profiles={profiles}
      />,
    );
    expect(screen.getByDisplayValue("All Reporting Managers")).toBeTruthy();
  });

  it("admin does not see the dropdown when no task has a Reporting Manager", () => {
    setRole("admin");
    const profiles = [profile("1", "Alice"), profile("2", "Bob")];
    render(
      <DashboardPage
        tasks={[task("Alice", ""), task("Bob", "")]}
        profile={profiles[0]}
        profiles={profiles}
      />,
    );
    expect(screen.queryByDisplayValue("All Reporting Managers")).toBeNull();
  });

  it("dropdown lists distinct reporting-manager names from tasks", () => {
    setRole("admin");
    const profiles = [profile("1", "Alice")];
    render(
      <DashboardPage
        tasks={[
          task("Alice", "Sabiullah"),
          task("Bob", "Sabiullah"),
          task("Carol", "Akilan"),
          task("Dave", ""),
        ]}
        profile={profiles[0]}
        profiles={profiles}
      />,
    );
    const rmSelect = screen.getByDisplayValue(
      "All Reporting Managers",
    ) as HTMLSelectElement;
    const labels = Array.from(rmSelect.options).map((o) => o.textContent ?? "");
    expect(labels).toContain("All Reporting Managers");
    expect(labels).toContain("Sabiullah");
    expect(labels).toContain("Akilan");
    expect(labels).toHaveLength(3);
  });

  it("picking a Reporting Manager filters TeamTable to tasks with that RM", () => {
    setRole("admin");
    const profiles = [profile("1", "Alice")];
    render(
      <DashboardPage
        tasks={[
          task("Alice", "Sabiullah"),
          task("Bob", "Sabiullah"),
          task("Carol", "Akilan"),
          task("Dave", ""),
        ]}
        profile={profiles[0]}
        profiles={profiles}
      />,
    );
    const rmSelect = screen.getByDisplayValue(
      "All Reporting Managers",
    ) as HTMLSelectElement;
    fireEvent.change(rmSelect, { target: { value: "Sabiullah" } });

    const team = screen.getByTestId("team-table").textContent ?? "";
    const names = new Set(team.split(",").filter(Boolean));
    expect(names.has("Alice")).toBe(true);
    expect(names.has("Bob")).toBe(true);
    expect(names.has("Carol")).toBe(false);
    expect(names.has("Dave")).toBe(false);
  });

  it("Reporting Manager and Member filters compose (intersection)", () => {
    setRole("admin");
    const profiles = [profile("1", "Alice")];
    render(
      <DashboardPage
        tasks={[
          task("Alice", "Sabiullah"),
          task("Bob", "Sabiullah"),
          task("Alice", "Akilan"),
        ]}
        profile={profiles[0]}
        profiles={profiles}
      />,
    );
    const rmSelect = screen.getByDisplayValue(
      "All Reporting Managers",
    ) as HTMLSelectElement;
    const memberSelect = screen.getByDisplayValue(
      "All Members",
    ) as HTMLSelectElement;

    fireEvent.change(rmSelect, { target: { value: "Sabiullah" } });
    fireEvent.change(memberSelect, { target: { value: "Alice" } });

    const team = screen.getByTestId("team-table").textContent ?? "";
    const names = new Set(team.split(",").filter(Boolean));
    expect(names.has("Alice")).toBe(true);
    expect(names.has("Bob")).toBe(false);
    expect(memberSelect.disabled).toBe(false);
  });

  it("regular user sees the dropdown when their visible tasks include an RM", () => {
    setRole("user");
    const profiles = [profile("1", "Alice")];
    render(
      <DashboardPage
        tasks={[task("Alice", "Sabiullah")]}
        profile={profiles[0]}
        profiles={profiles}
      />,
    );
    expect(screen.getByDisplayValue("All Reporting Managers")).toBeTruthy();
  });
});
