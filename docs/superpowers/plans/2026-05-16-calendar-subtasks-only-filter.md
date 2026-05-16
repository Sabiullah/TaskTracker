# Calendar Subtasks-Only Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toolbar toggle on the Calendar page that, when ON, filters the calendar grid and day modal to only materialized child subtasks (rows with `parentId !== null`), prefixes each subtask pill with its parent goal label, and hides the "Unscheduled Tasks" panel.

**Architecture:** A new boolean `subtasksOnly` is introduced alongside the existing `CalendarLayers` (`"both" | "tasks" | "plans"`). It is persisted in its own localStorage key, controlled by a pill button in `CalendarToolbar`, and applied upstream in `CalendarPage` so it flows through to `tasksByDay`, the day modal, and the unscheduled panel. A `mainsById` map carrying parent goal `description` is threaded into `UnifiedDayCell` and `UnifiedDayModal` to resolve the parent label per subtask.

**Tech Stack:** React + TypeScript (Vite), Vitest + Testing Library, localStorage for persistence.

---

## File Structure

**Files created:**
- `frontend/task-tracker/src/__tests__/pages/calendarPage.subtasksOnly.test.tsx` — smoke test for the new filter behavior.

**Files modified:**
- `frontend/task-tracker/src/utils/calendarLayers.ts` — add `loadSubtasksOnly` / `saveSubtasksOnly` helpers.
- `frontend/task-tracker/src/__tests__/utils/calendarLayers.test.ts` — extend with new helper tests.
- `frontend/task-tracker/src/components/calendar/CalendarToolbar.tsx` — add the "Subtasks only" pill button + new props.
- `frontend/task-tracker/src/components/calendar/UnifiedDayCell.tsx` — accept `mainsById`, prefix subtask pills.
- `frontend/task-tracker/src/components/calendar/UnifiedDayModal.tsx` — accept `mainsById`, add `Part of:` line on subtask cards.
- `frontend/task-tracker/src/pages/CalendarPage.tsx` — filter state, persistence, upstream filtering, unscheduled panel guard, prop wiring.
- `frontend/task-tracker/src/App.tsx` — extend `mainsById` shape to include `description`, pass through to `CalendarPage`.

---

## Task 1: Persistence helpers for `subtasksOnly`

**Files:**
- Modify: `frontend/task-tracker/src/utils/calendarLayers.ts`
- Test: `frontend/task-tracker/src/__tests__/utils/calendarLayers.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `frontend/task-tracker/src/__tests__/utils/calendarLayers.test.ts` inside the existing `describe("calendarLayers", ...)` block (before its closing `});`):

```ts
  it("loadSubtasksOnly defaults to false when nothing is stored", () => {
    expect(loadSubtasksOnly()).toBe(false);
  });

  it("loadSubtasksOnly returns false for invalid stored values", () => {
    localStorage.setItem(SUBTASKS_ONLY_KEY, "garbage");
    expect(loadSubtasksOnly()).toBe(false);
  });

  it("saveSubtasksOnly round-trips both true and false", () => {
    saveSubtasksOnly(true);
    expect(loadSubtasksOnly()).toBe(true);
    saveSubtasksOnly(false);
    expect(loadSubtasksOnly()).toBe(false);
  });
```

And extend the top import to pull in the new symbols:

```ts
import {
  CALENDAR_LAYERS_KEY,
  SUBTASKS_ONLY_KEY,
  loadLayers,
  saveLayers,
  loadSubtasksOnly,
  saveSubtasksOnly,
  tasksVisible,
  plansVisible,
  type CalendarLayers,
} from "@/utils/calendarLayers";
```

- [ ] **Step 2: Run the tests and verify they fail**

Run from `frontend/task-tracker/`:

```
npx vitest run src/__tests__/utils/calendarLayers.test.ts
```

Expected: the three new tests fail because `SUBTASKS_ONLY_KEY`, `loadSubtasksOnly`, `saveSubtasksOnly` are not exported yet (TypeScript / import error).

- [ ] **Step 3: Implement the helpers**

Append to `frontend/task-tracker/src/utils/calendarLayers.ts`:

```ts
export const SUBTASKS_ONLY_KEY = "tasktracker.calendar.subtasksOnly";

export function loadSubtasksOnly(): boolean {
  try {
    const raw = localStorage.getItem(SUBTASKS_ONLY_KEY);
    return raw === "1";
  } catch {
    return false;
  }
}

