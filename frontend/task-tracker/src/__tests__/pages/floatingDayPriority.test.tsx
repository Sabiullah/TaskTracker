// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

afterEach(() => {
  vi.useRealTimers();
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

describe("FloatingDayPriority — panel toggle", () => {
  it("does not render the panel when closed", () => {
    useMyTodayStandupMock.mockReturnValue({ entry: null, loading: false, refresh: vi.fn() });
    render(<FloatingDayPriority profile={profile} onNavigateToPace={vi.fn()} />);
    expect(screen.queryByTestId("day-priority-panel")).toBeNull();
  });

  it("clicking the button opens the panel; clicking again closes it", () => {
    useMyTodayStandupMock.mockReturnValue({ entry: null, loading: false, refresh: vi.fn() });
    render(<FloatingDayPriority profile={profile} onNavigateToPace={vi.fn()} />);
    const btn = screen.getByRole("button", { name: /my priorities today/i });
    fireEvent.click(btn);
    expect(screen.getByTestId("day-priority-panel")).toBeTruthy();
    fireEvent.click(btn);
    expect(screen.queryByTestId("day-priority-panel")).toBeNull();
  });

  it("✕ close button closes the panel", () => {
    useMyTodayStandupMock.mockReturnValue({ entry: null, loading: false, refresh: vi.fn() });
    render(<FloatingDayPriority profile={profile} onNavigateToPace={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /my priorities today/i }));
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.queryByTestId("day-priority-panel")).toBeNull();
  });
});

describe("FloatingDayPriority — header and badge", () => {
  it("shows today's date in 'D MMM YYYY' format in the header", () => {
    useMyTodayStandupMock.mockReturnValue({ entry: null, loading: false, refresh: vi.fn() });
    vi.setSystemTime(new Date("2026-05-15T10:00:00"));
    render(<FloatingDayPriority profile={profile} onNavigateToPace={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /my priorities today/i }));
    expect(screen.getByTestId("day-priority-date").textContent).toBe("15 May 2026");
  });

  it("shows a green Approved badge when entry is Approved", () => {
    useMyTodayStandupMock.mockReturnValue({
      entry: { status: "Approved", priorities: "x" },
      loading: false,
      refresh: vi.fn(),
    });
    render(<FloatingDayPriority profile={profile} onNavigateToPace={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /my priorities today/i }));
    const badge = screen.getByTestId("day-priority-badge");
    expect(badge.textContent).toBe("Approved");
    expect(badge.getAttribute("data-status")).toBe("approved");
  });

  it("shows an amber Pending badge when entry is Pending", () => {
    useMyTodayStandupMock.mockReturnValue({
      entry: { status: "Pending", priorities: "x" },
      loading: false,
      refresh: vi.fn(),
    });
    render(<FloatingDayPriority profile={profile} onNavigateToPace={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /my priorities today/i }));
    expect(screen.getByTestId("day-priority-badge").textContent).toBe("Pending");
  });

  it("does not render a badge when entry is null", () => {
    useMyTodayStandupMock.mockReturnValue({ entry: null, loading: false, refresh: vi.fn() });
    render(<FloatingDayPriority profile={profile} onNavigateToPace={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /my priorities today/i }));
    expect(screen.queryByTestId("day-priority-badge")).toBeNull();
  });
});

