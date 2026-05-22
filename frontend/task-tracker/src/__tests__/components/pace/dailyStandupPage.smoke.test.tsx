// @vitest-environment jsdom
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import DailyStandupPage from "@/pages/DailyStandupPage";

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(async (url: string) => {
    if (url.startsWith("/operational_standups/?month=")) {
      return [
        {
          id: 1,
          uid: "s1",
          profile: "u1",
          profile_detail: { id: 1, uid: "u1", full_name: "Alice", username: "alice" },
          standup_date: "2026-05-04",
          breakthrough_type: "Breakthrough",
          priorities: "Build the matrix view",
          collaboration_need: "",
          remarks: "",
          created_by_detail: null,
          approvals: [],
          created_at: "",
          updated_at: "",
        },
      ];
    }
    if (url.startsWith("/operational_standups/roster/")) {
      return [
        {
          profile: { id: 1, uid: "u1", full_name: "Alice", username: "alice" },
          entry: null,
          approvals: [],
          can_edit: true,
        },
      ];
    }
    if (url.startsWith("/attendance/matrix/")) {
      return {
        employees: [{ uid: "u1", full_name: "Alice", org_uids: ["o1"] }],
        dates: [
          { date: "2026-05-04", weekday: "Mon", is_holiday: false, is_override: false, holiday_name: null },
        ],
        cells: { u1: { "2026-05-04": { code: "P" } } },
      };
    }
    return [];
  }),
  apiPost: vi.fn(async () => ({})),
  apiPatch: vi.fn(async () => ({})),
  ApiError: class ApiError extends Error {},
  ws: { subscribe: () => () => {} },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    isAdminInAny: () => false,
    isManagerInAny: () => false,
  }),
}));

beforeEach(() => cleanup());

describe("DailyStandupPage", () => {
  it("renders title and date sections in default List view", async () => {
    render(<DailyStandupPage profile={null} profiles={[]} selectedOrg="" />);
    await waitFor(() => {
      expect(screen.getByText(/Daily Standup/i)).toBeTruthy();
    });
  });

  it("shows List and Matrix toggle buttons", async () => {
    render(<DailyStandupPage profile={null} profiles={[]} selectedOrg="" />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^List$/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /^Matrix$/i })).toBeTruthy();
    });
  });

  it("switches to the matrix view and renders an employee row when Matrix is clicked", async () => {
    render(<DailyStandupPage profile={null} profiles={[]} selectedOrg="" />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Matrix$/i })).toBeTruthy();
    });
    // List view should NOT render priorities text from the matrix.
    expect(screen.queryByText("Build the matrix view")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Matrix$/i }));
    await waitFor(() => {
      expect(screen.getByText("Build the matrix view")).toBeTruthy();
      expect(screen.getByText("Alice")).toBeTruthy();
    });
  });
});
