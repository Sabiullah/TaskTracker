# MOM Overdue-Only checkbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dedicated "Overdue" sub-tab on the Clients page with an "Overdue only" checkbox inside the MOM & Action Points tab, mirroring the Road Map tab's pattern.

**Architecture:** Extend the shared `actionPointFilter` module with an optional `overdueUids` set (driven by the existing `/client-action-points/overdue/` endpoint). Each MOM view (single + all) keeps its own `overdueOnly` boolean state, builds the set via `useOverdueActionPoints`, and feeds it through the existing filter pipeline. The Clients page drops the third sub-tab and the panel render — header overdue pill becomes a plain shortcut to the MOM tab.

**Tech Stack:** React 18 + TypeScript, Vitest + @testing-library/react, Vite. Existing hooks: `useOverdueActionPoints`, `useClientMeetings`, `useClientRoadmap`.

---

## File Structure

- **Modify:** `frontend/task-tracker/src/components/clients/actionPointFilter.ts` — add optional `overdueUids: Set<string>` to filter shape; update `isFilterActive` and `actionPointMatches`.
- **Create:** `frontend/task-tracker/src/__tests__/components/clients/actionPointFilter.test.ts` — unit tests for the new field and existing semantics.
- **Modify:** `frontend/task-tracker/src/components/clients/ClientMOMSingleView.tsx` — add `overdueOnly` state, hook in `useOverdueActionPoints`, render checkbox, plumb into filters.
- **Modify:** `frontend/task-tracker/src/components/clients/ClientMOMAllView.tsx` — same as single view (separate component, never coexists).
- **Modify:** `frontend/task-tracker/src/pages/ClientsPage.tsx` — drop `overdue` sub-tab entry, drop `OverdueActionPointsPanel` import + render block, repoint header pill onClick to `setSubTab("mom")`.

`OverdueActionPointsPanel.tsx` and `overdueFilters.ts` stay on disk — page-header counter still uses `filterOverdue`. Panel becomes unrendered (cleanup deferred).

---

## Task 1: Extend `actionPointFilter` with overdue-set support

**Files:**
- Modify: `frontend/task-tracker/src/components/clients/actionPointFilter.ts`
- Create: `frontend/task-tracker/src/__tests__/components/clients/actionPointFilter.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/task-tracker/src/__tests__/components/clients/actionPointFilter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { actionPointMatches, isFilterActive } from "@/components/clients/actionPointFilter";
import type { ClientActionPointDto } from "@/types/api/clients";

function ap(overrides: Partial<ClientActionPointDto> = {}): ClientActionPointDto {
  return {
    id: 1,
    uid: "ap-1",
    meeting: 10,
    description: "do thing",
    responsibility: "user-1",
    responsibility_detail: null,
    target_date: "2026-04-15",
    completion_date: null,
    status: "Open",
    priority: "Medium",
    remarks: "",
    roadmap_link: null,
    attachments: [],
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

const baseFilters = {
  status: [] as string[],
  priority: [] as string[],
  owner: [] as string[],
  targetMonth: "",
};

describe("actionPointFilter", () => {
  describe("isFilterActive", () => {
    it("returns false when all fields empty and no overdue set", () => {
      expect(isFilterActive(baseFilters)).toBe(false);
    });

    it("returns true when status filter is non-empty", () => {
      expect(isFilterActive({ ...baseFilters, status: ["Open"] })).toBe(true);
    });

    it("returns true when overdueUids is provided (even if empty set)", () => {
      expect(isFilterActive({ ...baseFilters, overdueUids: new Set() })).toBe(true);
    });
  });

  describe("actionPointMatches", () => {
    it("matches when overdueUids contains the AP uid", () => {
      const filters = { ...baseFilters, overdueUids: new Set(["ap-1"]) };
      expect(actionPointMatches(ap({ uid: "ap-1" }), filters)).toBe(true);
    });

    it("rejects when overdueUids is set and does NOT contain the AP uid", () => {
      const filters = { ...baseFilters, overdueUids: new Set(["ap-other"]) };
      expect(actionPointMatches(ap({ uid: "ap-1" }), filters)).toBe(false);
    });

    it("rejects every AP when overdueUids is an empty set", () => {
      const filters = { ...baseFilters, overdueUids: new Set<string>() };
      expect(actionPointMatches(ap({ uid: "ap-1" }), filters)).toBe(false);
    });

    it("composes with other filters (AND semantics)", () => {
      const filters = {
        ...baseFilters,
        status: ["Open"],
        overdueUids: new Set(["ap-1"]),
      };
      expect(actionPointMatches(ap({ uid: "ap-1", status: "Open" }), filters)).toBe(true);
      expect(actionPointMatches(ap({ uid: "ap-1", status: "Completed" }), filters)).toBe(false);
      expect(actionPointMatches(ap({ uid: "ap-2", status: "Open" }), filters)).toBe(false);
    });

    it("ignores overdueUids when undefined (existing behavior preserved)", () => {
      expect(actionPointMatches(ap({ uid: "ap-1" }), baseFilters)).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/components/clients/actionPointFilter.test.ts`

