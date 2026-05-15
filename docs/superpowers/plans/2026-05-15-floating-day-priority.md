# Floating Day Priority — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a draggable/resizable floating popup that shows the logged-in user's today PACE Daily Standup priorities (read-only), accessible from any screen.

**Architecture:** A new `FloatingDayPriority` page-level component mounted alongside `FloatingChat`/`StickyNotes` in `App.tsx`. Data comes from a new `useMyTodayStandup` hook that reuses the existing `/operational_standups/roster/?date=<today>` endpoint and the existing `pace-operational-standups` WS channel. State (open/closed, position, size) lives in the component, with position+size persisted to localStorage. No backend changes.

**Tech Stack:** React 19, TypeScript, Vitest + React Testing Library, existing `@/lib/api` helpers (`apiGet`, `ws.subscribe`), existing `@/utils/storage` (`loadLS`, `saveLS`).

**Spec:** `docs/superpowers/specs/2026-05-15-floating-day-priority-design.md`

---

## File Structure

**Added:**
- `frontend/task-tracker/src/hooks/useMyTodayStandup.ts` — fetches and watches the current user's today entry.
- `frontend/task-tracker/src/pages/FloatingDayPriority.tsx` — the widget (button + panel).
- `frontend/task-tracker/src/__tests__/hooks/useMyTodayStandup.test.ts`
- `frontend/task-tracker/src/__tests__/pages/floatingDayPriority.test.tsx`

**Modified:**
- `frontend/task-tracker/src/App.tsx` — lazy import + mount.

---

## Task 1: `useMyTodayStandup` hook

**Files:**
- Create: `frontend/task-tracker/src/hooks/useMyTodayStandup.ts`
- Test: `frontend/task-tracker/src/__tests__/hooks/useMyTodayStandup.test.ts`

- [ ] **Step 1.1: Write the failing test file**

Create `frontend/task-tracker/src/__tests__/hooks/useMyTodayStandup.test.ts`:

```ts
// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OperationalStandupDto, OperationalStandupRosterRow } from "@/types/api";

let capturedHandler: ((evt: { event: string; record: unknown }) => void) | null = null;
const apiGetMock = vi.fn();

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    apiGet: (url: string) => apiGetMock(url),
    ws: {
      subscribe: (
        _channel: string,
        handler: (evt: { event: string; record: unknown }) => void,
      ) => {
        capturedHandler = handler;
        return () => {
          capturedHandler = null;
        };
      },
    },
  };
});

import { useMyTodayStandup } from "@/hooks/useMyTodayStandup";

function makeEntry(overrides: Partial<OperationalStandupDto> = {}): OperationalStandupDto {
  return {
    id: 1,
    uid: "e1",
    org_uid: "o1",
    profile: "p1",
    profile_detail: { id: 1, uid: "p1", full_name: "Alice", username: "alice" },
    standup_date: "2026-05-15",
    breakthrough_type: "" as const,
    priorities: "ship it",
    collaboration_need: "",
    remarks: "",
    status: "Pending" as const,
    created_by_detail: null,
    approved_by_detail: null,
    approved_at: null,
    reviewed_by_detail: null,
    reviewed_at: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function makeRow(overrides: Partial<OperationalStandupRosterRow> = {}): OperationalStandupRosterRow {
  return {
    profile: { id: 1, uid: "p1", full_name: "Alice", username: "alice" },
    org_uid: "o1",
    org_name: "4D",
    entry: null,
    can_edit: true,
    can_approve: false,
    ...overrides,
  };
}

describe("useMyTodayStandup", () => {
  beforeEach(() => {
    capturedHandler = null;
    apiGetMock.mockReset();
  });

  it("returns null entry when profileId is null and does not fetch", async () => {
    const { result } = renderHook(() => useMyTodayStandup(null));
    expect(result.current.entry).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(apiGetMock).not.toHaveBeenCalled();
  });

  it("returns null when no roster row matches the profileId", async () => {
    apiGetMock.mockResolvedValue([
      makeRow({ profile: { id: 2, uid: "other", full_name: "Bob", username: "bob" } }),
    ]);
    const { result } = renderHook(() => useMyTodayStandup("p1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entry).toBeNull();
  });

  it("returns the entry from the matching roster row", async () => {
    const entry = makeEntry({ priorities: "do the thing" });
    apiGetMock.mockResolvedValue([makeRow({ entry })]);
    const { result } = renderHook(() => useMyTodayStandup("p1"));
    await waitFor(() => expect(result.current.entry?.priorities).toBe("do the thing"));
  });

  it("picks the Approved row when the same user has multiple rows across orgs", async () => {
    apiGetMock.mockResolvedValue([
      makeRow({ org_uid: "o1", entry: makeEntry({ uid: "pending-1", status: "Pending" }) }),
      makeRow({ org_uid: "o2", entry: makeEntry({ uid: "approved-1", status: "Approved" }) }),
      makeRow({ org_uid: "o3", entry: null }),
    ]);
    const { result } = renderHook(() => useMyTodayStandup("p1"));
    await waitFor(() => expect(result.current.entry?.uid).toBe("approved-1"));
  });

  it("re-fetches when a WS message arrives on pace-operational-standups", async () => {
    apiGetMock.mockResolvedValueOnce([makeRow({ entry: makeEntry({ priorities: "first" }) })]);
    const { result } = renderHook(() => useMyTodayStandup("p1"));
    await waitFor(() => expect(result.current.entry?.priorities).toBe("first"));

    apiGetMock.mockResolvedValueOnce([makeRow({ entry: makeEntry({ priorities: "second" }) })]);
    act(() => {
      capturedHandler?.({ event: "UPDATE", record: {} });
    });
    await waitFor(() => expect(result.current.entry?.priorities).toBe("second"));
  });
});
```