export function saveSubtasksOnly(v: boolean): void {
  try {
    localStorage.setItem(SUBTASKS_ONLY_KEY, v ? "1" : "0");
  } catch {
    // ignore quota / privacy failures
  }
}
```

- [ ] **Step 4: Run the tests and verify they pass**

```
npx vitest run src/__tests__/utils/calendarLayers.test.ts
```

Expected: all tests (existing + new three) pass.

- [ ] **Step 5: Commit**

```
git add frontend/task-tracker/src/utils/calendarLayers.ts frontend/task-tracker/src/__tests__/utils/calendarLayers.test.ts
git commit -m "feat(calendar): add subtasksOnly persistence helpers"
```

---

## Task 2: "Subtasks only" pill button in `CalendarToolbar`

**Files:**
- Modify: `frontend/task-tracker/src/components/calendar/CalendarToolbar.tsx`

This task is a pure component change. We extend the props and render the new button. Functional behavior is exercised end-to-end in Task 6.

- [ ] **Step 1: Add the new props and render the pill**

Replace the props interface in `frontend/task-tracker/src/components/calendar/CalendarToolbar.tsx`:

```ts
interface CalendarToolbarProps {
  monthLabel: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;

  layers: CalendarLayers;
  onLayersChange: (v: CalendarLayers) => void;

  subtasksOnly: boolean;
  onSubtasksOnlyChange: (v: boolean) => void;

  clientOptions: string[];
  memberOptions: string[];
  fClient: string;
  fMember: string;
  onClientChange: (v: string) => void;
  onMemberChange: (v: string) => void;
  onClear: () => void;
}
```

Extend the destructure inside `CalendarToolbar` to include the new props:

```ts
  const {
    monthLabel,
    onPrev,
    onNext,
    onToday,
    layers,
    onLayersChange,
    subtasksOnly,
    onSubtasksOnlyChange,
    clientOptions,
    memberOptions,
    fClient,
    fMember,
    onClientChange,
    onMemberChange,
    onClear,
  } = props;
```

Immediately after the closing `</div>` of the existing layer-toggle group (the `<div role="group" aria-label="Calendar layers" ...>`), add the pill button:

```tsx
      {/* Subtasks-only filter — orthogonal to the layer toggle. */}
      <button
        type="button"
        aria-pressed={subtasksOnly}
        aria-label="Show subtasks only"
        disabled={layers === "plans"}
        onClick={() => onSubtasksOnlyChange(!subtasksOnly)}
        style={{
          padding: "5px 12px",
          border: `1.5px solid ${subtasksOnly ? "#d97706" : "#cbd5e1"}`,
          borderRadius: 6,
          background: subtasksOnly ? "#f59e0b" : "#fff",
          color: subtasksOnly ? "#fff" : "#475569",
          fontSize: 12,
          fontWeight: 700,
          cursor: layers === "plans" ? "not-allowed" : "pointer",
          opacity: layers === "plans" ? 0.45 : 1,
        }}
      >
        Subtasks only
      </button>