Expected: FAIL — `overdueUids` field doesn't exist on `ActionPointFilters`, tests asserting overdue behavior fail.

- [ ] **Step 3: Update `actionPointFilter.ts`**

Replace `frontend/task-tracker/src/components/clients/actionPointFilter.ts` with:

```ts
import type { ClientActionPointDto } from "@/types/api/clients";
import { matchesMonth } from "./monthFilter";

export interface ActionPointFilters {
  status: string[];
  priority: string[];
  owner: string[];
  targetMonth: string;
  // When provided, only APs whose uid is in this set match. Driven by the
  // canonical `/client-action-points/overdue/` endpoint so the checkbox
  // stays aligned with the page-header overdue counter.
  overdueUids?: Set<string>;
}

export function isFilterActive(f: ActionPointFilters): boolean {
  return (
    f.status.length > 0 ||
    f.priority.length > 0 ||
    f.owner.length > 0 ||
    f.targetMonth !== "" ||
    f.overdueUids !== undefined
  );
}

export function actionPointMatches(
  ap: ClientActionPointDto,
  f: ActionPointFilters,
): boolean {
  if (f.status.length > 0 && !f.status.includes(ap.status)) return false;
  if (f.priority.length > 0 && !f.priority.includes(ap.priority)) return false;
  if (
    f.owner.length > 0 &&
    !(ap.responsibility && f.owner.includes(ap.responsibility))
  )
    return false;
  if (!matchesMonth(ap.target_date, f.targetMonth)) return false;
  if (f.overdueUids !== undefined && !f.overdueUids.has(ap.uid)) return false;
  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/components/clients/actionPointFilter.test.ts`

Expected: PASS — all 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/components/clients/actionPointFilter.ts frontend/task-tracker/src/__tests__/components/clients/actionPointFilter.test.ts
git commit -m "feat(clients): add overdueUids field to action point filter"
```

---

## Task 2: Wire "Overdue only" checkbox into `ClientMOMSingleView`

**Files:**
- Modify: `frontend/task-tracker/src/components/clients/ClientMOMSingleView.tsx`

- [ ] **Step 1: Add hook + state + memoized overdue set**

In `ClientMOMSingleView.tsx`, add the import near the existing hook imports (line 1-9):

```tsx
import { useOverdueActionPoints } from "@/hooks/useOverdueActionPoints";
```

Inside the component, after the existing `useState` calls for `statusFilter`/`priorityFilter`/`ownerFilter`/`targetMonth` (around line 49-52), add:

```tsx
const [overdueOnly, setOverdueOnly] = useState(false);
const { overdue } = useOverdueActionPoints();
const overdueUids = useMemo(
  () => new Set(overdue.map((ap) => ap.uid)),
  [overdue],
);
```

- [ ] **Step 2: Plumb `overdueUids` into the `filters` memo**

Replace the existing `filters` memo (around line 56-64) with:

```tsx
const filters = useMemo(
  () => ({
    status: statusFilter,
    priority: priorityFilter,
    owner: ownerFilter,
    targetMonth,
    overdueUids: overdueOnly ? overdueUids : undefined,
  }),
  [statusFilter, priorityFilter, ownerFilter, targetMonth, overdueOnly, overdueUids],
);
```

- [ ] **Step 3: Add the checkbox to the filter bar**

In the filter-bar `<div>` (around line 148-180), append after the `AP TARGET MONTH` label block:

```tsx
<label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, paddingBottom: 6 }}>
  <input
    type="checkbox"
    checked={overdueOnly}
    onChange={(e) => setOverdueOnly(e.target.checked)}
  />
  Overdue only
