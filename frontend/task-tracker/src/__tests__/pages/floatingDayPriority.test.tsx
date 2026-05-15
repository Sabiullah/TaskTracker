// @vitest-environment jsdom
import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Profile } from "@/types/auth";

const useMyTodayStandupMock = vi.fn();

vi.mock("@/hooks/useMyTodayStandup", () => ({
  useMyTodayStandup: (id: string | null) => useMyTodayStandupMock(id),
}));

import FloatingDayPriority from "@/pages/FloatingDayPriority";

const profile: Profile = {
  id: "p1",
  username: "alice",
  full_name: "Alice",
  email: "a@x.com",
  manager_ids: null,
  avatar_color: null,
  orgs: [],
  highest_role: "employee",
};

beforeEach(() => {
  cleanup();
  useMyTodayStandupMock.mockReset();
  localStorage.clear();
});

describe("FloatingDayPriority — collapsed icon", () => {
  it("renders the floating button when profile is present", () => {
    useMyTodayStandupMock.mockReturnValue({ entry: null, loading: false, refresh: vi.fn() });
    render(<FloatingDayPriority profile={profile} onNavigateToPace={vi.fn()} />);
    expect(screen.getByRole("button", { name: /my priorities today/i })).toBeTruthy();
  });

  it("renders nothing when profile is null", () => {
    useMyTodayStandupMock.mockReturnValue({ entry: null, loading: false, refresh: vi.fn() });
    const { container } = render(
      <FloatingDayPriority profile={null} onNavigateToPace={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("status dot is grey when no entry", () => {
    useMyTodayStandupMock.mockReturnValue({ entry: null, loading: false, refresh: vi.fn() });
    render(<FloatingDayPriority profile={profile} onNavigateToPace={vi.fn()} />);
    const dot = screen.getByTestId("day-priority-status-dot");
    expect(dot.getAttribute("data-status")).toBe("none");
  });

  it("status dot is amber for Pending entry", () => {
    useMyTodayStandupMock.mockReturnValue({
      entry: { status: "Pending", priorities: "x" },
      loading: false,
      refresh: vi.fn(),
    });
    render(<FloatingDayPriority profile={profile} onNavigateToPace={vi.fn()} />);
    expect(screen.getByTestId("day-priority-status-dot").getAttribute("data-status")).toBe("pending");
  });

  it("status dot is green for Approved entry", () => {
    useMyTodayStandupMock.mockReturnValue({
      entry: { status: "Approved", priorities: "x" },
      loading: false,
      refresh: vi.fn(),
    });
    render(<FloatingDayPriority profile={profile} onNavigateToPace={vi.fn()} />);
    expect(screen.getByTestId("day-priority-status-dot").getAttribute("data-status")).toBe("approved");
  });
});
