# Calendar "Main Category" Filter

**Date:** 2026-05-16
**Branch:** Calendar_subtask
**Status:** Spec for implementation

## Problem

The Calendar toolbar currently filters tasks by Client and by Member, but there is no way to scope the grid to a specific *main category* (e.g. "DB Update", "Mizaj Invest", "Cash flow"). Users viewing a busy month with subtasks across many engagements need to see one engagement-family at a time.

The Dashboard already has a Main Category filter (commit `7aa5132`, `core/frontend/task-tracker/src/pages/DashboardPage.tsx`). We want the same control on the Calendar page so the two views are consistent and a user can drill from one to the other without learning a new mental model.

## Goals

- A new `All Main Categories` dropdown in the Calendar toolbar, between All Clients and All Members.
- Same definition as the Dashboard: a subtask's main category is its parent goal's `category`; a top-level task's main category is its own `category`.
- The Clear (✕) button resets the new dropdown alongside the existing filters.
- Filter is purely client-side; no backend changes.
- Options list narrows naturally with Subtasks-only ON (only subtask-derived categories appear).

## Non-goals

- Refactoring the Dashboard to share a `getMainCategory` utility. The two implementations stay duplicated for now; consolidation can come later.
- Filtering plans by main category. Plans don't have a category relationship in this codebase.
- Multi-select. Single-value matches the existing client/member filter pattern.
- Persisting the selected category across sessions. The existing client/member selects don't persist either; consistency matters more than convenience here.
- Renaming the existing toolbar selects or restyling the toolbar layout beyond inserting one new control.

## Architecture

A new `fMainCategory` state lives in `CalendarPage` alongside `fClient` and `fMember`. It is plumbed through the existing filter pipeline as one additional `.filter(...)` step in `filteredMonthTasks`. The dropdown options come from a new `mainCategoryOptions` memo built from `visibleTasks` (the role-scoped + Subtasks-only output) so the option list narrows naturally as the user changes those upstream filters.

### `getMainCategory(t)`

```ts
const getMainCategory = (t: Task): string => {
  if (!t.parentId) return t.category || "";
  return mainsById.get(t.parentId)?.category || "";
};
```

Identical semantics to Dashboard. A subtask inherits its main category from the parent goal; a top-level task uses its own.

The existing `mainsById: Map<ID, { category, responsible, description }>` already carries `category`, so no shape change is needed.

### Filter pipeline order

The filter pipeline already runs in this order in `CalendarPage`:

1. **Role-scope** (`roleScopedTasks`): admin / manager / employee visibility.
2. **Subtasks-only** (`visibleTasks`): drops parents when the toggle is on.
3. **Recurrence projection** (`monthTasks`): expand recurring tasks into the current calendar month.
4. **Client / Member / *new* Main Category** (`filteredMonthTasks`): the toolbar filters.

The new clause lives in step 4. Order is important: applying it after the recurrence projection means projected occurrences are filtered consistently with their parent task's category.

```ts
filteredMonthTasks: monthTasks.filter(
  (t) =>
    (!fClient || t.client === fClient) &&
    (!fMember || t.responsible === fMember) &&
    (!fMainCategory || getMainCategory(t) === fMainCategory),
)
```

### Options list

```ts
const mainCategoryOptions = useMemo(
  () => [...new Set(visibleTasks.map(getMainCategory).filter(Boolean))].sort(),
  [visibleTasks, mainsById],
);
```

Built from `visibleTasks` (post role-scope, post-Subtasks-only) — so:

- With Subtasks-only OFF: the list is the union of every top-level task's category and every subtask's parent category visible to the current user.
- With Subtasks-only ON: parents are filtered out upstream, so the list reflects only categories derivable from subtasks via `mainsById`.

The empty string is filtered out so a legacy uncategorised row doesn't surface an empty option.

## Components

### `src/components/calendar/CalendarToolbar.tsx`

Three new props:

