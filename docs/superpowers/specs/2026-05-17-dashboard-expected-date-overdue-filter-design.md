# Dashboard: Expected-Date Overdue Filter

**Date:** 2026-05-17
**Status:** Approved (pending user review of spec)
**Branch:** `Expect_Date_filter`

## Problem

The dashboard's red **Overdue** stat card today shows a single count derived from `targetDate < today AND !completedDate` (the `Overdue` value returned by `computeStatus` in `frontend/task-tracker/src/utils/task.ts:64`). Many overdue rows also carry an `expectedDate` — a revised ETA set by the responsible team member after the original target slipped.

Admins/managers cannot tell from the dashboard:

1. Which overdue rows have *also* missed their revised expected date (team committed to a new date and missed it again — needs a follow-up conversation and a fresh revision).
2. Which overdue rows have *no* expected date set at all (team hasn't committed to a revised ETA yet — needs them to set one and give a reason for the delay).

Both buckets are actionable, but they're invisible in the current UI.

## Goal

Give admins and managers a way to slice the existing Overdue list into three buckets, accessible from the Team Dashboard, with one click.

## Non-Goals

- No new backend fields, migrations, or API endpoints. `expectedDate` is already on the `Task` type, populated by users via the task form, and shipped to the frontend.
- No change to `computeStatus`. The "Overdue" status itself stays defined by `targetDate < today AND !completedDate`.
- No change to other dashboard widgets (Team Performance table, By Client table, Status Distribution). Those continue to use the existing `Overdue` status.
- No bucket filter in the global filter bar. The filter lives only in the drill-down view.

## Design

### Buckets

Computed from `filteredTasks` (so the existing Month / Client / Reporting Manager / Main Category / Main Responsibility / Member filters still apply on top). All three predicates operate against `today` with `setHours(0,0,0,0)`.

| Bucket key | Label | Predicate |
|---|---|---|
| `target` | **Per Target** | `t.status === "Overdue"` (i.e. `targetDate < today AND !completedDate`) |
| `expected` | **Past Expected Date** | `t.expectedDate` is non-empty AND `new Date(t.expectedDate) < today` AND `!t.completedDate` |
| `no-expected` | **No Expected Set** | `t.status === "Overdue"` AND `!t.expectedDate` |

Buckets intentionally overlap:

- `target` is the superset (current behavior, unchanged count).
- `expected` is a subset of `target` in practice (revised dates are normally set later than the original target), but it does not *require* `targetDate < today` — if a row has a future targetDate and an already-lapsed expectedDate, it still appears in this bucket.
- `no-expected` is the strict subset of `target` where `expectedDate` is empty.

This overlap is fine because the buckets are views the user switches between, not a partition the user navigates.

### UI

#### 1. Make the Overdue stat card clickable

[`DashboardPage.tsx:863–873`](frontend/task-tracker/src/pages/DashboardPage.tsx:863) — add `cursor: pointer`, `title="Click to view overdue tasks"`, and `onClick={() => setDrillDown({ type: "overdue", value: "target" })}`. Visual treatment matches the Active and Today cards.

#### 2. Extend `DashboardDrillDown`

[`frontend/task-tracker/src/types/ui.ts:20`](frontend/task-tracker/src/types/ui.ts:20):

```ts
export interface DashboardDrillDown {
  type: "report" | "status" | "client" | "member" | "today" | "active" | "overdue";
  value?: string;  // for "overdue": "target" | "expected" | "no-expected"
}
```

#### 3. New drill-down view

When `drillDown?.type === "overdue"`, render a view with:

- **Tab strip** above the table — three pill buttons:
  - `Per Target (N)` — count of `target` bucket
  - `Past Expected Date (M)` — count of `expected` bucket
  - `No Expected Set (K)` — count of `no-expected` bucket
  - Active tab visually highlighted (filled red `#dc2626` background, white text); inactive tabs use the existing pill style from `Active`/`Today` drill-downs.
  - Clicking a tab updates `drillDown.value`; no navigation, no state lost.
- **`TaskDetailTable`** rendered with the slice for the active bucket, using the existing component (no changes to `TaskDetailTable` itself).
  - `title` reflects the active tab, e.g. `"🚨 Overdue Tasks — Past Expected Date"`.
  - `filename` reflects the active tab: `overdue-per-target.csv`, `overdue-past-expected.csv`, `overdue-no-expected.csv`.
  - `editable={true}`, `profile`, `onAddTask`, `onPatchTask` plumbed through identically to other drill-downs.
- **Back button** in the same row as the tab strip, matching the existing back-button style used by the `member` drill-down at [`DashboardPage.tsx:391`](frontend/task-tracker/src/pages/DashboardPage.tsx:391).

#### 4. Default tab

When the user clicks the Overdue card, default to `value: "target"` (current behavior — they see the same set of rows they see today, plus tabs to slice further).

### Implementation outline

All changes are frontend-only:

1. `frontend/task-tracker/src/types/ui.ts` — add `"overdue"` to the `type` union.
2. `frontend/task-tracker/src/pages/DashboardPage.tsx`:
   - Compute the three buckets from `filteredTasks` (memoized).
   - Make the Overdue stat card clickable.
   - Add a new `if (drillDown?.type === "overdue")` branch above the main return, rendering tab strip + `TaskDetailTable`.

No changes to `TaskDetailTable`, `computeStatus`, `useTasks`, types, or backend.

### Testing

A new test file `frontend/task-tracker/src/__tests__/pages/dashboardPage.expectedDateOverdue.test.tsx` covering:

1. **Bucket predicates** (unit-style — three small fixture lists):
   - A row with `targetDate < today`, `!expectedDate`, `!completedDate` appears in `target` and `no-expected`, not in `expected`.
   - A row with `targetDate < today`, `expectedDate < today`, `!completedDate` appears in `target` and `expected`, not in `no-expected`.
   - A row with `targetDate < today`, `expectedDate > today`, `!completedDate` appears only in `target`.
   - A row with `targetDate < today`, `expectedDate` set, `completedDate` set is in none.
   - A row with `targetDate > today`, `expectedDate < today`, `!completedDate` appears only in `expected` (edge case — future target, lapsed revision).
2. **Render** (smoke):
   - Click the Overdue stat card → tab strip renders with three tabs and correct counts.
   - Click each tab → table shows the expected slice.
   - Counts in tab labels match the rows in the table.

### Risks

- **Bucket overlap is non-obvious.** Users may be surprised that the three tab counts don't sum to the Overdue card count. Mitigation: tab labels are descriptive ("Per Target", "Past Expected Date", "No Expected Set") rather than mutually-exclusive-sounding ("Target only" / "Expected only").
- **Future targetDate with lapsed expectedDate.** Rare but legal. Showing those in the `expected` bucket is intentional — the team committed to an ETA and missed it. Documented in the bucket table above.
- **No change to global `Overdue` count.** The card itself continues to show the same number as today. Users may want a separate count for "past expected" surfaced at the top level — out of scope; revisit if requested.