</label>
```

- [ ] **Step 4: Verify no other call sites break**

Run: `cd frontend/task-tracker && npx tsc --noEmit`

Expected: PASS — no type errors. The `filters` shape now matches the updated `ActionPointFilters` interface (with optional `overdueUids`).

- [ ] **Step 5: Run existing tests**

Run: `cd frontend/task-tracker && npx vitest run`

Expected: PASS — no regressions.

- [ ] **Step 6: Commit**

```bash
git add frontend/task-tracker/src/components/clients/ClientMOMSingleView.tsx
git commit -m "feat(clients): add Overdue only checkbox to MOM single view"
```

---

## Task 3: Wire "Overdue only" checkbox into `ClientMOMAllView`

**Files:**
- Modify: `frontend/task-tracker/src/components/clients/ClientMOMAllView.tsx`

- [ ] **Step 1: Add hook + state + memoized overdue set**

In `ClientMOMAllView.tsx`, add the import:

```tsx
import { useOverdueActionPoints } from "@/hooks/useOverdueActionPoints";
```

Inside the component, after the existing filter `useState` calls (around line 54-57), add:

```tsx
const [overdueOnly, setOverdueOnly] = useState(false);
const { overdue } = useOverdueActionPoints();
const overdueUids = useMemo(
  () => new Set(overdue.map((ap) => ap.uid)),
  [overdue],
);
```

- [ ] **Step 2: Plumb `overdueUids` into the `filters` memo**

Replace the existing `filters` memo (around line 59-67) with:

```tsx
const filters = useMemo(
  () => ({
    status: statusFilter,
    priority: priorityFilter,
    owner: ownerFilter,
    targetMonth,
    overdueUids: overdueOnly ? overdueUids : undefined,
  }),
  [statusFilter, priorityFilter, ownerFilter, targetMonth, overdueOnly, overdueUids],
);
```

- [ ] **Step 3: Add the checkbox to the filter bar**

In the filter-bar `<div>` (around line 129-161), append after the `AP TARGET MONTH` label block:

```tsx
<label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, paddingBottom: 6 }}>
  <input
    type="checkbox"
    checked={overdueOnly}
    onChange={(e) => setOverdueOnly(e.target.checked)}
  />
  Overdue only
</label>
```

- [ ] **Step 4: Type-check + tests**

Run: `cd frontend/task-tracker && npx tsc --noEmit && npx vitest run`

Expected: PASS — no type errors, no regressions.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/components/clients/ClientMOMAllView.tsx
git commit -m "feat(clients): add Overdue only checkbox to MOM all-clients view"
```

---

## Task 4: Drop the Overdue sub-tab from `ClientsPage`

**Files:**
- Modify: `frontend/task-tracker/src/pages/ClientsPage.tsx`

- [ ] **Step 1: Narrow the SubTab type and drop the panel import**

Remove the import (line 8):

```tsx
import OverdueActionPointsPanel from "@/components/clients/OverdueActionPointsPanel";
```

Change the `SubTab` type (line 18) from:

```tsx
type SubTab = "roadmap" | "mom" | "overdue";
```

to:

```tsx
type SubTab = "roadmap" | "mom";
```

- [ ] **Step 2: Repoint the header pill**

In the "⚠ N overdue action points" button's `onClick` (around line 73), change:

```tsx
onClick={() => setSubTab("overdue")}
```

to:

```tsx
onClick={() => setSubTab("mom")}
```

- [ ] **Step 3: Drop the third tab entry**

In the tab-bar config array (around line 102-107), remove the `overdue` entry:

```tsx
{(
  [
    { id: "roadmap", label: "🗺️ Road Map" },
    { id: "mom", label: "📋 MOM & Action Points" },
  ] as const
).map((t) => (
```

- [ ] **Step 4: Drop the panel render block**

Remove the entire `{subTab === "overdue" && (...)}` block (around line 147-158).

- [ ] **Step 5: Type-check + tests**

Run: `cd frontend/task-tracker && npx tsc --noEmit && npx vitest run`

Expected: PASS. `OverdueActionPointsPanel` is now unreferenced from the page; it remains on disk (deferred cleanup).

- [ ] **Step 6: Manual verification**

Start the frontend dev server:

Run: `cd frontend/task-tracker && npm run dev`

Open the Clients page in a browser. Verify:
- Tab bar shows exactly two entries: "🗺️ Road Map" and "📋 MOM & Action Points".
- Clicking the header "⚠ N overdue action points" pill switches to the MOM tab.
- In the MOM tab filter bar, the "Overdue only" checkbox appears after AP TARGET MONTH.
- Toggling "Overdue only" hides meetings whose APs are not in the overdue set; toggling off restores them.
- The behavior works in both single-client view (after picking a client) and all-clients view (with "All clients" selected).

If any step fails, fix the underlying issue before committing.

- [ ] **Step 7: Commit + push**

```bash
git add frontend/task-tracker/src/pages/ClientsPage.tsx
git commit -m "feat(clients): remove dedicated Overdue sub-tab in favor of checkbox"
git push
```

---

## Self-Review Notes

- **Spec coverage:** Tab removal (Task 4), checkbox in single view (Task 2), checkbox in all view (Task 3), filter shape extension (Task 1), header-pill behavior change (Task 4 step 2). All spec sections covered.
- **Type consistency:** `overdueUids?: Set<string>` is the same name and type across `ActionPointFilters`, all three callers, and the test fixtures.
- **No placeholders:** every step shows the exact code or command needed.
- **Auto-push at end** matches the user's stored preference for committing+pushing feature-branch work without asking.
