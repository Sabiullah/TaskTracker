// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { Task, HeaderFilters } from "@/types";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    isAdminInAny: () => true,
  }),
}));

vi.mock("@/hooks/useMasters", () => ({
  useMasters: () => ({ clients: [], cats: [] }),
}));

vi.mock("@/components/header/NavMenu", () => ({
  default: () => <div data-testid="nav-menu" />,
}));
vi.mock("@/components/header/OrgFilter", () => ({
  default: () => <div data-testid="org-filter" />,
}));
vi.mock("@/components/header/RestoreModal", () => ({
  default: () => null,
}));
vi.mock("@/components/header/ImportModal", () => ({
  default: () => null,
}));

import Header from "@/components/layout/Header";

const baseFilters: HeaderFilters = {
  client: "",
  category: "",
  responsible: "",
  reportingManager: "",
};

const task = (id: string, reportingManager: string): Task =>
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
    responsible: "Alice",
    reportingManager,
    remarks: "",
    recurrence: "Onetime",
    organization: "org-1",
    createdBy: null,
    createdAt: null,
    parentId: null,
  }) as unknown as Task;

function renderHeader(opts: {
  tasks?: Task[];
  filters?: HeaderFilters;
  onFiltersChange?: (
    updater: (prev: HeaderFilters) => HeaderFilters,
  ) => void;
}) {
  const props = {
    view: "board",
    onViewChange: () => {},
    search: "",
    onSearchChange: () => {},
    filters: opts.filters ?? baseFilters,
    onFiltersChange: opts.onFiltersChange ?? (() => {}),
    onAddTask: () => {},
    onImport: () => {},
    tasks: opts.tasks ?? [],
    profile: null,
    onSignOut: () => {},
    onOpenAdmin: () => {},
    adminEmployee: "",
    onClearAdminFilter: () => {},
    theme: "light",
    onToggleTheme: () => {},
    memberOptions: [],
    navVisible: {},
    hasAttendanceAccess: false,
    hasEmployeeAccess: false,
    selectedOrg: "",
    onOrgChange: () => {},
  };
  return render(<Header {...props} />);
}

beforeEach(() => {
  cleanup();
});

describe("Header — Reporting Manager filter", () => {
  it("renders the All Reporting Managers select on the board toolbar", () => {
    renderHeader({ tasks: [task("1", "Sabiullah")] });
    expect(
      screen.getByDisplayValue("All Reporting Managers"),
    ).toBeTruthy();
  });

  it("lists distinct reporting-manager names from tasks, ignoring blanks", () => {
    renderHeader({
      tasks: [
        task("1", "Sabiullah"),
        task("2", "Sabiullah"),
        task("3", "Akilan"),
        task("4", ""),
        task("5", "   "),
      ],
    });
    const select = screen.getByDisplayValue(
      "All Reporting Managers",
    ) as HTMLSelectElement;
    const labels = Array.from(select.options).map(
      (o) => o.textContent ?? "",
    );
    // ["All Reporting Managers", "Akilan", "Sabiullah"] (alphabetical)
    expect(labels).toEqual([
      "All Reporting Managers",
      "Akilan",
      "Sabiullah",
    ]);
  });

  it("setting the Reporting Manager fires onFiltersChange with the new value", () => {
    const onFiltersChange = vi.fn();
    renderHeader({
      tasks: [task("1", "Sabiullah")],
      onFiltersChange,
    });
    const select = screen.getByDisplayValue(
      "All Reporting Managers",
    ) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "Sabiullah" } });
    expect(onFiltersChange).toHaveBeenCalled();
    const updater = onFiltersChange.mock.calls[0][0];
    expect(updater(baseFilters)).toEqual({
      ...baseFilters,
      reportingManager: "Sabiullah",
    });
  });

  it("clear button resets the Reporting Manager filter alongside the others", () => {
    const onFiltersChange = vi.fn();
    renderHeader({
      tasks: [task("1", "Sabiullah")],
      filters: { ...baseFilters, reportingManager: "Sabiullah" },
      onFiltersChange,
    });
    fireEvent.click(screen.getByText(/Clear/i));
    expect(onFiltersChange).toHaveBeenCalled();
    const updater = onFiltersChange.mock.calls[0][0];
    expect(updater({ ...baseFilters, reportingManager: "Sabiullah" })).toEqual({
      client: "",
      category: "",
      responsible: "",
      reportingManager: "",
    });
  });
});
