# Dashboard: Expected-Date Overdue Filter

**Date:** 2026-05-17
**Status:** Revised after user testing (see Revision History)
**Branch:** `Expect_Date_filter`

## Problem

The dashboard's red **Overdue** stat card today shows a single count derived from `targetDate < today AND !completedDate` (the `Overdue` value returned by `computeStatus` in `frontend/task-tracker/src/utils/task.ts:64`). Many overdue rows also carry an `expectedDate` — a revised ETA set by the responsible team member after the original target slipped.

Admins/managers cannot tell from the dashboard:

1. Which overdue rows have *also* missed their revised expected date (team committed to a new date and missed it again — needs a follow-up conversation and a fresh revision).
2. Which overdue rows have *no* expected date set at all (team hasn't committed to a revised ETA yet — needs them to set one and give a reason for the delay).

Both buckets are actionable, but they're invisible in the current UI.

## Goal

Give admins and managers a way to slice the dashboard by overdue bucket so the per-employee and per-client summary tables reflect that bucket — letting them see at a glance "who has past-expected tasks" and "which clients have no-expected-set rows" without first drilling into a task list.

## Non-Goals

- No new backend fields, migrations, or API endpoints. `expectedDate` is already on the `Task` type, populated by users via the task form, and shipped to the frontend.
- No change to `computeStatus`. The "Overdue" status itself stays defined by `targetDate < today AND !completedDate`.
- No change to `TaskDetailTable`, `TeamTable`, `ClientTable`, or other dashboard widgets — they all consume the already-filtered `filteredTasks` so the new filter applies transparently.

## Design

### Filter placement

The bucket filter is a new dropdown in the **dashboard's existing filter bar** — same row as Month / Client / Reporting Manager / Main Category / Main Responsibility / Member. Picking a value narrows `filteredTasks`, which the entire page (stat cards, Team Performance table, By Client table, Status Distribution, the Overdue card's drill-down) already consumes — so all summaries and counts reflect the chosen bucket without any per-widget plumbing.

### Buckets

| Option key | Dropdown label | Predicate (applied as a filter on `filteredTasks`) |
|---|---|---|
| `""` (default) | "All Overdue Views" | no filter applied |
| `"expected"` | "Overdue: Past Expected Date" | `t.expectedDate` is non-empty AND `new Date(t.expectedDate) < today` AND `!t.completedDate` |
| `"no-expected"` | "Overdue: No Expected Set" | `t.status === "Overdue"` AND `!t.expectedDate` |

`today` is `new Date()` with `setHours(0,0,0,0)`.