describe("FloatingDayPriority — body", () => {
  it("renders priorities text with newlines preserved when entry exists", () => {
    useMyTodayStandupMock.mockReturnValue({
      entry: { status: "Pending", priorities: "first line\nsecond line" },
      loading: false,
      refresh: vi.fn(),
    });
    render(<FloatingDayPriority profile={profile} onNavigateToPace={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /my priorities today/i }));
    const body = screen.getByTestId("day-priority-body");
    expect(body.textContent).toBe("first line\nsecond line");
    expect(getComputedStyle(body).whiteSpace).toBe("pre-wrap");
  });

  it("renders empty state message and link button when no entry", () => {
    useMyTodayStandupMock.mockReturnValue({ entry: null, loading: false, refresh: vi.fn() });
    render(<FloatingDayPriority profile={profile} onNavigateToPace={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /my priorities today/i }));
    expect(screen.getByText(/no priorities submitted for today yet/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /go to daily standup/i })).toBeTruthy();
  });

  it("clicking 'Go to Daily Standup' calls onNavigateToPace and closes the panel", () => {
    useMyTodayStandupMock.mockReturnValue({ entry: null, loading: false, refresh: vi.fn() });
    const onNavigate = vi.fn();
    render(<FloatingDayPriority profile={profile} onNavigateToPace={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: /my priorities today/i }));
    fireEvent.click(screen.getByRole("button", { name: /go to daily standup/i }));
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("day-priority-panel")).toBeNull();
  });

  it("does not render an empty-state link when entry exists", () => {
    useMyTodayStandupMock.mockReturnValue({
      entry: { status: "Approved", priorities: "x" },
      loading: false,
      refresh: vi.fn(),
    });
    render(<FloatingDayPriority profile={profile} onNavigateToPace={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /my priorities today/i }));
    expect(screen.queryByRole("button", { name: /go to daily standup/i })).toBeNull();
  });

  it("renders empty state when entry exists but priorities is empty string", () => {
    useMyTodayStandupMock.mockReturnValue({
      entry: { status: "Pending", priorities: "" },
      loading: false,
      refresh: vi.fn(),
    });
    render(<FloatingDayPriority profile={profile} onNavigateToPace={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /my priorities today/i }));
    expect(screen.getByText(/no priorities submitted for today yet/i)).toBeTruthy();
    expect(screen.queryByTestId("day-priority-body")).toBeNull();
  });
});

describe("FloatingDayPriority — dismiss", () => {
  it("clicking outside the panel closes it", () => {
    useMyTodayStandupMock.mockReturnValue({ entry: null, loading: false, refresh: vi.fn() });
    render(
      <>
        <div data-testid="outside">outside element</div>
        <FloatingDayPriority profile={profile} onNavigateToPace={vi.fn()} />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: /my priorities today/i }));
    expect(screen.getByTestId("day-priority-panel")).toBeTruthy();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByTestId("day-priority-panel")).toBeNull();
  });

  it("clicking inside the panel does NOT close it", () => {
    useMyTodayStandupMock.mockReturnValue({
      entry: { status: "Pending", priorities: "x" },
      loading: false,
      refresh: vi.fn(),
    });
    render(<FloatingDayPriority profile={profile} onNavigateToPace={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /my priorities today/i }));
    fireEvent.mouseDown(screen.getByTestId("day-priority-body"));
    expect(screen.getByTestId("day-priority-panel")).toBeTruthy();
  });

  it("pressing Escape closes the panel", () => {
    useMyTodayStandupMock.mockReturnValue({ entry: null, loading: false, refresh: vi.fn() });
    render(<FloatingDayPriority profile={profile} onNavigateToPace={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /my priorities today/i }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("day-priority-panel")).toBeNull();
  });
});

describe("FloatingDayPriority — drag", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  });

  it("dragging the header updates the panel's left/top inline styles", () => {
    useMyTodayStandupMock.mockReturnValue({ entry: null, loading: false, refresh: vi.fn() });
    render(<FloatingDayPriority profile={profile} onNavigateToPace={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /my priorities today/i }));
    const header = screen.getByTestId("day-priority-header");
    fireEvent.mouseDown(header, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(document, { clientX: 150, clientY: 130 });
    fireEvent.mouseUp(document);
    const panel = screen.getByTestId("day-priority-panel");
    expect(panel.style.left).not.toBe("");
    expect(panel.style.top).not.toBe("");
    // right/bottom anchoring is dropped once dragging begins:
    expect(panel.style.right).toBe("auto");
    expect(panel.style.bottom).toBe("auto");
  });

  it("drag clamps within viewport bounds", () => {
    useMyTodayStandupMock.mockReturnValue({ entry: null, loading: false, refresh: vi.fn() });
    render(<FloatingDayPriority profile={profile} onNavigateToPace={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /my priorities today/i }));
    const header = screen.getByTestId("day-priority-header");
    fireEvent.mouseDown(header, { clientX: 100, clientY: 100 });
    // Try to drag far beyond the right edge:
    fireEvent.mouseMove(document, { clientX: 5000, clientY: 5000 });
    fireEvent.mouseUp(document);
    const panel = screen.getByTestId("day-priority-panel");
    const left = parseInt(panel.style.left, 10);
    const top = parseInt(panel.style.top, 10);
    // Panel width 320, height min 180 → left ≤ 1200-260, top ≤ 800-180
    expect(left).toBeLessThanOrEqual(1200);
    expect(top).toBeLessThanOrEqual(800);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);
  });
});