- [ ] **Step 1.2: Run the test to verify it fails**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/hooks/useMyTodayStandup.test.ts`
Expected: FAIL — `Cannot find module '@/hooks/useMyTodayStandup'`.

- [ ] **Step 1.3: Implement the hook**

Create `frontend/task-tracker/src/hooks/useMyTodayStandup.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import { apiGet, ws } from "@/lib/api";
import type {
  OperationalStandupDto,
  OperationalStandupRosterRow,
} from "@/types/api";

export interface UseMyTodayStandupResult {
  entry: OperationalStandupDto | null;
  loading: boolean;
  refresh: () => void;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Mirrors DailyStandupPage.tsx:58-62. Higher score = more informative row.
function rosterScore(r: OperationalStandupRosterRow): number {
  if (!r.entry) return 0;
  if (r.entry.status === "Approved") return 2;
  return 1;
}

export function useMyTodayStandup(profileId: string | null): UseMyTodayStandupResult {
  const [entry, setEntry] = useState<OperationalStandupDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!profileId) {
      setEntry(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const date = todayISO();

    const doFetch = async (): Promise<void> => {
      setLoading(true);
      try {
        const rows = await apiGet<OperationalStandupRosterRow[]>(
          `/operational_standups/roster/?date=${encodeURIComponent(date)}`,
        );
        if (cancelled) return;
        const mine = rows.filter((r) => r.profile.uid === profileId);
        let picked: OperationalStandupRosterRow | null = null;
        for (const r of mine) {
          if (!picked || rosterScore(r) > rosterScore(picked)) picked = r;
        }
        setEntry(picked?.entry ?? null);
      } catch {
        // Passive widget: swallow errors, keep last-known entry.
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void doFetch();
    const unsubscribe = ws.subscribe<OperationalStandupDto>(
      "pace-operational-standups",
      () => {
        if (!cancelled) setRefreshKey((k) => k + 1);
      },
    );
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [profileId, refreshKey]);

  return { entry, loading, refresh };
}
```

- [ ] **Step 1.4: Run the test to verify it passes**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/hooks/useMyTodayStandup.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 1.5: Commit**

```bash
git add frontend/task-tracker/src/hooks/useMyTodayStandup.ts frontend/task-tracker/src/__tests__/hooks/useMyTodayStandup.test.ts
git commit -m "feat(pace): useMyTodayStandup hook for the day-priority widget"
```

---

## Task 2: Collapsed icon with status dot

**Files:**
- Create: `frontend/task-tracker/src/pages/FloatingDayPriority.tsx`
- Test: `frontend/task-tracker/src/__tests__/pages/floatingDayPriority.test.tsx`

- [ ] **Step 2.1: Write the failing test**

Create `frontend/task-tracker/src/__tests__/pages/floatingDayPriority.test.tsx`:

```tsx
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
  is_active: true,
  orgs: [],
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
```

- [ ] **Step 2.2: Run the test to verify it fails**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/pages/floatingDayPriority.test.tsx`
Expected: FAIL — `Cannot find module '@/pages/FloatingDayPriority'`.

- [ ] **Step 2.3: Implement the collapsed icon**

Create `frontend/task-tracker/src/pages/FloatingDayPriority.tsx`:

```tsx
import { useState } from "react";
import type { Profile } from "@/types/auth";
import { useMyTodayStandup } from "@/hooks/useMyTodayStandup";

interface FloatingDayPriorityProps {
  profile: Profile | null;
  onNavigateToPace: () => void;
}

type DotStatus = "none" | "pending" | "approved";

function statusToDot(status: "Pending" | "Approved" | undefined): DotStatus {
  if (status === "Approved") return "approved";
  if (status === "Pending") return "pending";
  return "none";
}

const DOT_COLORS: Record<DotStatus, string> = {
  approved: "#16a34a",
  pending: "#d97706",
  none: "#94a3b8",
};

export default function FloatingDayPriority({
  profile,
  onNavigateToPace: _onNavigateToPace,
}: FloatingDayPriorityProps) {
  const [open, setOpen] = useState(false);
  const { entry } = useMyTodayStandup(profile?.id ?? null);

  if (!profile) return null;

  const dot = statusToDot(entry?.status);

  return (
    <>
      <button
        type="button"
        title="My priorities today"
        aria-label="My priorities today"
        onClick={() => setOpen((o) => !o)}
        style={{
          position: "fixed",
          bottom: 148,
          right: 24,
          zIndex: 9001,
          width: 52,
          height: 52,
          borderRadius: "50%",
          border: "none",
          background: open ? "#1d4ed8" : "#2563eb",
          color: "#fff",
          fontSize: 22,
          cursor: "pointer",
          boxShadow: "0 4px 16px rgba(37,99,235,.4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "background .2s,transform .15s",
          transform: open ? "scale(1.05)" : "scale(1)",
        }}
      >
        📋
        <span
          data-testid="day-priority-status-dot"
          data-status={dot}
          style={{
            position: "absolute",
            top: -2,
            right: -2,
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: DOT_COLORS[dot],
            border: "2px solid #fff",
          }}
        />
      </button>
    </>
  );
}
```

- [ ] **Step 2.4: Run the test to verify it passes**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/pages/floatingDayPriority.test.tsx`
Expected: PASS — all 5 tests green.

- [ ] **Step 2.5: Commit**

```bash
git add frontend/task-tracker/src/pages/FloatingDayPriority.tsx frontend/task-tracker/src/__tests__/pages/floatingDayPriority.test.tsx
git commit -m "feat(pace): FloatingDayPriority collapsed icon with status dot"
```

---

## Task 3: Open/close toggle + panel shell

**Files:**
- Modify: `frontend/task-tracker/src/pages/FloatingDayPriority.tsx`
- Modify: `frontend/task-tracker/src/__tests__/pages/floatingDayPriority.test.tsx`

- [ ] **Step 3.1: Add failing tests for open/close**

Append to the existing test file (inside a new `describe` block at the bottom):

```tsx
import { fireEvent } from "@testing-library/react";

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
```

- [ ] **Step 3.2: Run tests to verify they fail**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/pages/floatingDayPriority.test.tsx`
Expected: FAIL — `day-priority-panel` not found.

- [ ] **Step 3.3: Add the panel render**

In `frontend/task-tracker/src/pages/FloatingDayPriority.tsx`, replace the `return (...)` block so the panel renders below the button when `open`:

```tsx
  return (
    <>
      <button
        type="button"
        title="My priorities today"
        aria-label="My priorities today"
        onClick={() => setOpen((o) => !o)}
        style={{
          position: "fixed",
          bottom: 148,
          right: 24,
          zIndex: 9001,
          width: 52,
          height: 52,
          borderRadius: "50%",
          border: "none",
          background: open ? "#1d4ed8" : "#2563eb",
          color: "#fff",
          fontSize: 22,
          cursor: "pointer",
          boxShadow: "0 4px 16px rgba(37,99,235,.4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "background .2s,transform .15s",
          transform: open ? "scale(1.05)" : "scale(1)",
        }}
      >
        📋
        <span
          data-testid="day-priority-status-dot"
          data-status={dot}
          style={{
            position: "absolute",
            top: -2,
            right: -2,
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: DOT_COLORS[dot],
            border: "2px solid #fff",
          }}
        />
      </button>

      {open && (
        <div
          data-testid="day-priority-panel"
          role="dialog"
          aria-label="My priorities today"
          style={{
            position: "fixed",
            right: 24,
            bottom: 200,
            width: 320,
            minWidth: 260,
            minHeight: 180,
            maxWidth: 600,
            maxHeight: "80vh",
            zIndex: 9000,
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            boxShadow: "0 4px 12px rgba(0,0,0,.12)",
            display: "flex",
            flexDirection: "column",
            overflow: "auto",
            resize: "both",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "8px 12px",
              borderBottom: "1px solid #e2e8f0",
              cursor: "move",
              userSelect: "none",
              fontSize: 13,
              fontWeight: 700,
              color: "#0f172a",
              gap: 8,
            }}
          >
            <span>📋 My Priorities</span>
            <span style={{ marginLeft: "auto", fontWeight: 500, fontSize: 12, color: "#64748b" }}>
              {/* date filled in Task 4 */}
            </span>
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                fontSize: 16,
                color: "#64748b",
                padding: 0,
                marginLeft: 8,
              }}
            >
              ✕
            </button>
          </div>
          <div style={{ padding: 12, flex: 1 }}>{/* body filled in Tasks 4–5 */}</div>
        </div>
      )}
    </>
  );
```

- [ ] **Step 3.4: Run tests to verify they pass**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/pages/floatingDayPriority.test.tsx`
Expected: PASS — all 8 tests green.

- [ ] **Step 3.5: Commit**

```bash
git add frontend/task-tracker/src/pages/FloatingDayPriority.tsx frontend/task-tracker/src/__tests__/pages/floatingDayPriority.test.tsx
git commit -m "feat(pace): toggleable panel shell for FloatingDayPriority"
```

---

## Task 4: Date in header + status badge

**Files:**
- Modify: `frontend/task-tracker/src/pages/FloatingDayPriority.tsx`
- Modify: `frontend/task-tracker/src/__tests__/pages/floatingDayPriority.test.tsx`

- [ ] **Step 4.1: Add failing tests for header date and badge**

Append a new `describe` block to the test file:

```tsx
describe("FloatingDayPriority — header and badge", () => {
  it("shows today's date in 'D MMM YYYY' format in the header", () => {
    useMyTodayStandupMock.mockReturnValue({ entry: null, loading: false, refresh: vi.fn() });
    vi.setSystemTime(new Date("2026-05-15T10:00:00"));
    render(<FloatingDayPriority profile={profile} onNavigateToPace={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /my priorities today/i }));
    expect(screen.getByTestId("day-priority-date").textContent).toBe("15 May 2026");
    vi.useRealTimers();
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
```

- [ ] **Step 4.2: Run tests to verify they fail**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/pages/floatingDayPriority.test.tsx`
Expected: FAIL — `day-priority-date` and `day-priority-badge` not found.

- [ ] **Step 4.3: Implement date and badge**

In `frontend/task-tracker/src/pages/FloatingDayPriority.tsx`, add a date formatter above the component:

```tsx
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function formatToday(): string {
  const d = new Date();
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

const BADGE_STYLES: Record<"approved" | "pending", { bg: string; fg: string; label: string }> = {
  approved: { bg: "#dcfce7", fg: "#15803d", label: "Approved" },
  pending:  { bg: "#fef3c7", fg: "#b45309", label: "Pending"  },
};
```

Replace the date placeholder span with:

```tsx
            <span data-testid="day-priority-date" style={{ marginLeft: "auto", fontWeight: 500, fontSize: 12, color: "#64748b" }}>
              {formatToday()}
            </span>
```

Replace the body div with (badge + placeholder for body content; body content comes in Task 5):

```tsx
          <div style={{ padding: 12, flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
            {entry && (entry.status === "Approved" || entry.status === "Pending") && (
              <span
                data-testid="day-priority-badge"
                data-status={entry.status === "Approved" ? "approved" : "pending"}
                style={{
                  alignSelf: "flex-start",
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: BADGE_STYLES[entry.status === "Approved" ? "approved" : "pending"].bg,
                  color: BADGE_STYLES[entry.status === "Approved" ? "approved" : "pending"].fg,
                }}
              >
                {BADGE_STYLES[entry.status === "Approved" ? "approved" : "pending"].label}
              </span>
            )}
            {/* body filled in Task 5 */}
          </div>
```

- [ ] **Step 4.4: Run tests to verify they pass**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/pages/floatingDayPriority.test.tsx`
Expected: PASS — all 12 tests green.

- [ ] **Step 4.5: Commit**

```bash
git add frontend/task-tracker/src/pages/FloatingDayPriority.tsx frontend/task-tracker/src/__tests__/pages/floatingDayPriority.test.tsx
git commit -m "feat(pace): header date and status badge in day-priority panel"
```

---

## Task 5: Priorities body + empty state

**Files:**
- Modify: `frontend/task-tracker/src/pages/FloatingDayPriority.tsx`
- Modify: `frontend/task-tracker/src/__tests__/pages/floatingDayPriority.test.tsx`

- [ ] **Step 5.1: Add failing tests for body and empty state**

Append a new `describe` block:

```tsx
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
});
```

- [ ] **Step 5.2: Run tests to verify they fail**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/pages/floatingDayPriority.test.tsx`
Expected: FAIL — `day-priority-body` and empty-state elements not found.

- [ ] **Step 5.3: Implement the body**

In `frontend/task-tracker/src/pages/FloatingDayPriority.tsx`, restore the prop usage:

```tsx
export default function FloatingDayPriority({
  profile,
  onNavigateToPace,
}: FloatingDayPriorityProps) {
```

Replace the `{/* body filled in Task 5 */}` placeholder with:

```tsx
            {entry ? (
              <div
                data-testid="day-priority-body"
                style={{
                  whiteSpace: "pre-wrap",
                  fontSize: 13,
                  color: "#0f172a",
                  lineHeight: 1.5,
                  overflowY: "auto",
                  flex: 1,
                }}
              >
                {entry.priorities}
              </div>
            ) : (
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  color: "#64748b",
                  fontSize: 13,
                  textAlign: "center",
                }}
              >
                <div>No priorities submitted for today yet.</div>
                <button
                  type="button"
                  onClick={() => {
                    onNavigateToPace();
                    setOpen(false);
                  }}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: "#2563eb",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 600,
                    padding: 0,
                  }}
                >
                  Go to Daily Standup →
                </button>
              </div>
            )}
```

- [ ] **Step 5.4: Run tests to verify they pass**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/pages/floatingDayPriority.test.tsx`
Expected: PASS — all 16 tests green.

- [ ] **Step 5.5: Commit**

```bash
git add frontend/task-tracker/src/pages/FloatingDayPriority.tsx frontend/task-tracker/src/__tests__/pages/floatingDayPriority.test.tsx
git commit -m "feat(pace): priorities body and empty state for day-priority panel"
```

---

## Task 6: Close on outside click + Escape

**Files:**
- Modify: `frontend/task-tracker/src/pages/FloatingDayPriority.tsx`
- Modify: `frontend/task-tracker/src/__tests__/pages/floatingDayPriority.test.tsx`

- [ ] **Step 6.1: Add failing tests**

Append a new `describe` block:

```tsx
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
```

- [ ] **Step 6.2: Run tests to verify they fail**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/pages/floatingDayPriority.test.tsx`
Expected: FAIL — outside click and Escape do not close the panel.

- [ ] **Step 6.3: Implement dismiss behavior**

In `frontend/task-tracker/src/pages/FloatingDayPriority.tsx`, add imports + refs + effects:

```tsx
import { useEffect, useRef, useState } from "react";
```

Inside the component body (after `const { entry } = useMyTodayStandup(...)`):

```tsx
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
```

Attach the refs:
- Add `ref={buttonRef}` to the `<button>`.
- Add `ref={panelRef}` to the panel `<div data-testid="day-priority-panel" ...>`.

- [ ] **Step 6.4: Run tests to verify they pass**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/pages/floatingDayPriority.test.tsx`
Expected: PASS — all 19 tests green.

- [ ] **Step 6.5: Commit**

```bash
git add frontend/task-tracker/src/pages/FloatingDayPriority.tsx frontend/task-tracker/src/__tests__/pages/floatingDayPriority.test.tsx
git commit -m "feat(pace): outside-click and Escape dismiss for day-priority panel"
```

---

## Task 7: Drag the panel by its header

**Files:**
- Modify: `frontend/task-tracker/src/pages/FloatingDayPriority.tsx`
- Modify: `frontend/task-tracker/src/__tests__/pages/floatingDayPriority.test.tsx`

- [ ] **Step 7.1: Add failing tests**

Append a new `describe` block:

```tsx
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
```

- [ ] **Step 7.2: Run tests to verify they fail**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/pages/floatingDayPriority.test.tsx`
Expected: FAIL — `day-priority-header` testid missing; drag does not update styles.

- [ ] **Step 7.3: Implement drag**

In `frontend/task-tracker/src/pages/FloatingDayPriority.tsx`, add position state and a header mousedown handler. Place this block inside the component body, just after the existing dismiss `useEffect` from Task 6:

```tsx
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [size] = useState<{ width: number; height: number }>({ width: 320, height: 220 });
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  const onHeaderMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return; // don't drag from ✕
    const rect = panelRef.current?.getBoundingClientRect();
    const baseX = pos?.x ?? rect?.left ?? 0;
    const baseY = pos?.y ?? rect?.top ?? 0;
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX, baseY };
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const minWidth = 260;
      const minHeight = 180;
      const maxX = Math.max(0, window.innerWidth - Math.max(size.width, minWidth));
      const maxY = Math.max(0, window.innerHeight - Math.max(size.height, minHeight));
      const x = Math.min(maxX, Math.max(0, d.baseX + (ev.clientX - d.startX)));
      const y = Math.min(maxY, Math.max(0, d.baseY + (ev.clientY - d.startY)));
      setPos({ x, y });
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };
```

Update the panel `<div>` style and header to use `pos`:

```tsx
        <div
          ref={panelRef}
          data-testid="day-priority-panel"
          role="dialog"
          aria-label="My priorities today"
          style={{
            position: "fixed",
            left: pos ? `${pos.x}px` : "auto",
            top: pos ? `${pos.y}px` : "auto",
            right: pos ? "auto" : "24px",
            bottom: pos ? "auto" : "200px",
            width: size.width,
            minWidth: 260,
            minHeight: 180,
            maxWidth: 600,
            maxHeight: "80vh",
            zIndex: 9000,
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            boxShadow: "0 4px 12px rgba(0,0,0,.12)",
            display: "flex",
            flexDirection: "column",
            overflow: "auto",
            resize: "both",
          }}
        >
          <div
            data-testid="day-priority-header"
            onMouseDown={onHeaderMouseDown}
            style={{
              display: "flex",
              alignItems: "center",
              padding: "8px 12px",
              borderBottom: "1px solid #e2e8f0",
              cursor: "move",
              userSelect: "none",
              fontSize: 13,
              fontWeight: 700,
              color: "#0f172a",
              gap: 8,
            }}
          >
```

- [ ] **Step 7.4: Run tests to verify they pass**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/pages/floatingDayPriority.test.tsx`
Expected: PASS — all 21 tests green.

- [ ] **Step 7.5: Commit**

```bash
git add frontend/task-tracker/src/pages/FloatingDayPriority.tsx frontend/task-tracker/src/__tests__/pages/floatingDayPriority.test.tsx
git commit -m "feat(pace): drag handle for day-priority panel"
```

---

## Task 8: Track size (for resize + persistence)

**Files:**
- Modify: `frontend/task-tracker/src/pages/FloatingDayPriority.tsx`
- Modify: `frontend/task-tracker/src/__tests__/pages/floatingDayPriority.test.tsx`

CSS `resize: both` already gives the user a corner handle. We add a `ResizeObserver` so React knows the size for both clamping and persistence.

- [ ] **Step 8.1: Add failing test for size tracking**

Append:

```tsx
describe("FloatingDayPriority — resize tracking", () => {
  it("tracks size changes via ResizeObserver and updates internal width/height", async () => {
    useMyTodayStandupMock.mockReturnValue({ entry: null, loading: false, refresh: vi.fn() });
    render(<FloatingDayPriority profile={profile} onNavigateToPace={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /my priorities today/i }));
    const panel = screen.getByTestId("day-priority-panel");
    // Simulate a resize by directly invoking the captured observer callback
    // via the helper exposed on window in test-only code path.
    const fire = (window as unknown as { __dayPriorityFireResize?: (w: number, h: number) => void })
      .__dayPriorityFireResize;
    expect(typeof fire).toBe("function");
    fire?.(400, 300);
    expect(panel.style.width).toBe("400px");
  });
});
```

- [ ] **Step 8.2: Run the test to verify it fails**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/pages/floatingDayPriority.test.tsx`
Expected: FAIL — `__dayPriorityFireResize` not defined.

- [ ] **Step 8.3: Implement size tracking via ResizeObserver**

In `frontend/task-tracker/src/pages/FloatingDayPriority.tsx`, change `size` to be mutable and add a ResizeObserver effect. Replace the size declaration:

```tsx
  const [size, setSize] = useState<{ width: number; height: number }>({ width: 320, height: 220 });
```

Add this effect after the existing `useEffect` for dismiss:

```tsx
  useEffect(() => {
    if (!open) return;
    const el = panelRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      setSize({ width: Math.round(r.width), height: Math.round(r.height) });
    });
    ro.observe(el);
    // Test-only hook so we can fire synthetic resize events in jsdom (no real RO).
    if (typeof window !== "undefined") {
      (window as unknown as { __dayPriorityFireResize?: (w: number, h: number) => void })
        .__dayPriorityFireResize = (w, h) => setSize({ width: w, height: h });
    }
    return () => {
      ro.disconnect();
      if (typeof window !== "undefined") {
        delete (window as unknown as { __dayPriorityFireResize?: unknown }).__dayPriorityFireResize;
      }
    };
  }, [open]);
```

- [ ] **Step 8.4: Run tests to verify they pass**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/pages/floatingDayPriority.test.tsx`
Expected: PASS — all 22 tests green.

- [ ] **Step 8.5: Commit**

```bash
git add frontend/task-tracker/src/pages/FloatingDayPriority.tsx frontend/task-tracker/src/__tests__/pages/floatingDayPriority.test.tsx
git commit -m "feat(pace): track day-priority panel size for clamping and persistence"
```

---

## Task 9: Persist position + size to localStorage

**Files:**
- Modify: `frontend/task-tracker/src/pages/FloatingDayPriority.tsx`
- Modify: `frontend/task-tracker/src/__tests__/pages/floatingDayPriority.test.tsx`

- [ ] **Step 9.1: Add failing tests for persistence**

Append:

```tsx
describe("FloatingDayPriority — persistence", () => {
  it("writes position and size to localStorage on change", async () => {
    useMyTodayStandupMock.mockReturnValue({ entry: null, loading: false, refresh: vi.fn() });
    render(<FloatingDayPriority profile={profile} onNavigateToPace={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /my priorities today/i }));
    const header = screen.getByTestId("day-priority-header");
    fireEvent.mouseDown(header, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(document, { clientX: 130, clientY: 140 });
    fireEvent.mouseUp(document);
    const raw = localStorage.getItem("day_priority_panel_p1");
    expect(raw).not.toBeNull();
    const saved = JSON.parse(raw!);
    expect(typeof saved.x).toBe("number");
    expect(typeof saved.y).toBe("number");
    expect(saved.width).toBeGreaterThanOrEqual(260);
  });

  it("restores saved position from localStorage on mount", () => {
    localStorage.setItem(
      "day_priority_panel_p1",
      JSON.stringify({ x: 50, y: 70, width: 350, height: 240 }),
    );
    useMyTodayStandupMock.mockReturnValue({ entry: null, loading: false, refresh: vi.fn() });
    render(<FloatingDayPriority profile={profile} onNavigateToPace={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /my priorities today/i }));
    const panel = screen.getByTestId("day-priority-panel");
    expect(panel.style.left).toBe("50px");
    expect(panel.style.top).toBe("70px");
    expect(panel.style.width).toBe("350px");
  });

  it("discards saved values that would place the panel off-screen", () => {
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 600, configurable: true });
    localStorage.setItem(
      "day_priority_panel_p1",
      JSON.stringify({ x: 5000, y: 5000, width: 350, height: 240 }),
    );
    useMyTodayStandupMock.mockReturnValue({ entry: null, loading: false, refresh: vi.fn() });
    render(<FloatingDayPriority profile={profile} onNavigateToPace={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /my priorities today/i }));
    const panel = screen.getByTestId("day-priority-panel");
    // Falls back to default anchor (no left/top set):
    expect(panel.style.left).toBe("auto");
    expect(panel.style.top).toBe("auto");
  });
});
```

- [ ] **Step 9.2: Run tests to verify they fail**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/pages/floatingDayPriority.test.tsx`
Expected: FAIL — localStorage key not written / restored.

