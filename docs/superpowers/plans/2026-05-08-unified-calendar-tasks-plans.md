# Unified Calendar (Tasks + Work Plans) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the standalone Work Plan calendar into the main Calendar page so admins/managers see Tasks + Work Plans in one view, with a layer toggle, shared filters, and a merged day-detail modal.

**Architecture:** Each day cell renders two stacked sections — Tasks (status-coloured) and Plans (employee-coloured) — separated by a dashed divider. A `Both | Tasks | Plans` layer toggle (persisted in `localStorage`) controls visibility. Plan data is fetched by a new shared `useWorkPlans` hook which both `CalendarPage` and `WorkPlanTab` consume, eliminating duplication.

**Tech Stack:** React 19, TypeScript, Vitest + @testing-library/react (jsdom), inline styles (existing convention), WebSocket via `lib/api/ws.ts`, REST via `apiGet('/work_plans/')`.

**Spec:** [`docs/superpowers/specs/2026-05-08-unified-calendar-tasks-plans-design.md`](../specs/2026-05-08-unified-calendar-tasks-plans-design.md)

---

## File Structure

| File | Responsibility |
|------|----------------|
| `frontend/task-tracker/src/hooks/useWorkPlans.ts` (new) | Loads `/work_plans/`, maps DTO → `WorkPlan`, fills `day`, sorts by date, subscribes to `work-plans` WS topic. Single shared data source. |
| `frontend/task-tracker/src/__tests__/hooks/useWorkPlans.test.ts` (new) | Unit-tests for the hook: initial load, `day` derivation, sort order, WS-triggered reload, unsubscribe on unmount. |
| `frontend/task-tracker/src/utils/calendarLayers.ts` (new) | Pure helpers: layer-toggle type, localStorage read/write, predicates `tasksVisible(layers)` / `plansVisible(layers)`. Easy to unit-test. |
| `frontend/task-tracker/src/__tests__/utils/calendarLayers.test.ts` (new) | Unit-tests for layer helpers. |
| `frontend/task-tracker/src/components/calendar/UnifiedDayCell.tsx` (new) | Renders a single day cell with two stacked sections, top-right badge, "+N more" affordance. Pure presentational. |
| `frontend/task-tracker/src/components/calendar/UnifiedDayModal.tsx` (new) | Renders the day-detail modal with TASKS and WORK PLANS sections. Pure presentational. |
| `frontend/task-tracker/src/components/calendar/CalendarToolbar.tsx` (new) | Renders nav buttons, layer toggle pills, filters, clear button. Pure presentational. |
| `frontend/task-tracker/src/components/calendar/CalendarLegend.tsx` (new) | Renders status legend + employee legend, layer-aware. Pure presentational. |
| `frontend/task-tracker/src/pages/CalendarPage.tsx` (modify) | Wires hook + layer state + filters together; loops over days rendering `UnifiedDayCell`. Drops the inline JSX that the new components replaced. |
| `frontend/task-tracker/src/components/worklog/WorkPlanTab.tsx` (modify) | Replaces inline `load`/`useEffect`/`ws.subscribe` block with `useWorkPlans()` call. No behaviour change. |

The new presentational components in `components/calendar/` exist to keep `CalendarPage.tsx` from ballooning. `CalendarPage` becomes a small container; rendering details live in focused files.

---

## Task 1: Extract `useWorkPlans` hook (TDD)

**Files:**
- Create: `frontend/task-tracker/src/hooks/useWorkPlans.ts`
- Create: `frontend/task-tracker/src/__tests__/hooks/useWorkPlans.test.ts`

- [ ] **Step 1.1: Write the failing test**

Create `frontend/task-tracker/src/__tests__/hooks/useWorkPlans.test.ts`:

```ts
// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

let capturedHandler:
  | ((evt: { event: string; record: unknown }) => void)
  | null = null;

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    apiGet: vi.fn(async (url: string) => {
      if (url === "/work_plans/") {
        return [
          {
            id: 2,
            uid: "p2",
            assigned_to: "u1",
            assigned_to_detail: { uid: "u1", full_name: "Alice" },
            created_by_detail: null,
            date: "2026-05-09",
            task_description: "Task B",
            planned_hours: "2.00",
            client: null,
            client_detail: null,
            org: null,
            sort_order: null,
          },
          {
            id: 1,
            uid: "p1",
            assigned_to: "u1",
            assigned_to_detail: { uid: "u1", full_name: "Alice" },
            created_by_detail: null,
            date: "2026-05-08",
            task_description: "Task A",
            planned_hours: "1.50",
            client: "c1",
            client_detail: { uid: "c1", name: "Acme" },
            org: null,
            sort_order: null,
          },
        ];
      }
      return [];
    }),
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

import { useWorkPlans } from "@/hooks/useWorkPlans";

describe("useWorkPlans", () => {
  beforeEach(() => {
    capturedHandler = null;
    vi.clearAllMocks();
  });

  it("loads, maps, sorts ascending by date, and fills day name", async () => {
    const { result } = renderHook(() => useWorkPlans());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.plans).toHaveLength(2);
    expect(result.current.plans[0].date).toBe("2026-05-08");
    expect(result.current.plans[1].date).toBe("2026-05-09");
    expect(result.current.plans[0].day).toMatch(/Fri|Sat|Sun|Mon|Tue|Wed|Thu/);
    expect(result.current.plans[0].name).toBe("Alice");
    expect(result.current.plans[0].client).toBe("Acme");
  });

  it("reloads when a work-plans WS event arrives", async () => {
    const { result } = renderHook(() => useWorkPlans());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(capturedHandler).not.toBeNull();
    act(() => {
      capturedHandler!({ event: "UPDATE", record: {} });
    });
    // The mock apiGet was called once on mount + once on the WS event.
    const { apiGet } = await import("@/lib/api");
    await waitFor(() =>
      expect((apiGet as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(
        2,
      ),
    );
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `cd frontend/task-tracker && npm run test -- hooks/useWorkPlans`
Expected: FAIL with `Failed to resolve import "@/hooks/useWorkPlans"`.

- [ ] **Step 1.3: Implement the hook**

Create `frontend/task-tracker/src/hooks/useWorkPlans.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import { apiGet, dtoToWorkPlan, ws } from "@/lib/api";
import type { WorkPlanDto } from "@/types/api";
import type { WorkPlan } from "@/types";
import { getDayName } from "@/utils/date";

