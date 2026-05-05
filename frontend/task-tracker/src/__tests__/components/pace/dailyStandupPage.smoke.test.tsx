// @vitest-environment jsdom
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import DailyStandupPage from "@/pages/DailyStandupPage";

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(async (url: string) => {
    if (url.startsWith("/operational_standups/?month=")) return [];
    if (url.startsWith("/operational_standups/roster/")) {
      return [
        {
          profile: { id: 1, uid: "u1", full_name: "Alice", username: "alice" },
          org_uid: "o1",
          org_name: "4D",
          entry: null,
          can_edit: true,
          can_approve: false,
        },
      ];
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

beforeEach(() => {
  cleanup();
});

describe("DailyStandupPage", () => {
  it("renders title and date sections", async () => {
    render(<DailyStandupPage profile={null} profiles={[]} selectedOrg="" />);
    await waitFor(() => {
      expect(screen.getByText(/Daily Standup/i)).toBeTruthy();
    });
  });
});