```

- [ ] **Step 2: Type-check the change**

Run from `frontend/task-tracker/`:

```
npx tsc --noEmit
```

Expected: error about `CalendarToolbar` callers in `CalendarPage.tsx` missing the new required props. (We fix this in Task 5 — the error is expected here and tells us the prop shape is correctly flowing.) Note: do NOT proceed past this step without confirming the only `tsc` error points at `CalendarPage.tsx` mounting `<CalendarToolbar ...>`. Any other error means the change is wrong.

- [ ] **Step 3: Commit**

```
git add frontend/task-tracker/src/components/calendar/CalendarToolbar.tsx
git commit -m "feat(calendar): add Subtasks-only pill button to toolbar"
```

---

## Task 3: `UnifiedDayCell` — parent-goal prefix on subtask pills

**Files:**
- Modify: `frontend/task-tracker/src/components/calendar/UnifiedDayCell.tsx`

- [ ] **Step 1: Add the `mainsById` prop and the prefix logic**

Edit the imports at the top of `frontend/task-tracker/src/components/calendar/UnifiedDayCell.tsx` to include the `ID` type:

```ts
import type { Task, WorkPlan } from "@/types";
import type { ID } from "@/types/common";
```

Extend the props interface:

```ts
interface UnifiedDayCellProps {
  dayNumber: number;
  isToday: boolean;
  isWeekend: boolean;
  tasks: Task[]; // already sorted by status
  plans: WorkPlan[]; // already sorted by date (within day, source order)
  showTasks: boolean;
  showPlans: boolean;
  empColorMap: Record<string, MemberPalette>;
  mainsById: Map<ID, { description: string }>;
  onClick: () => void;
}
```

Extend the destructure:

```ts
export default function UnifiedDayCell({
  dayNumber,
  isToday,
  isWeekend,
  tasks,
  plans,
  showTasks,
  showPlans,
  empColorMap,
  mainsById,
  onClick,
}: UnifiedDayCellProps) {
```

Replace the existing task-pill render inside `visibleTasks.map(...)` with this version (the only change is the parent-prefix and the augmented title):

```tsx
          {visibleTasks.map((t, i) => {
            const col = COLUMNS.find((c) => c.id === t.status);
            const isRec = t.recurrence && t.recurrence !== "Onetime";
            const parent = t.parentId ? mainsById.get(t.parentId) : null;
            const parentLabel = parent
              ? (parent.description || "").slice(0, 10) +
                ((parent.description || "").length > 10 ? "…" : "")
              : "";
            const baseLabel = (t.description || "").slice(0, 16) +
              ((t.description || "").length > 16 ? "…" : "");
            const titleSuffix = parent
              ? `\nPart of: ${parent.description}`
              : "";
            return (
              <div
                key={t.id + "-t-" + i}
                title={`${t.description} — ${t.responsible}${isRec ? " (⟳ " + t.recurrence + ")" : ""}\nStatus: ${t.status}${titleSuffix}`}
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
                {parentLabel ? `${parentLabel} › ` : ""}
                {baseLabel}
              </div>
            );
          })}
```

- [ ] **Step 2: Type-check**

```
npx tsc --noEmit
```

Expected: the only new `tsc` error is in `CalendarPage.tsx` because the `<UnifiedDayCell ...>` callsite is missing `mainsById`. (Plus the pre-existing toolbar prop error from Task 2.) Both are wired up in Task 5.

- [ ] **Step 3: Commit**

```
git add frontend/task-tracker/src/components/calendar/UnifiedDayCell.tsx
git commit -m "feat(calendar): prefix subtask pills with parent goal label"
```

---

## Task 4: `UnifiedDayModal` — `Part of:` line on subtask cards

**Files:**
- Modify: `frontend/task-tracker/src/components/calendar/UnifiedDayModal.tsx`

- [ ] **Step 1: Add the `mainsById` prop and render the `Part of:` line**

Edit the imports at the top of `frontend/task-tracker/src/components/calendar/UnifiedDayModal.tsx`:

```ts
import type { Task, WorkPlan } from "@/types";
import type { ID } from "@/types/common";
```

Extend the props interface:

```ts
interface UnifiedDayModalProps {
  dateLabel: string; // e.g. "8 May 2026"
  tasks: Task[];
  plans: WorkPlan[];
  showTasks: boolean;
  showPlans: boolean;
  empColorMap: Record<string, MemberPalette>;
  mainsById: Map<ID, { description: string }>;
  onClose: () => void;
}
```

Extend the destructure:

```ts
export default function UnifiedDayModal({
  dateLabel,
  tasks,
  plans,
  showTasks,
  showPlans,
  empColorMap,
  mainsById,
  onClose,
}: UnifiedDayModalProps) {
```

Inside the existing `tasks.map((t, i) => { ... })` body, immediately after the line that resolves `const isRec = t.recurrence && t.recurrence !== "Onetime";`, add:

```tsx
                  const parent = t.parentId ? mainsById.get(t.parentId) : null;
```

Then, inside the same task-card JSX, find the existing description block:

```tsx
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
```

Insert this snippet immediately before that description block (so the `Part of:` line sits between the status/recurrence chips and the description):

```tsx
                      {parent && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "#64748b",
                            marginBottom: 2,
                          }}
                        >
                          Part of: {" "}
                          <strong style={{ color: "#475569" }}>
                            {parent.description}
                          </strong>
                        </div>
                      )}
```

- [ ] **Step 2: Type-check**

```
npx tsc --noEmit
```

Expected: still only the pre-existing prop-missing errors at `CalendarPage.tsx`. No new errors introduced by this change.

- [ ] **Step 3: Commit**

```
git add frontend/task-tracker/src/components/calendar/UnifiedDayModal.tsx
git commit -m "feat(calendar): show parent goal on subtask cards in day modal"
```

---

## Task 5: Wire the filter into `CalendarPage` and `App`

**Files:**
- Modify: `frontend/task-tracker/src/pages/CalendarPage.tsx`
- Modify: `frontend/task-tracker/src/App.tsx`

- [ ] **Step 1: Extend `App.tsx`'s `mainsById` and pass it to `CalendarPage`**

In `frontend/task-tracker/src/App.tsx`, find this block (around line 235):

```tsx
  const mainsById = useMemo(() => {
    const map = new Map<ID, { category: string; responsible: string }>();
    tasks.forEach((t) => {
      if (!t.parentId) {
        map.set(t.id, { category: t.category, responsible: t.responsible });
      }
    });
    return map;
  }, [tasks]);