Note: a "Per Target only" option is intentionally omitted from the dropdown — picking the Overdue stat card already gives that view (it's the current behavior).

### UI changes to existing layout

#### 1. Add a new dropdown to the filter bar

Place between **Member** and the **Clear** button in `DashboardPage.tsx`. Same style as the other dropdowns. Icon: `🚨`. Only render when there is at least one task with non-empty `expectedDate` *or* at least one status="Overdue" row — i.e., the filter is useful for the current task set.

```tsx
<select value={fOverdueView} onChange={(e) => { setFOverdueView(e.target.value); setDrillDown(null); }}>
  <option value="">All Overdue Views</option>
  <option value="expected">Overdue: Past Expected Date</option>
  <option value="no-expected">Overdue: No Expected Set</option>
</select>
```

#### 2. Apply the filter in `filteredTasks`

In the existing `useMemo` for `filteredTasks` in `DashboardPage.tsx`, after all current filters are applied:

```ts
if (fOverdueView === "expected") {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  src = src.filter((t) => isOverduePerExpected(t, today));
} else if (fOverdueView === "no-expected") {
  src = src.filter(isOverdueNoExpectedSet);
}
```

#### 3. Include `fOverdueView` in the Clear button's condition and reset

The existing "✕ Clear" button at the end of the filter bar clears all filters. Add `fOverdueView` to its condition list and `setFOverdueView("")` to its onClick handler.

#### 4. Keep the Overdue card clickable, drop the tab strip

The clickable red Overdue card (added in earlier commits on this branch) stays — it's a useful "show me the current overdue list" shortcut, consistent with the Active and Today cards.

Inside the drill-down, **remove** the three-tab pill strip. The drill-down now simply renders all `filteredTasks` rows where `status === "Overdue"`. Because the bar filter has already narrowed `filteredTasks`, the rows naturally reflect the chosen bucket (e.g., "Overdue: Past Expected Date" → filteredTasks is past-expected rows → drill-down shows past-expected ∩ status=Overdue, i.e., past-expected rows that are also overdue per target).

`drillDown.value` is no longer used for `overdue`; set `setDrillDown({ type: "overdue" })` on click.

### Implementation outline

All changes are frontend-only and target one file:

1. `frontend/task-tracker/src/pages/DashboardPage.tsx`:
   - Add `fOverdueView` state.
   - Add the dropdown to the filter bar (between Member and Clear).
   - Apply the bucket filter in the `filteredTasks` `useMemo`.
   - Include `fOverdueView` in the Clear button's reset and condition.
   - Remove the tab strip from the `drillDown.type === "overdue"` branch; simplify its `title` and `filename`; the slice becomes `filteredTasks.filter(isOverduePerTarget)`.

`utils/overdueBuckets.ts` and `types/ui.ts` from the earlier commits stay as-is. The predicates are still imported and used.

### Testing

Existing tests in `__tests__/utils/overdueBuckets.test.ts` (10 predicate tests) stay.

`__tests__/pages/dashboardPage.expectedDateOverdue.test.tsx` is updated to cover:

1. **Bar filter applies on the dashboard root** (mocked summary components are passed `filteredTasks`; assertions verify the bar filter narrows the count):
   - Default "All": all 3 fixture rows appear in `TaskDetailTable` upon Overdue-card click.
   - Filter = "expected": Team and Client tables receive only the past-expected row.
   - Filter = "no-expected": Team and Client tables receive only the no-expected row.
2. **Clear button** resets `fOverdueView` along with the other filters.
3. **Drill-down**: clicking the Overdue card with the bar filter active shows the intersection (Per Target ∩ bar filter).

The tab-strip tests (3 of them) are removed.

### Risks

- **"Overdue" stat card count varies with bar filter.** When the user picks "Overdue: Past Expected Date", the Overdue stat card displays the count of past-expected rows that are *also* status=Overdue. In practice this matches the bar filter's chosen population since the buckets overlap heavily; in the rare future-target + lapsed-expected case it will be slightly smaller. The bar filter dropdown label and the per-row drill-down counts will help the user reconcile.
- **No bucket-specific count surfaced at top level.** The user has to pick the bar filter to see the count of past-expected rows. Adding a dedicated stat card was considered and rejected as visual clutter; the bar filter + summary tables surface the same information one click away.

---

## Revision History

### v2 (2026-05-17)

Original design put the bucket filter inside the Overdue card's drill-down as a three-tab pill strip. User feedback after seeing the implementation: "filter option should be shown this page itself, based on the filter I need to see the employee wise client wise count … you have given inbuilt with Overdue tab and also I can see task wise details only, not like summary."

The drill-down-only filter forced users into a task-list view to access the buckets, which defeated the use case of "spot at a glance who/which client has past-expected tasks." Revised to put the filter in the dashboard's filter bar so the Team Performance and By Client summary tables reflect the bucket.

Key changes:
- Filter moves from drill-down tabs to a dashboard filter-bar dropdown.
- Drill-down tab strip removed (redundant with the bar filter).
- Drill-down stays as a task-list view (click Overdue card → see rows).
- "Per Target" option dropped from the dropdown (the Overdue card click already provides that view).

### v1 (2026-05-17)

Initial design: clickable Overdue card opens a drill-down with three tab pills (`Per Target`, `Past Expected Date`, `No Expected Set`). Approved by user, implemented in commits `3a95266…d13aea0`.
