// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { Task, Profile } from "@/types";

const mockUseAuth = vi.fn();
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

// Stub heavy children — they query data we don't care about for filter-bar tests.
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

const profile = (
  id: string,
  full_name: string,
  manager_ids: string[] | null = null,
): Profile =>
  ({
    id,
    username: full_name.toLowerCase(),
    email: `${full_name.toLowerCase()}@x.com`,
    full_name,
    manager_ids,
    avatar_color: null,
    orgs: [],
    highest_role: "employee",
  }) as unknown as Profile;

const task = (responsible: string, id = `t-${responsible}`): Task =>
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
    reportingManager: "",
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
  it("admin sees the Reporting Manager dropdown when at least one manager exists", () => {
    setRole("admin");
    const profiles = [
      profile("1", "Alice"),
      profile("2", "Bob", ["1"]),
    ];
    render(
      <DashboardPage
        tasks={[task("Alice"), task("Bob")]}
        profile={profiles[0]}
        profiles={profiles}
      />,
    );
    expect(screen.getByDisplayValue("All Reporting Managers")).toBeTruthy();
  });

  it("admin does not see the dropdown when no profile has manager_ids", () => {
    setRole("admin");
    const profiles = [profile("1", "Alice"), profile("2", "Bob")];
    render(
      <DashboardPage
        tasks={[task("Alice")]}
        profile={profiles[0]}
        profiles={profiles}
      />,
    );
    expect(screen.queryByDisplayValue("All Reporting Managers")).toBeNull();
  });

  it("picking a Reporting Manager filters TeamTable to the sub-tree and disables Member", () => {
    setRole("admin");
    const profiles = [
      profile("1", "Alice"),
      profile("2", "Bob", ["1"]),     // reports to Alice
      profile("3", "Carol", ["1"]),   // reports to Alice
      profile("4", "Dave"),           // unrelated
    ];
    render(
      <DashboardPage
        tasks={[task("Alice"), task("Bob"), task("Carol"), task("Dave")]}
        profile={profiles[0]}
        profiles={profiles}
      />,
    );
    const rmSelect = screen.getByDisplayValue("All Reporting Managers") as HTMLSelectElement;
    fireEvent.change(rmSelect, { target: { value: "1" } });

    // TeamTable should now only see Alice's sub-tree
    const team = screen.getByTestId("team-table").textContent ?? "";
    const names = new Set(team.split(",").filter(Boolean));
    expect(names.has("Alice")).toBe(true);
    expect(names.has("Bob")).toBe(true);
    expect(names.has("Carol")).toBe(true);
    expect(names.has("Dave")).toBe(false);

    // Member dropdown is disabled
    const memberSelect = screen.getByDisplayValue("All Members") as HTMLSelectElement;
    expect(memberSelect.disabled).toBe(true);
  });

  it("clearing the RM re-enables the Member dropdown", () => {
    setRole("admin");
    const profiles = [profile("1", "Alice"), profile("2", "Bob", ["1"])];
    render(
      <DashboardPage
        tasks={[task("Alice"), task("Bob")]}
        profile={profiles[0]}
        profiles={profiles}
      />,
    );
    const rmSelect = screen.getByDisplayValue("All Reporting Managers") as HTMLSelectElement;
    fireEvent.change(rmSelect, { target: { value: "1" } });
    fireEvent.change(rmSelect, { target: { value: "" } });
    const memberSelect = screen.getByDisplayValue("All Members") as HTMLSelectElement;
    expect(memberSelect.disabled).toBe(false);
  });

  it("manager logged in with no sub-managers does not see the dropdown", () => {
    setRole("manager");
    const profiles = [
      profile("1", "Alice"),               // the logged-in manager
      profile("2", "Bob", ["1"]),          // IC reporting to Alice
      profile("3", "Carol", ["1"]),        // IC reporting to Alice
    ];
    render(
      <DashboardPage
        tasks={[task("Alice"), task("Bob"), task("Carol")]}
        profile={profiles[0]}
        profiles={profiles}
      />,
    );
    expect(screen.queryByDisplayValue("All Reporting Managers")).toBeNull();
  });

  it("manager picking a sub-manager sees the sub-manager's full sub-tree (incl. indirect reports)", () => {
    // Alice is the logged-in manager. Bob is her direct report and a sub-manager.
    // Carol reports to Bob (indirect report of Alice).
    // The default manager view restricts Alice to her direct reports — without
    // bypassing role-gating when an RM is set, Carol's tasks would be hidden.
    setRole("manager");
    const profiles = [
      profile("1", "Alice"),
      profile("2", "Bob", ["1"]),
      profile("3", "Carol", ["2"]),
      profile("4", "Dave"), // unrelated peer
    ];
    render(
      <DashboardPage
        tasks={[task("Alice"), task("Bob"), task("Carol"), task("Dave")]}
        profile={profiles[0]}
        profiles={profiles}
      />,
    );
    const rmSelect = screen.getByDisplayValue("All Reporting Managers") as HTMLSelectElement;
    // Bob (id 2) is the only sub-manager under Alice — picking Bob should
    // expand the dashboard to Bob's sub-tree (Bob + Carol).
    fireEvent.change(rmSelect, { target: { value: "2" } });

    const team = screen.getByTestId("team-table").textContent ?? "";
    const names = new Set(team.split(",").filter(Boolean));
    expect(names.has("Bob")).toBe(true);
    expect(names.has("Carol")).toBe(true);
    expect(names.has("Alice")).toBe(false);
    expect(names.has("Dave")).toBe(false);
  });
});