```

Replace it with:

```tsx
  const mainsById = useMemo(() => {
    const map = new Map<
      ID,
      { category: string; responsible: string; description: string }
    >();
    tasks.forEach((t) => {
      if (!t.parentId) {
        map.set(t.id, {
          category: t.category,
          responsible: t.responsible,
          description: t.description,
        });
      }
    });
    return map;
  }, [tasks]);
```

Find the `CalendarPage` mount near line 395:

```tsx
    calendar: (
      <CalendarPage tasks={tasks} profile={profile} profiles={profiles} />
    ),
```

Replace with:

```tsx
    calendar: (
      <CalendarPage
        tasks={tasks}
        profile={profile}
        profiles={profiles}
        mainsById={mainsById}
      />
    ),
```

- [ ] **Step 2: Update `CalendarPage` to accept `mainsById`, hold `subtasksOnly` state, apply the filter, and pass props through**

Open `frontend/task-tracker/src/pages/CalendarPage.tsx`.

Extend the top imports to add the new helpers and the `ID` type:

```ts
import {
  loadLayers,
  saveLayers,
  loadSubtasksOnly,
  saveSubtasksOnly,
  tasksVisible,
  plansVisible,
  type CalendarLayers,
} from "@/utils/calendarLayers";
```

Add an import for `ID` (after the other type imports):

```ts
import type { Profile, Task, TaskStatus, WorkPlan } from "@/types";
import type { ID } from "@/types/common";
```

Extend the props interface:

```ts
interface CalendarPageProps {
  tasks: Task[];
  profile: Profile | null;
  profiles?: Profile[];
  mainsById: Map<
    ID,
    { category: string; responsible: string; description: string }
  >;
}
```

Update the component signature to destructure `mainsById`:

```ts
export default function CalendarPage({
  tasks,
  profile,
  profiles = [],
  mainsById,
}: CalendarPageProps) {
```

Inside the component, immediately after the existing `const [layers, setLayers] = useState<CalendarLayers>(() => loadLayers());` line, add:

```ts
  const [subtasksOnly, setSubtasksOnly] = useState<boolean>(() =>
    loadSubtasksOnly(),
  );
```

Immediately after the existing `useEffect(() => { saveLayers(layers); }, [layers]);` line, add:

```ts
  useEffect(() => {
    saveSubtasksOnly(subtasksOnly);
  }, [subtasksOnly]);
```

Apply the subtasks-only filter at the role-scoped tier. Replace the existing `visibleTasks` memo with a two-step pipeline:

```ts
  const roleScopedTasks = useMemo(() => {
    if (isAdmin) return tasks;
    if (isManager)
      return tasks.filter(
        (t) => t.responsible === myName || managedNames.includes(t.responsible),
      );
    return tasks.filter((t) => t.responsible === myName);
  }, [tasks, isAdmin, isManager, myName, managedNames]);

  const visibleTasks = useMemo(
    () =>
      subtasksOnly
        ? roleScopedTasks.filter((t) => t.parentId != null)
        : roleScopedTasks,
    [roleScopedTasks, subtasksOnly],
  );
```

Derive a calendar-shaped `mainsByIdSlim` for the cell/modal (we only need `description`):

```ts
  const mainsByIdSlim = useMemo(() => {
    const m = new Map<ID, { description: string }>();
    mainsById.forEach((v, k) => m.set(k, { description: v.description }));
    return m;
  }, [mainsById]);
```

Wire the toolbar's new props. Replace the existing `<CalendarToolbar ...>` mount with:

```tsx
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
        subtasksOnly={subtasksOnly}
        onSubtasksOnlyChange={(v) => {
          setSubtasksOnly(v);
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
```

Pass `mainsByIdSlim` into `UnifiedDayCell`. Replace the existing mount with:

```tsx
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
                mainsById={mainsByIdSlim}
                onClick={() => setExpandDay(d)}
              />
```

Pass `mainsByIdSlim` into `UnifiedDayModal`. Replace the existing mount with:

```tsx
      {expandDay !== null && (
        <UnifiedDayModal
          dateLabel={expandDateLabel}
          tasks={expandTasks}
          plans={expandPlans}
          showTasks={showT}
          showPlans={showP}
          empColorMap={empColorMap}
          mainsById={mainsByIdSlim}
          onClose={() => setExpandDay(null)}
        />
      )}
```

Gate the Unscheduled Tasks panel on `!subtasksOnly`. Replace the existing condition:

```tsx
      {/* Unscheduled tasks panel — only when Tasks layer is visible. */}
      {showT && unscheduledTasks.length > 0 && (
```

with:

```tsx
      {/* Unscheduled tasks panel — only when Tasks layer is visible and the
          Subtasks-only filter is off. Subtasks always carry a target_date via
          materialization, so the panel is empty under the filter and hidden
          to reduce noise. */}
      {!subtasksOnly && showT && unscheduledTasks.length > 0 && (
```

- [ ] **Step 3: Type-check**

```
cd frontend/task-tracker && npx tsc --noEmit
```

Expected: no errors. All previously expected errors (from Tasks 2 and 3) should now be resolved.

- [ ] **Step 4: Run the existing test suite for affected utilities/components**

```
cd frontend/task-tracker && npx vitest run src/__tests__/utils/calendarLayers.test.ts
```

Expected: all tests pass (sanity-check the persistence layer is still green).

- [ ] **Step 5: Commit**

```
git add frontend/task-tracker/src/pages/CalendarPage.tsx frontend/task-tracker/src/App.tsx
git commit -m "feat(calendar): wire subtasksOnly filter end-to-end"
```

---

## Task 6: Smoke test for the filter behavior

**Files:**
- Create: `frontend/task-tracker/src/__tests__/pages/calendarPage.subtasksOnly.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/task-tracker/src/__tests__/pages/calendarPage.subtasksOnly.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Profile, Task } from "@/types";
import type { ID } from "@/types/common";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    isAdminInAny: () => true,
    isManagerInAny: () => false,
  }),
}));

vi.mock("@/hooks/useWorkPlans", () => ({
  useWorkPlans: () => ({ plans: [] }),
}));

import CalendarPage from "@/pages/CalendarPage";

const profile: Profile = {
  id: "p1",
  username: "alice",
  full_name: "Alice",
  email: "a@x.com",
  manager_ids: null,
  avatar_color: null,
  orgs: [],
  highest_role: "admin",
};

// Today's date is whatever the test runner sees; build tasks for the current
// calendar month so the recurrence projection includes them without surprises.
const now = new Date();
const yyyy = now.getFullYear();
const mm = String(now.getMonth() + 1).padStart(2, "0");
const monthPrefix = `${yyyy}-${mm}`;

const parentGoal: Task = {
  id: "goal-1" as ID,
  serialNo: 1,
  client: "Acme",
  category: "Statutory",
  description: "Acme Engagement",
  status: "Pending",
  targetDate: `${monthPrefix}-05`,
  expectedDate: "",
  completedDate: "",
  responsible: "Alice",
  reportingManager: "",
  remarks: "",
  recurrence: "Onetime",
  organization: "",
  createdBy: null,
  createdAt: null,
  parentId: null,
};

const subA: Task = {
  ...parentGoal,
  id: "sub-a" as ID,
  serialNo: 2,
  description: "GSTR-1 filing",
  targetDate: `${monthPrefix}-10`,
  parentId: "goal-1" as ID,
  planUid: "plan-a",
};

const subB: Task = {
  ...parentGoal,
  id: "sub-b" as ID,
  serialNo: 3,
  description: "Bank reconciliation",
  targetDate: `${monthPrefix}-15`,
  parentId: "goal-1" as ID,
  planUid: "plan-b",
};

const tasks: Task[] = [parentGoal, subA, subB];

const mainsById = new Map<
  ID,
  { category: string; responsible: string; description: string }
>([
  [
    "goal-1" as ID,
    { category: "Statutory", responsible: "Alice", description: "Acme Engagement" },
  ],
]);

beforeEach(() => {
  cleanup();
  localStorage.clear();
});

describe("CalendarPage — Subtasks-only filter", () => {
  it("shows parent goal and subtasks by default; toggling the pill hides the parent and prefixes subtask pills", () => {
    render(
      <CalendarPage
        tasks={tasks}
        profile={profile}
        profiles={[]}
        mainsById={mainsById}
      />,
    );

    // Default state: all three rows visible somewhere in the grid.
    expect(screen.getAllByText(/Acme Engageme/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/GSTR-1 filing/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Bank reconcilia/).length).toBeGreaterThan(0);

    // Toggle the pill.
    const pill = screen.getByRole("button", { name: /show subtasks only/i });
    fireEvent.click(pill);

    // Parent goal pill is gone.
    expect(screen.queryByText(/Acme Engageme(?!nt)/)).toBeNull();

    // Subtask pills now carry the parent prefix "Acme Engag… › ".
    expect(screen.getAllByText(/Acme Engag.*›.*GSTR-1/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Acme Engag.*›.*Bank reconci/).length).toBeGreaterThan(0);
  });

  it("hydrates the pill from localStorage on mount", () => {
    localStorage.setItem("tasktracker.calendar.subtasksOnly", "1");
    render(
      <CalendarPage
        tasks={tasks}
        profile={profile}
        profiles={[]}
        mainsById={mainsById}
      />,
    );

    const pill = screen.getByRole("button", { name: /show subtasks only/i });
    expect(pill.getAttribute("aria-pressed")).toBe("true");
    // Parent goal pill is hidden because the filter starts ON.
    expect(screen.queryByText(/Acme Engageme(?!nt)/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and verify it passes**

```
cd frontend/task-tracker && npx vitest run src/__tests__/pages/calendarPage.subtasksOnly.test.tsx
```

Expected: both tests pass. If a test fails because the grid doesn't actually show the long label `Acme Engageme...` (because `UnifiedDayCell` already truncates at 16 chars to `Acme Engagement` — exactly 15 chars, no truncation), accept whatever the cell renders. The assertions match a regex prefix, not the full string. If a test still fails, prefer adjusting the regex over editing component code — the component behavior is correct by Task 3.

- [ ] **Step 3: Commit**

```
git add frontend/task-tracker/src/__tests__/pages/calendarPage.subtasksOnly.test.tsx
git commit -m "test(calendar): smoke test for Subtasks-only filter"
```

---

## Task 7: Final verification

- [ ] **Step 1: Run the full frontend test suite**

```
cd frontend/task-tracker && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 2: Run the type-checker**

```
cd frontend/task-tracker && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run pre-commit on the whole tree**

From the repo root:

```
uv run pre-commit run --all-files
```

Expected: all hooks pass (ruff, format, line-endings, mypy, pyright, eslint, tsc, build). If a hook fails, fix the underlying issue (do NOT pass `--no-verify`).

- [ ] **Step 4: Manual smoke test in the browser**

Start the frontend dev server and visit the Calendar page:

```
cd frontend/task-tracker && npm run dev
```

Verify:
1. The Calendar toolbar shows a new "Subtasks only" pill button immediately after the Both/Tasks/Plans toggle.
2. Toggling the pill hides parent goals; subtask pills gain a `<parent> › <sub>` prefix.
3. The Unscheduled Tasks panel disappears when the pill is ON and reappears when OFF.
4. Switching the layer toggle to "Plans" disables the pill (greyed, not clickable).
5. Refreshing the page preserves the pill state.
6. Clicking a day cell while the filter is ON opens the day modal with only subtasks, each card showing a `Part of: <parent goal>` line.

If anything looks wrong, fix the affected task and re-run from the relevant verification step.

- [ ] **Step 5: Push the branch**

```
git push
```

(Upstream is already set; no `--set-upstream` needed.)

---

## Self-review notes

**Spec coverage check:**

- Persistence helpers — Task 1.
- Toolbar pill button (with disabled state when `layers === "plans"`) — Task 2.
- Subtask pill prefix in `UnifiedDayCell` — Task 3.
- `Part of:` line in `UnifiedDayModal` — Task 4.
- `CalendarPage` filter state, upstream filtering, unscheduled panel guard, prop wiring — Task 5.
- `App.tsx` `mainsById` shape extension and `CalendarPage` mount — Task 5.
- Test extensions for `calendarLayers` helpers — Task 1.
- Smoke test for `CalendarPage` filter behavior — Task 6.
- Final verification (test suite + tsc + pre-commit + manual smoke) — Task 7.

All spec sections trace to at least one task. No placeholders. Type/prop names are consistent across tasks: `subtasksOnly`, `onSubtasksOnlyChange`, `mainsById` (full shape in `App` / `CalendarPage`), `mainsByIdSlim` (description-only shape in `UnifiedDayCell` / `UnifiedDayModal`), `SUBTASKS_ONLY_KEY`, `loadSubtasksOnly`, `saveSubtasksOnly`.