```ts
mainCategoryOptions: string[];
fMainCategory: string;
onMainCategoryChange: (v: string) => void;
```

A new `<select>` is inserted between the existing Client and Member selects. Same styling (`selectStyle`) as the two existing selects. Default option label: `All Main Categories`.

The existing Clear (✕) button gets two adjustments:

- `filterActive` becomes `!!(fClient || fMember || fMainCategory)`.
- `onClear` now also clears `fMainCategory` via the existing wiring (handled in `CalendarPage`).

### `src/pages/CalendarPage.tsx`

- New state `const [fMainCategory, setFMainCategory] = useState("");`.
- New `getMainCategory(t)` helper inside the component (`mainsById` is captured from props).
- New `mainCategoryOptions` memo as described above.
- `filteredMonthTasks` gets the new clause.
- `<CalendarToolbar>` mount gets the three new props wired:
  - `mainCategoryOptions={mainCategoryOptions}`
  - `fMainCategory={fMainCategory}`
  - `onMainCategoryChange={(v) => { setFMainCategory(v); setExpandDay(null); }}`
- `onClear` callback also resets `setFMainCategory("")`.

## Edge cases

- **Subtask whose parent is missing from `mainsById`** (deleted goal): `getMainCategory` returns `""`, the row is hidden from the options list and is only included when the filter is empty. Matches Dashboard behavior.
- **Renamed main category between page load and filter use**: filter is name-based, so a rename in another tab would not match. Same limitation as the existing All Clients / All Members selects.
- **No tasks with a non-empty category**: dropdown shows only `All Main Categories` and is effectively a no-op. We do not hide it — consistency with Clients / Members, which always render.
- **Subtasks-only ON + Main Category filter set**: both apply; the user sees only subtasks whose parent's category matches.
- **Filter set + user changes month**: filter persists across month navigation (same as Clients / Members today).
- **Recurring task projection**: a recurring task projected into the visible month inherits its `category` from the source task, so the filter works on projections without special handling.

## Testing

Add `src/__tests__/pages/calendarPage.mainCategoryFilter.test.tsx` covering:

1. Toolbar renders an `All Main Categories` select.
2. With three tasks across two main categories ("DB Update" parent → 2 subs, plus one top-level "Cash flow" task), the select lists exactly those two distinct values.
3. Selecting "DB Update" hides the "Cash flow" pill from the grid.
4. Selecting "Cash flow" hides both subtasks.
5. Clicking the Clear (✕) button resets the dropdown and restores all rows.
6. The select is built from `visibleTasks`, so toggling Subtasks-only ON removes a category that was only contributed by a top-level task with no subtasks.

The existing `calendarPage.subtasksOnly.test.tsx` is untouched.

## Files touched

- `src/pages/CalendarPage.tsx` — state, helper, options memo, filter clause, prop wiring, Clear reset.
- `src/components/calendar/CalendarToolbar.tsx` — new props, new `<select>`, `filterActive` widening.
- `src/__tests__/pages/calendarPage.mainCategoryFilter.test.tsx` — new smoke test.

## Trade-offs and risks

- **Name-based filter, not uid-based.** Master rename in another session breaks the match. The Dashboard has the same limitation; consistent UX. Future improvement: filter by parent master uid.
- **Duplication with Dashboard.** Two implementations of `getMainCategory` now exist. Acceptable for this scope; flagged for a follow-up consolidation.
- **Options list reactivity.** The dropdown options are derived from `visibleTasks`. If a user selects a category, then toggles Subtasks-only ON and that category vanishes from the options, the selected value stays set and the grid goes empty. Acceptable — the same is true today if a user picks a client then a member that has no tasks for that client. The Clear (✕) button resolves it.

## Out of scope (deferred)

- Sharing `getMainCategory` via `src/utils/task.ts` and migrating Dashboard.
- Filtering by main category UID (parent master uid) rather than name.
- Filtering plans by main category.
- Persisting `fMainCategory` across sessions.
- A multi-select variant.