- [ ] **Step 9.3: Implement persistence**

In `frontend/task-tracker/src/pages/FloatingDayPriority.tsx`, add imports:

```tsx
import { loadLS, saveLS } from "@/utils/storage";
```

Define a constant and helper near the top of the file (below `BADGE_STYLES`):

```tsx
interface SavedLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

function lsKey(userId: string): string {
  return `day_priority_panel_${userId}`;
}

function fitsViewport(s: SavedLayout): boolean {
  if (typeof window === "undefined") return true;
  if (s.width < 260 || s.height < 180) return false;
  if (s.x < 0 || s.y < 0) return false;
  if (s.x > window.innerWidth - 100) return false;
  if (s.y > window.innerHeight - 100) return false;
  return true;
}
```

Replace `pos` and `size` initialization with a single lazy initializer:

```tsx
  const initialLayout = (() => {
    if (!profile?.id) return null;
    const saved = loadLS<SavedLayout | null>(lsKey(profile.id), null);
    if (saved && fitsViewport(saved)) return saved;
    return null;
  })();

  const [pos, setPos] = useState<{ x: number; y: number } | null>(
    initialLayout ? { x: initialLayout.x, y: initialLayout.y } : null,
  );
  const [size, setSize] = useState<{ width: number; height: number }>(
    initialLayout
      ? { width: initialLayout.width, height: initialLayout.height }
      : { width: 320, height: 220 },
  );
```