export interface UseWorkPlansReturn {
  plans: WorkPlan[];
  loading: boolean;
  reload: () => Promise<void>;
}

/**
 * Loads /work_plans/ (server filters by visibility) and live-updates via the
 * `work-plans` WS topic. Plans are sorted ascending by date and have `day`
 * filled from `date`.
 */
export function useWorkPlans(): UseWorkPlansReturn {
  const [plans, setPlans] = useState<WorkPlan[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (): Promise<void> => {
    const dtos = await apiGet<WorkPlanDto[]>("/work_plans/");
    const mapped = dtos.map(dtoToWorkPlan);
    mapped.forEach((p) => {
      p.day = getDayName(p.date);
    });
    mapped.sort((a, b) => a.date.localeCompare(b.date));
    setPlans(mapped);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reload();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const unsubscribe = ws.subscribe<WorkPlanDto>("work-plans", () => {
      void reload();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [reload]);

  return { plans, loading, reload };
}
```

- [ ] **Step 1.4: Run tests to verify they pass**

Run: `cd frontend/task-tracker && npm run test -- hooks/useWorkPlans`
Expected: 2 passing tests.

- [ ] **Step 1.5: Type-check**

Run: `cd frontend/task-tracker && npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 1.6: Commit**

```bash
git add frontend/task-tracker/src/hooks/useWorkPlans.ts frontend/task-tracker/src/__tests__/hooks/useWorkPlans.test.ts
git commit -m "feat(hooks): add useWorkPlans shared hook for /work_plans/ + WS

Extracted so both CalendarPage and WorkPlanTab can share one
data source for work plans, with live-update via the work-plans
WS topic."
```

---

## Task 2: Refactor `WorkPlanTab` to use the new hook

**Files:**
- Modify: `frontend/task-tracker/src/components/worklog/WorkPlanTab.tsx`

This is a small refactor: replace the inline `plans` state, `load` callback, and `useEffect` block with a single `useWorkPlans()` call. No behaviour change.

- [ ] **Step 2.1: Replace inline data block with hook call**

In `frontend/task-tracker/src/components/worklog/WorkPlanTab.tsx`:

Replace these two lines near the top of the component body (currently `const [plans, ...]` and `const [loading, ...]`):

```ts
  const [plans, setPlans] = useState<WorkPlan[]>([]);
  const [loading, setLoading] = useState(true);
```

with:

```ts
  const { plans, loading, reload: load } = useWorkPlans();
```

Then delete the entire `load` callback and its `useEffect` block (currently around lines 100–122):

```ts
  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      // Django filters by visibility server-side.
      const dtos = await apiGet<WorkPlanDto[]>("/work_plans/");
      const mapped = dtos.map(dtoToWorkPlan);
      mapped.forEach((p) => {
        p.day = getDayName(p.date);
      });
      mapped.sort((a, b) => a.date.localeCompare(b.date));
      setPlans(mapped);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const unsubscribe = ws.subscribe<WorkPlanDto>("work-plans", () => {
      void load();
    });
    return unsubscribe;
  }, [load]);
```

(Keeping the local alias `load` for the hook's `reload` minimises diff churn — the rest of the file already calls `load()` in `handleBulkDeletePlan`, `saveEdit`'s sibling paths, the `onSave` callback, and `deletePlan`.)

- [ ] **Step 2.2: Update imports at the top of the file**

Before:

```ts
import { useCallback, useEffect, useMemo, useState } from "react";
import type React from "react";
import {
  ApiError,
  apiDelete,
  apiGet,
  apiPatch,
  dtoToWorkPlan,
  ws,
} from "@/lib/api";
import type { WorkPlanDto, WorkPlanUpdate } from "@/types/api";
import { toMins, fromMins, validTime } from "@/utils/time";
import { getDayName } from "@/utils/date";
```

After:

```ts
import { useMemo, useState } from "react";
import type React from "react";
import {
  ApiError,
  apiDelete,
  apiPatch,
  dtoToWorkPlan,
} from "@/lib/api";
import type { WorkPlanDto, WorkPlanUpdate } from "@/types/api";
import { toMins, fromMins, validTime } from "@/utils/time";
import { getDayName } from "@/utils/date";
import { useWorkPlans } from "@/hooks/useWorkPlans";
```

(`useCallback`, `useEffect`, `apiGet`, `ws` are no longer used directly in the file. Keep `dtoToWorkPlan` because `saveEdit` uses it; keep `getDayName` because `saveEdit` and the table renderer use it.)

- [ ] **Step 2.3: Type-check + run tests**

Run: `cd frontend/task-tracker && npx tsc -b --noEmit && npm run test -- worklog`
Expected: no type errors, all worklog tests still pass.

- [ ] **Step 2.4: Smoke-test in browser**

Run: `cd frontend/task-tracker && npm run dev` and open `Work Log → Work Plan`. Verify:
- The plan list still loads.
- The Calendar tab inside Work Log still shows plans.
- Adding a plan via `+ Add Plan` still appears live (WS path still wired).

- [ ] **Step 2.5: Commit**

```bash
git add frontend/task-tracker/src/components/worklog/WorkPlanTab.tsx
git commit -m "refactor(worklog): use shared useWorkPlans hook

WorkPlanTab no longer owns its own load/WS plumbing; it now
shares a single data source with CalendarPage."
```

---

## Task 3: Layer-toggle helpers (TDD)

**Files:**
- Create: `frontend/task-tracker/src/utils/calendarLayers.ts`
- Create: `frontend/task-tracker/src/__tests__/utils/calendarLayers.test.ts`

- [ ] **Step 3.1: Write the failing test**

Create `frontend/task-tracker/src/__tests__/utils/calendarLayers.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  CALENDAR_LAYERS_KEY,
  loadLayers,
  saveLayers,
  tasksVisible,
  plansVisible,
  type CalendarLayers,
} from "@/utils/calendarLayers";

describe("calendarLayers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to 'both' when nothing is stored", () => {
    expect(loadLayers()).toBe("both");
  });

  it("ignores invalid stored values and returns the default", () => {
    localStorage.setItem(CALENDAR_LAYERS_KEY, "garbage");
    expect(loadLayers()).toBe("both");
  });

  it("round-trips a valid value via saveLayers/loadLayers", () => {
    saveLayers("plans");
    expect(loadLayers()).toBe("plans");
    saveLayers("tasks");
    expect(loadLayers()).toBe("tasks");
  });

  it("computes tasksVisible/plansVisible correctly", () => {
    const cases: Array<[CalendarLayers, boolean, boolean]> = [
      ["both", true, true],
      ["tasks", true, false],
      ["plans", false, true],
    ];
    for (const [v, t, p] of cases) {
      expect(tasksVisible(v)).toBe(t);
      expect(plansVisible(v)).toBe(p);
    }
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

Run: `cd frontend/task-tracker && npm run test -- calendarLayers`
Expected: FAIL with import resolution error.

- [ ] **Step 3.3: Implement the helpers**

Create `frontend/task-tracker/src/utils/calendarLayers.ts`:

```ts
export type CalendarLayers = "both" | "tasks" | "plans";

export const CALENDAR_LAYERS_KEY = "tasktracker.calendar.layers";
const VALID: ReadonlySet<CalendarLayers> = new Set(["both", "tasks", "plans"]);

export function loadLayers(): CalendarLayers {
  try {
    const raw = localStorage.getItem(CALENDAR_LAYERS_KEY);
    if (raw && (VALID as Set<string>).has(raw)) return raw as CalendarLayers;
  } catch {
    // localStorage unavailable (SSR / privacy mode) — fall through.
  }
  return "both";
}

export function saveLayers(v: CalendarLayers): void {
  try {
    localStorage.setItem(CALENDAR_LAYERS_KEY, v);
  } catch {
    // ignore quota / privacy failures
  }
}

export const tasksVisible = (v: CalendarLayers): boolean =>
  v === "both" || v === "tasks";
export const plansVisible = (v: CalendarLayers): boolean =>
  v === "both" || v === "plans";
```

- [ ] **Step 3.4: Run tests to verify they pass**

Run: `cd frontend/task-tracker && npm run test -- calendarLayers`
Expected: 4 passing tests.

- [ ] **Step 3.5: Commit**

```bash
git add frontend/task-tracker/src/utils/calendarLayers.ts frontend/task-tracker/src/__tests__/utils/calendarLayers.test.ts
git commit -m "feat(calendar): layer-toggle helpers w/ localStorage persistence"
```

---

## Task 4: Build `CalendarToolbar` presentational component

**Files:**
- Create: `frontend/task-tracker/src/components/calendar/CalendarToolbar.tsx`

- [ ] **Step 4.1: Create the component**

Create `frontend/task-tracker/src/components/calendar/CalendarToolbar.tsx`:

```tsx
import type { CSSProperties } from "react";
import type { CalendarLayers } from "@/utils/calendarLayers";

interface CalendarToolbarProps {
  monthLabel: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;

  layers: CalendarLayers;
  onLayersChange: (v: CalendarLayers) => void;

  clientOptions: string[];
  memberOptions: string[];
  fClient: string;
  fMember: string;
  onClientChange: (v: string) => void;
  onMemberChange: (v: string) => void;
  onClear: () => void;
}

const navBtn: CSSProperties = {
  padding: "6px 14px",
  border: "1px solid #e2e8f0",
  borderRadius: 6,
  background: "#f8fafc",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};

const selectStyle: CSSProperties = {
  padding: "5px 10px",
  borderRadius: 6,
  border: "1px solid #e2e8f0",
  fontSize: 12,
  color: "#475569",
  background: "#fff",
  cursor: "pointer",
  width: 150,
};

const LAYERS: Array<{ v: CalendarLayers; label: string }> = [
  { v: "both", label: "Both" },
  { v: "tasks", label: "Tasks" },
  { v: "plans", label: "Plans" },
];

export default function CalendarToolbar(props: CalendarToolbarProps) {
  const {
    monthLabel,
    onPrev,
    onNext,
    onToday,
    layers,
    onLayersChange,
    clientOptions,
    memberOptions,
    fClient,
    fMember,
    onClientChange,
    onMemberChange,
    onClear,
  } = props;

  const filterActive = !!(fClient || fMember);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 12,
        flexWrap: "wrap",
      }}
    >
      <button onClick={onPrev} style={navBtn}>
        ‹ Prev
      </button>
      <span
        className="page-title"
        style={{ fontSize: 20, minWidth: 180, textAlign: "center" }}
      >
        {monthLabel}
      </span>
      <button onClick={onNext} style={navBtn}>
        Next ›
      </button>
      <button onClick={onToday} style={{ ...navBtn, fontSize: 12 }}>
        Today
      </button>

      {/* Layer toggle pills */}
      <div
        role="tablist"
        aria-label="Calendar layers"
        style={{
          display: "flex",
          border: "1.5px solid #e2e8f0",
          borderRadius: 6,
          overflow: "hidden",
          marginLeft: 6,
        }}
      >
        {LAYERS.map(({ v, label }) => {
          const active = layers === v;
          return (
            <button
              key={v}
              role="tab"
              aria-selected={active}
              onClick={() => onLayersChange(v)}
              style={{
                padding: "5px 12px",
                border: "none",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 700,
                background: active ? "#2563eb" : "#fff",
                color: active ? "#fff" : "#475569",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      <select
        value={fClient}
        onChange={(e) => onClientChange(e.target.value)}
        style={selectStyle}
        aria-label="Filter by client"
      >
        <option value="">All Clients</option>
        {clientOptions.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <select
        value={fMember}
        onChange={(e) => onMemberChange(e.target.value)}
        style={selectStyle}
        aria-label="Filter by member"
      >
        <option value="">All Members</option>
        {memberOptions.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>

      {filterActive && (
        <button
          onClick={onClear}
          style={{
            padding: "5px 10px",
            borderRadius: 6,
            border: "1px solid #fca5a5",
            background: "#fee2e2",
            color: "#dc2626",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          ✕ Clear
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4.2: Type-check**

Run: `cd frontend/task-tracker && npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 4.3: Commit**

```bash
git add frontend/task-tracker/src/components/calendar/CalendarToolbar.tsx
git commit -m "feat(calendar): add CalendarToolbar w/ layer toggle pills"
```

---

## Task 5: Build `CalendarLegend` presentational component

**Files:**
- Create: `frontend/task-tracker/src/components/calendar/CalendarLegend.tsx`

- [ ] **Step 5.1: Create the component**

Create `frontend/task-tracker/src/components/calendar/CalendarLegend.tsx`:

```tsx
import { COLUMNS } from "@/utils/task";
import {
  MEMBER_PALETTE as EMP_COLORS,
  type MemberPalette,
} from "@/utils/avatar";

interface CalendarLegendProps {
  showTasks: boolean;
  showPlans: boolean;
  /** Member names → palette index, used so colours match cell chips. */
  empColorMap: Record<string, MemberPalette>;
  /** Members that actually have plans visible, alphabetically. */
  activeMembers: string[];
}

export default function CalendarLegend({
  showTasks,
  showPlans,
  empColorMap,
  activeMembers,
}: CalendarLegendProps) {
  if (!showTasks && !showPlans) return null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        marginBottom: 12,
      }}
    >
      {showTasks && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
          }}
        >
          {COLUMNS.map((c) => (
            <span
              key={c.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 3,
                fontSize: 11,
                color: "#1e293b",
                fontWeight: 500,
              }}
            >
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: c.color,
                  display: "inline-block",
                  flexShrink: 0,
                }}
              />
              {c.title}
            </span>
          ))}
          <span style={{ fontSize: 11, color: "#1e293b", fontWeight: 500 }}>
            ⟳ = Recurring
          </span>
        </div>
      )}

      {showPlans && activeMembers.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            padding: "6px 10px",
            background: "#f8fafc",
            borderRadius: 8,
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#64748b",
              marginRight: 4,
            }}
          >
            LEGEND:
          </span>
          {activeMembers.map((n) => {
            const c = empColorMap[n] || EMP_COLORS[0];
            return (
              <span
                key={n}
                style={{
                  background: c.bg,
                  color: c.text,
                  border: `1.5px solid ${c.dot}`,
                  padding: "3px 10px",
                  borderRadius: 20,
                  fontSize: 12,
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: c.dot,
                    display: "inline-block",
                    flexShrink: 0,
                  }}
                />
                {n}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5.2: Type-check**

Run: `cd frontend/task-tracker && npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 5.3: Commit**

```bash
git add frontend/task-tracker/src/components/calendar/CalendarLegend.tsx
git commit -m "feat(calendar): add layer-aware CalendarLegend"
```

---

## Task 6: Build `UnifiedDayCell` presentational component

**Files:**
- Create: `frontend/task-tracker/src/components/calendar/UnifiedDayCell.tsx`

- [ ] **Step 6.1: Create the component**

Create `frontend/task-tracker/src/components/calendar/UnifiedDayCell.tsx`:

```tsx
import type { ReactNode } from "react";
import { COLUMNS } from "@/utils/task";
import {
  MEMBER_PALETTE as EMP_COLORS,
  type MemberPalette,
} from "@/utils/avatar";
import { toMins, fromMins } from "@/utils/time";
import type { Task, WorkPlan } from "@/types";

interface UnifiedDayCellProps {
  dayNumber: number;
  isToday: boolean;
  isWeekend: boolean;
  tasks: Task[]; // already sorted by status
  plans: WorkPlan[]; // already sorted by date (within day, source order)
  showTasks: boolean;
  showPlans: boolean;
  empColorMap: Record<string, MemberPalette>;
  onClick: () => void;
}

const SECTION_LIMIT = 2;

export default function UnifiedDayCell({
  dayNumber,
  isToday,
  isWeekend,
  tasks,
  plans,
  showTasks,
  showPlans,
  empColorMap,
  onClick,
}: UnifiedDayCellProps) {
  const hasTasks = showTasks && tasks.length > 0;
  const hasPlans = showPlans && plans.length > 0;
  const hasAny = hasTasks || hasPlans;

  const visibleTasks = showTasks ? tasks.slice(0, SECTION_LIMIT) : [];
  const taskExtra = showTasks ? Math.max(0, tasks.length - SECTION_LIMIT) : 0;

  const visiblePlans = showPlans ? plans.slice(0, SECTION_LIMIT) : [];
  const planExtra = showPlans ? Math.max(0, plans.length - SECTION_LIMIT) : 0;

  const totalPlanMins = plans.reduce(
    (s, p) => s + toMins(p.hours_planned),
    0,
  );

  // Top-right badge: plans on → planned-hours; plans off → task-count.
  let badge: ReactNode = null;
  if (showPlans && plans.length > 0) {
    badge = (
      <span
        style={{
          fontSize: 9,
          color: "#0f766e",
          fontWeight: 700,
          background: "#ccfbf1",
          borderRadius: 3,
          padding: "1px 4px",
          lineHeight: 1.4,
        }}
        title={`${fromMins(totalPlanMins)} planned · ${plans.length} plan${plans.length !== 1 ? "s" : ""}`}
      >
        {fromMins(totalPlanMins)}
      </span>
    );
  } else if (showTasks && tasks.length > 0) {
    badge = (
      <span
        style={{
          fontSize: 9,
          color: "#2563eb",
          fontWeight: 700,
          background: "#eff6ff",
          borderRadius: 3,
          padding: "1px 4px",
          lineHeight: 1.4,
        }}
      >
        {tasks.length} ⤢
      </span>
    );
  }

  return (
    <div
      onClick={hasAny ? onClick : undefined}
      style={{
        minHeight: showPlans ? 130 : 90,
        padding: 4,
        borderRight: "1px solid #f1f5f9",
        borderBottom: "1px solid #f1f5f9",
        background: isToday ? "#eff6ff" : isWeekend ? "#fafafa" : "white",
        cursor: hasAny ? "pointer" : "default",
        position: "relative",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 2,
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: isToday ? "#2563eb" : "transparent",
            color: isToday ? "#fff" : isWeekend ? "#ef4444" : "#374151",
            fontSize: 12,
            fontWeight: isToday ? 700 : 500,
            textAlign: "center",
            lineHeight: "22px",
          }}
        >
          {dayNumber}
        </span>
        {badge}
      </div>

      {/* Tasks section */}
      {showTasks && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {visibleTasks.map((t, i) => {
            const col = COLUMNS.find((c) => c.id === t.status);
            const isRec = t.recurrence && t.recurrence !== "Onetime";
            return (
              <div
                key={t.id + "-t-" + i}
                title={`${t.description} — ${t.responsible}${isRec ? " (⟳ " + t.recurrence + ")" : ""}\nStatus: ${t.status}`}
                style={{
                  background: col?.color || "#888",
                  color: "#fff",
                  borderRadius: 3,
                  fontSize: 10,
                  padding: "1px 4px",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  cursor: "pointer",
                }}
              >
                {isRec ? "⟳ " : ""}
                {(t.description || "").slice(0, 16)}
                {(t.description || "").length > 16 ? "…" : ""}
              </div>
            );
          })}
          {taskExtra > 0 && (
            <div
              style={{
                fontSize: 10,
                color: "#2563eb",
                fontWeight: 600,
                padding: "1px 0",
              }}
            >
              +{taskExtra} more
            </div>
          )}
        </div>
      )}

      {/* Divider only if BOTH sections have content */}
      {showTasks && tasks.length > 0 && showPlans && plans.length > 0 && (
        <div
          style={{
            borderTop: "1px dashed #e2e8f0",
            margin: "4px 0 3px",
          }}
        />
      )}

      {/* Plans section */}
      {showPlans && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {visiblePlans.map((p, i) => {
            const c = empColorMap[p.name] || EMP_COLORS[0];
            const initials = (p.name || "?")
              .split(" ")
              .map((w) => w[0])
              .join("")
              .slice(0, 2)
              .toUpperCase();
            const label = p.client || p.task_description || p.name;
            return (
              <div
                key={p.id + "-p-" + i}
                title={`${p.name}${p.client ? " → " + p.client : ""}\n${p.task_description || ""}${p.hours_planned ? " (" + p.hours_planned + "hrs)" : ""}`}
                style={{
                  background: c.bg,
                  color: c.text,
                  border: `1px solid ${c.dot}`,
                  borderRadius: 4,
                  padding: "2px 5px",
                  fontSize: 10,
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                  overflow: "hidden",
                }}
              >
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: c.dot,
                    color: "#fff",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 8,
                    fontWeight: 800,
                    flexShrink: 0,
                  }}
                >
                  {initials}
                </span>
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                  }}
                >
                  {label}
                </span>
              </div>
            );
          })}
          {planExtra > 0 && (
            <div
              style={{
                fontSize: 10,
                color: "#64748b",
                fontWeight: 600,
                paddingLeft: 2,
              }}
            >
              +{planExtra} more
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6.2: Type-check**

Run: `cd frontend/task-tracker && npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 6.3: Commit**

```bash
git add frontend/task-tracker/src/components/calendar/UnifiedDayCell.tsx
git commit -m "feat(calendar): add UnifiedDayCell w/ tasks + plans sections"
```

---

## Task 7: Build `UnifiedDayModal` presentational component

**Files:**
- Create: `frontend/task-tracker/src/components/calendar/UnifiedDayModal.tsx`

- [ ] **Step 7.1: Create the component**

Create `frontend/task-tracker/src/components/calendar/UnifiedDayModal.tsx`:

```tsx
import { COLUMNS } from "@/utils/task";
import {
  MEMBER_PALETTE as EMP_COLORS,
  type MemberPalette,
} from "@/utils/avatar";
import { toMins, fromMins } from "@/utils/time";
import type { Task, WorkPlan } from "@/types";

interface UnifiedDayModalProps {
  dateLabel: string; // e.g. "8 May 2026"
  tasks: Task[];
  plans: WorkPlan[];
  showTasks: boolean;
  showPlans: boolean;
  empColorMap: Record<string, MemberPalette>;
  onClose: () => void;
}

export default function UnifiedDayModal({
  dateLabel,
  tasks,
  plans,
  showTasks,
  showPlans,
  empColorMap,
  onClose,
}: UnifiedDayModalProps) {
  const renderTasks = showTasks && tasks.length > 0;
  const renderPlans = showPlans && plans.length > 0;
  const totalPlanMins = plans.reduce(
    (s, p) => s + toMins(p.hours_planned),
    0,
  );

  const summaryParts: string[] = [];
  if (showTasks) summaryParts.push(`${tasks.length} task${tasks.length !== 1 ? "s" : ""}`);
  if (showPlans) summaryParts.push(`${plans.length} plan${plans.length !== 1 ? "s" : ""}`);
  if (showPlans && plans.length > 0)
    summaryParts.push(`${fromMins(totalPlanMins)} planned hrs`);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          width: 560,
          maxWidth: "94vw",
          maxHeight: "82vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,.25)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#1e293b" }}>
              📅 {dateLabel}
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
              {summaryParts.join(" · ")}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: 18,
              cursor: "pointer",
              color: "#64748b",
              padding: "4px 8px",
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            overflowY: "auto",
            padding: 14,
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {renderTasks && (
            <section>
              <h4
                style={{
                  margin: "0 0 8px",
                  fontSize: 12,
                  fontWeight: 800,
                  color: "#475569",
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                }}
              >
                Tasks ({tasks.length})
              </h4>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {tasks.map((t, i) => {
                  const col = COLUMNS.find((c) => c.id === t.status);
                  const isRec = t.recurrence && t.recurrence !== "Onetime";
                  return (
                    <div
                      key={t.id + "-tm-" + i}
                      style={{
                        border: "1px solid #e2e8f0",
                        borderRadius: 8,
                        padding: "10px 12px",
                        borderLeft: `4px solid ${col?.color || "#888"}`,
                        background: "#fafafa",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          marginBottom: 4,
                          flexWrap: "wrap",
                        }}
                      >
                        <span
                          style={{
                            background: col?.color || "#888",
                            color: "#fff",
                            fontSize: 10,
                            padding: "2px 7px",
                            borderRadius: 4,
                            fontWeight: 600,
                          }}
                        >
                          {t.status}
                        </span>
                        {isRec && (
                          <span
                            style={{
                              background: "#ede9fe",
                              color: "#7c3aed",
                              fontSize: 10,
                              padding: "2px 7px",
                              borderRadius: 4,
                              fontWeight: 600,
                            }}
                          >
                            ⟳ {t.recurrence}
                          </span>
                        )}
                        <span
                          style={{
                            fontSize: 11,
                            color: "#64748b",
                            marginLeft: "auto",
                          }}
                        >
                          {t.client}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "#1e293b",
                          marginBottom: 2,
                        }}
                      >
                        {t.description}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          gap: 12,
                          fontSize: 11,
                          color: "#64748b",
                          flexWrap: "wrap",
                        }}
                      >
                        <span>👤 {t.responsible}</span>
                        <span>🏷 {t.category}</span>
                        {t.remarks && <span>💬 {t.remarks}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {renderPlans && (
            <section>
              <h4
                style={{
                  margin: "0 0 8px",
                  fontSize: 12,
                  fontWeight: 800,
                  color: "#475569",
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                }}
              >
                Work Plans ({plans.length} · {fromMins(totalPlanMins)} hrs)
              </h4>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))",
                  gap: 10,
                }}
              >
                {plans.map((p, i) => {
                  const c = empColorMap[p.name] || EMP_COLORS[0];
                  const initials = (p.name || "?")
                    .split(" ")
                    .map((w) => w[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase();
                  return (
                    <div
                      key={p.id + "-pm-" + i}
                      style={{
                        display: "flex",
                        gap: 12,
                        alignItems: "flex-start",
                        padding: "10px 14px",
                        borderRadius: 8,
                        background: c.bg,
                        border: `1.5px solid ${c.dot}`,
                      }}
                    >
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: "50%",
                          background: c.dot,
                          color: "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 12,
                          fontWeight: 800,
                          flexShrink: 0,
                        }}
                      >
                        {initials}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 700,
                            color: c.text,
                            fontSize: 13,
                          }}
                        >
                          {p.name}
                        </div>
                        {p.client && (
                          <div
                            style={{
                              fontSize: 12,
                              color: "#475569",
                              marginTop: 3,
                            }}
                          >
                            🏢 {p.client}
                          </div>
                        )}
                        <div
                          style={{
                            fontSize: 12,
                            color: "#374151",
                            marginTop: 4,
                            lineHeight: 1.4,
                          }}
                        >
                          📋 {p.task_description}
                        </div>
                        {p.hours_planned && (
                          <div
                            style={{
                              fontSize: 12,
                              color: "#2563eb",
                              marginTop: 4,
                              fontWeight: 700,
                            }}
                          >
                            ⏱ {p.hours_planned} hrs
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {!renderTasks && !renderPlans && (
            <p
              style={{
                color: "#94a3b8",
                fontSize: 13,
                textAlign: "center",
                padding: "12px 0",
              }}
            >
              Nothing scheduled for this day.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7.2: Type-check**

Run: `cd frontend/task-tracker && npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 7.3: Commit**

```bash
git add frontend/task-tracker/src/components/calendar/UnifiedDayModal.tsx
git commit -m "feat(calendar): add UnifiedDayModal w/ tasks + plans sections"
```

---

## Task 8: Rewrite `CalendarPage` to wire it all together

**Files:**
- Modify: `frontend/task-tracker/src/pages/CalendarPage.tsx`

This task replaces the current `CalendarPage.tsx` end-to-end. The legacy file's logic for task filtering / role visibility / recurring projection is preserved verbatim — only the rendering layer and toolbar change, and plans data is added.

- [ ] **Step 8.1: Replace `CalendarPage.tsx` content**

Overwrite `frontend/task-tracker/src/pages/CalendarPage.tsx` with:

```tsx
import { useMemo, useState, useEffect } from "react";
import {
  COLUMNS,
  computeStatus,
  getProjectedDate,
  hasRecurringInstance,
} from "@/utils/task";
import {
  MEMBER_PALETTE as EMP_COLORS,
  type MemberPalette,
} from "@/utils/avatar";
import {
  loadLayers,
  saveLayers,
  tasksVisible,
  plansVisible,
  type CalendarLayers,
} from "@/utils/calendarLayers";
import { useAuth } from "@/hooks/useAuth";
import { useWorkPlans } from "@/hooks/useWorkPlans";
import CalendarToolbar from "@/components/calendar/CalendarToolbar";
import CalendarLegend from "@/components/calendar/CalendarLegend";
import UnifiedDayCell from "@/components/calendar/UnifiedDayCell";
import UnifiedDayModal from "@/components/calendar/UnifiedDayModal";
import type { Profile, Task, TaskStatus, WorkPlan } from "@/types";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface CalendarPageProps {
  tasks: Task[];
  profile: Profile | null;
  profiles?: Profile[];
}

const STATUS_ORDER: Record<TaskStatus, number> = {
  Overdue: 0,
  TodayTask: 1,
  Tomorrow: 2,
  Pending: 3,
  TBC: 4,
  Ontime: 5,
  "Completed Delay": 6,
  Completed: 7,
  "Future Task/Goals": 8,
};

export default function CalendarPage({
  tasks,
  profile,
  profiles = [],
}: CalendarPageProps) {
  const { isAdminInAny, isManagerInAny } = useAuth();
  const { plans: allPlans } = useWorkPlans();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [expandDay, setExpandDay] = useState<number | null>(null);
  const [fClient, setFClient] = useState("");
  const [fMember, setFMember] = useState("");
  const [layers, setLayers] = useState<CalendarLayers>(() => loadLayers());

  useEffect(() => {
    saveLayers(layers);
  }, [layers]);

  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const isAdmin = isAdminInAny();
  const isManager = isManagerInAny() && !isAdmin;
  const myName = profile?.full_name || "";

  // --- Role-based visibility (parallels existing tasks logic, applied to plans). ---
  const managedNames = useMemo(() => {
    if (!isManager || !profile) return [] as string[];
    return profiles
      .filter((p) => (p.manager_ids ?? []).includes(profile.id))
      .map((p) => p.full_name || "");
  }, [isManager, profile, profiles]);

  const visibleTasks = useMemo(() => {
    if (isAdmin) return tasks;
    if (isManager)
      return tasks.filter(
        (t) => t.responsible === myName || managedNames.includes(t.responsible),
      );
    return tasks.filter((t) => t.responsible === myName);
  }, [tasks, isAdmin, isManager, myName, managedNames]);

  const visiblePlans = useMemo(() => {
    if (isAdmin) return allPlans;
    if (isManager)
      return allPlans.filter(
        (p) => p.name === myName || managedNames.includes(p.name),
      );
    return allPlans.filter((p) => p.name === myName);
  }, [allPlans, isAdmin, isManager, myName, managedNames]);

  // --- Tasks projection for the visible month, including recurring instances. ---
  const monthTasks = useMemo(() => {
    const out: Task[] = [];
    visibleTasks.forEach((t) => {
      const r = t.recurrence || "Onetime";
      if (!t.targetDate) return;
      if (r === "Onetime") {
        const taskMonth = `${year}-${String(month + 1).padStart(2, "0")}`;
        if (t.targetDate.startsWith(taskMonth)) out.push(t);
      } else if (hasRecurringInstance(t, year, month)) {
        const projectedDate = getProjectedDate(t, year, month);
        const origMonth = (t.targetDate || "").slice(0, 7);
        const calMonth = `${year}-${String(month + 1).padStart(2, "0")}`;
        const isDiffCycle = origMonth !== calMonth;
        const projectedTask: Task = {
          ...t,
          targetDate: projectedDate,
          ...(isDiffCycle
            ? { expectedDate: "", completedDate: "", remarks: "" }
            : {}),
        };
        const taskStatus = computeStatus(projectedTask);
        out.push({ ...projectedTask, status: taskStatus });
      }
    });
    return out;
  }, [visibleTasks, year, month]);

  const unscheduledTasks = useMemo(
    () => visibleTasks.filter((t) => !t.targetDate),
    [visibleTasks],
  );

  // --- Plans projection for the visible month. ---
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const monthPlans = useMemo(
    () => visiblePlans.filter((p) => (p.date || "").startsWith(monthPrefix)),
    [visiblePlans, monthPrefix],
  );

  // --- Filter option lists are union of tasks + plans (pre-filter). ---
  const clientOptions = useMemo(
    () =>
      [
        ...new Set(
          [
            ...visibleTasks.map((t) => t.client || ""),
            ...visiblePlans.map((p) => p.client || ""),
          ].filter(Boolean),
        ),
      ].sort(),
    [visibleTasks, visiblePlans],
  );
  const memberOptions = useMemo(
    () =>
      [
        ...new Set(
          [
            ...visibleTasks.map((t) => t.responsible || ""),
            ...visiblePlans.map((p) => p.name || ""),
          ].filter(Boolean),
        ),
      ].sort(),
    [visibleTasks, visiblePlans],
  );

  // --- Apply filters. ---
  const filteredMonthTasks = useMemo(
    () =>
      monthTasks.filter(
        (t) =>
          (!fClient || t.client === fClient) &&
          (!fMember || t.responsible === fMember),
      ),
    [monthTasks, fClient, fMember],
  );
  const filteredMonthPlans = useMemo(
    () =>
      monthPlans.filter(
        (p) =>
          (!fClient || p.client === fClient) &&
          (!fMember || p.name === fMember),
      ),
    [monthPlans, fClient, fMember],
  );

  // --- Group by day. ---
  const tasksByDay = useMemo(() => {
    const m: Record<number, Task[]> = {};
    filteredMonthTasks.forEach((t) => {
      const d = parseInt(t.targetDate.split("-")[2], 10);
      if (!m[d]) m[d] = [];
      m[d].push(t);
    });
    Object.values(m).forEach((arr) =>
      arr.sort(
        (a, b) =>
          (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9),
      ),
    );
    return m;
  }, [filteredMonthTasks]);
  const plansByDay = useMemo(() => {
    const m: Record<number, WorkPlan[]> = {};
    filteredMonthPlans.forEach((p) => {
      const d = parseInt((p.date || "").split("-")[2], 10);
      if (!d) return;
      if (!m[d]) m[d] = [];
      m[d].push(p);
    });
    return m;
  }, [filteredMonthPlans]);

  // --- Employee colour map (stable across all visible plan members). ---
  const empColorMap = useMemo<Record<string, MemberPalette>>(() => {
    const names = [
      ...new Set(visiblePlans.map((p) => p.name).filter(Boolean)),
    ].sort();
    const out: Record<string, MemberPalette> = {};
    names.forEach((n, i) => {
      out[n] = EMP_COLORS[i % EMP_COLORS.length];
    });
    return out;
  }, [visiblePlans]);

  const activeMembers = useMemo(
    () => [...new Set(filteredMonthPlans.map((p) => p.name).filter(Boolean))].sort(),
    [filteredMonthPlans],
  );

  // --- Calendar grid setup. ---
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOff = (firstDay.getDay() + 6) % 7;

  const prevMonth = () => {
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else setMonth((m) => m + 1);
  };
  const goToday = () => {
    setYear(now.getFullYear());
    setMonth(now.getMonth());
  };

  const showT = tasksVisible(layers);
  const showP = plansVisible(layers);

  // --- Day modal data. ---
  const expandTasks =
    expandDay !== null ? tasksByDay[expandDay] || [] : [];
  const expandPlans =
    expandDay !== null ? plansByDay[expandDay] || [] : [];
  const expandDateLabel =
    expandDay !== null
      ? `${expandDay} ${MONTHS[month]} ${year}`
      : "";

  return (
    <div style={{ padding: "16px 20px" }}>
      <CalendarToolbar
        monthLabel={`${MONTHS[month]} ${year}`}
        onPrev={prevMonth}
        onNext={nextMonth}
        onToday={goToday}
        layers={layers}
        onLayersChange={(v) => {
          setLayers(v);
          setExpandDay(null);
        }}
        clientOptions={clientOptions}
        memberOptions={memberOptions}
        fClient={fClient}
        fMember={fMember}
        onClientChange={(v) => {
          setFClient(v);
          setExpandDay(null);
        }}
        onMemberChange={(v) => {
          setFMember(v);
          setExpandDay(null);
        }}
        onClear={() => {
          setFClient("");
          setFMember("");
          setExpandDay(null);
        }}
      />

      <CalendarLegend
        showTasks={showT}
        showPlans={showP}
        empColorMap={empColorMap}
        activeMembers={activeMembers}
      />

      <div
        style={{
          background: "#fff",
          borderRadius: 10,
          boxShadow: "0 1px 4px rgba(0,0,0,.08)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7,1fr)",
            background: "#f8fafc",
          }}
        >
          {DAYS.map((d) => (
            <div
              key={d}
              style={{
                padding: "8px 4px",
                textAlign: "center",
                fontSize: 12,
                fontWeight: 700,
                color: "#475569",
                borderBottom: "1px solid #e2e8f0",
              }}
            >
              {d}
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)" }}>
          {Array.from({ length: startOff }).map((_, i) => (
            <div
              key={`e${i}`}
              style={{
                minHeight: showP ? 130 : 90,
                borderRight: "1px solid #f1f5f9",
                borderBottom: "1px solid #f1f5f9",
                background: "#fafafa",
              }}
            />
          ))}

          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
            const ds = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            const isToday = ds === todayStr;
            const dow = new Date(year, month, d).getDay();
            const isWeekend = dow === 0 || dow === 6;
            return (
              <UnifiedDayCell
                key={d}
                dayNumber={d}
                isToday={isToday}
                isWeekend={isWeekend}
                tasks={tasksByDay[d] || []}
                plans={plansByDay[d] || []}
                showTasks={showT}
                showPlans={showP}
                empColorMap={empColorMap}
                onClick={() => setExpandDay(d)}
              />
            );
          })}
        </div>
      </div>

      {/* Unscheduled tasks panel — only when Tasks layer is visible. */}
      {showT && unscheduledTasks.length > 0 && (
        <div
          style={{
            background: "#fff",
            borderRadius: 10,
            padding: 14,
            boxShadow: "0 1px 4px rgba(0,0,0,.08)",
            marginTop: 12,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
            📋 Unscheduled Tasks ({unscheduledTasks.length})
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {unscheduledTasks.map((t) => {
              const col = COLUMNS.find((c) => c.id === t.status);
              return (
                <span
                  key={t.id}
                  title={t.responsible}
                  style={{
                    background: col?.color || "#888",
                    color: "#fff",
                    borderRadius: 4,
                    fontSize: 11,
                    padding: "2px 8px",
                  }}
                >
                  {(t.description || "").slice(0, 28)}
                  {isAdmin || isManager ? ` (${t.responsible || ""})` : ""}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {expandDay !== null && (
        <UnifiedDayModal
          dateLabel={expandDateLabel}
          tasks={expandTasks}
          plans={expandPlans}
          showTasks={showT}
          showPlans={showP}
          empColorMap={empColorMap}
          onClose={() => setExpandDay(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 8.2: Type-check**

Run: `cd frontend/task-tracker && npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 8.3: Run all tests**

Run: `cd frontend/task-tracker && npm run test`
Expected: full suite green (no regressions in worklog/dashboard/etc.).

- [ ] **Step 8.4: Smoke-test in browser**

Run: `cd frontend/task-tracker && npm run dev` and exercise the Calendar page:
- Default view shows Tasks + Plans together. Reload the page; the same toggle is still active (localStorage).
- Switch to **Tasks** layer → only task chips, status legend only, `N ⤢` badge in cells.
- Switch to **Plans** layer → only plan chips, employee legend only, `Xhr` badge in cells.
- Switch to **Both** → both sections, dashed divider visible on busy days, both legends, `Xhr` badge in cells.
- Set a Client filter and a Member filter — confirm both sections obey them. Click ✕ Clear.
- Click a busy day → modal shows Tasks section + Plans section (each present only if its layer is on and has items).
- Verify Work Log → Calendar tab still works (regression check from Task 2).
- As an employee account (non-admin), verify only own tasks/plans are visible in both layers.

- [ ] **Step 8.5: Commit**

```bash
git add frontend/task-tracker/src/pages/CalendarPage.tsx
git commit -m "feat(calendar): unified tasks + work plans view

CalendarPage now renders both layers simultaneously with a
Both/Tasks/Plans toggle (persisted in localStorage), shared
client/member filters, layer-aware legend, and a merged
day-detail modal. Plan data comes from the shared
useWorkPlans hook; role-based visibility mirrors tasks."
```

---

## Task 9: Final verification + push

- [ ] **Step 9.1: Full test suite**

Run: `cd frontend/task-tracker && npm run test`
Expected: all green.

- [ ] **Step 9.2: Type-check + lint**

Run: `cd frontend/task-tracker && npx tsc -b --noEmit && npm run lint`
Expected: no errors. (If `lint` does not exist as a script, skip — `tsc -b` is the project's main static gate per existing CI workflow.)

- [ ] **Step 9.3: Push to remote**

```bash
git push origin HEAD
```

(Per the user's auto-push memory, push without asking once feature work is verified.)

---

## Self-Review Notes

- **Spec coverage:**
  - §1 Cell layout → Task 6 (UnifiedDayCell), wired in Task 8.
  - §2 Toolbar (layer toggle, shared filters) → Task 4 + Task 8.
  - §3 Layer-aware legend → Task 5 + Task 8.
  - §4 Day expand modal → Task 7 + Task 8.
  - §5 useWorkPlans hook → Task 1 + Task 2.
  - §6 Out of scope (no add/edit on calendar, no DnD, Work Log calendar untouched, unscheduled stays tasks-only) → Task 8 obeys all.
  - Acceptance criteria 1-8 → covered by Task 8 smoke test in §Step 8.4.
- **Cell badge rule:** spec was edited to clarify; Task 6 implements exactly the documented `Xhr` (plans on) vs `N ⤢` (plans off) behaviour.
- **Identifiers used in later tasks** (`useWorkPlans`, `loadLayers`, `saveLayers`, `tasksVisible`, `plansVisible`, `CalendarLayers`, `UnifiedDayCell`, `UnifiedDayModal`, `CalendarToolbar`, `CalendarLegend`) all match their definitions.