Add a persist effect after the size tracking effect:

```tsx
  useEffect(() => {
    if (!profile?.id || !pos) return;
    saveLS<SavedLayout>(lsKey(profile.id), {
      x: pos.x,
      y: pos.y,
      width: size.width,
      height: size.height,
    });
  }, [pos, size.width, size.height, profile?.id]);
```

- [ ] **Step 9.4: Run tests to verify they pass**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/pages/floatingDayPriority.test.tsx`
Expected: PASS — all 25 tests green.

- [ ] **Step 9.5: Commit**

```bash
git add frontend/task-tracker/src/pages/FloatingDayPriority.tsx frontend/task-tracker/src/__tests__/pages/floatingDayPriority.test.tsx
git commit -m "feat(pace): persist day-priority panel position and size to localStorage"
```

---

## Task 10: Mount in `App.tsx`

**Files:**
- Modify: `frontend/task-tracker/src/App.tsx`

- [ ] **Step 10.1: Add the lazy import**

In `frontend/task-tracker/src/App.tsx`, locate the existing lazy imports near the top (around line 38–39 where `FloatingChat` and `StickyNotes` are declared) and add:

```tsx
const FloatingDayPriority = lazy(() => import("./pages/FloatingDayPriority"));
```

- [ ] **Step 10.2: Mount the widget**

Inside the existing `<Suspense fallback={null}>` block (around line 569–582), next to the FloatingChat and StickyNotes mounts, add:

```tsx
        {user && (
          <FloatingDayPriority
            profile={profile}
            onNavigateToPace={() => setView("pace")}
          />
        )}
```

The full block should now look like:

```tsx
      <Suspense fallback={null}>
        {adminOpen && isAdmin && (
          <AdminDashboard
            tasks={tasks}
            profiles={profiles}
            onFilterEmployee={handleAdminFilter}
            activeEmployee={adminEmployee}
            onClose={() => setAdminOpen(false)}
          />
        )}

        {user && <FloatingChat profile={profile} profiles={profiles} />}
        {user && <StickyNotes userId={user.id} />}
        {user && (
          <FloatingDayPriority
            profile={profile}
            onNavigateToPace={() => setView("pace")}
          />
        )}
      </Suspense>
```

- [ ] **Step 10.3: Run typecheck and the full test suite**

Run: `cd frontend/task-tracker && npx tsc -b --noEmit`
Expected: PASS — no type errors.

Run: `cd frontend/task-tracker && npm test`
Expected: PASS — full Vitest suite green, including the new hook and component tests.

- [ ] **Step 10.4: Manually verify in the dev server**

Run: `cd frontend/task-tracker && npm run dev` (background).

In a browser:
1. Sign in.
2. Confirm the 📋 button appears at bottom-right above the chat button.
3. Click it — panel opens. If no standup submitted today, see the empty state with the "Go to Daily Standup →" link.
4. Click the link → app navigates to PACE → Daily Standup; panel closes.
5. Go back, submit a standup row for yourself on PACE, return to any other screen — icon dot turns amber/green; panel shows the priorities text on reopen.
6. Drag the panel by its header → it moves and stays inside the viewport.
7. Resize from the bottom-right corner → it grows/shrinks within bounds.
8. Reload the page → position and size are restored.

- [ ] **Step 10.5: Commit and push**

```bash
git add frontend/task-tracker/src/App.tsx
git commit -m "feat(pace): mount FloatingDayPriority in App"
git push
```

---

## Self-review

**1. Spec coverage:**
- Component & hook files → Tasks 1, 2.
- Collapsed icon + status dot → Task 2.
- Open/close, header, status badge, body, empty state → Tasks 3–5.
- Outside-click / Escape close → Task 6.
- Drag with viewport clamp → Task 7.
- Native CSS resize + size tracking → Task 8.
- localStorage persistence + clamp/discard-on-bad-restore → Task 9.
- Mount in `App.tsx` → Task 10.
- WS refresh on `pace-operational-standups` → covered in the hook (Task 1.3) and tested (Task 1.1).
- Multi-org `rosterScore` resolution → covered in the hook (Task 1.3) and tested (Task 1.1).

**2. Placeholder scan:** No TBDs, no "implement appropriate X", no "similar to Task N". Every code-step shows full code.

**3. Type consistency:**
- `FloatingDayPriorityProps`: `{ profile: Profile | null; onNavigateToPace: () => void }` — same in Tasks 2, 3, 5, 10.
- `useMyTodayStandup(profileId: string | null)` — same in Tasks 1 and 2.
- `SavedLayout`, `lsKey`, `fitsViewport` introduced in Task 9 and not referenced elsewhere — internally consistent.
- `pos` is `{x,y} | null`, `size` is `{width,height}` — consistent across Tasks 7, 8, 9.
