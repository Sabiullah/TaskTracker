# Calendar "Subtasks Only" Filter

**Date:** 2026-05-16
**Branch:** Calendar_subtask
**Status:** Spec for implementation

## Problem

The Calendar page renders every `Task` row that has a `target_date`, which means parent goals, standalone tasks, and materialized child subtasks all sit in the same visual pool. When a user wants to focus on the *recurring sub-category work* for a month — the materialized child rows produced by `TaskSubcategoryPlan` — there is no way to hide parent goals and standalone tasks. Sub-cat names (e.g. "GSTR-1", "BRS") also repeat across goals, so a pill on the calendar doesn't tell the viewer which engagement it belongs to.

We want a calendar-level filter that:

1. Hides parent goals and standalone tasks, leaving only `parentId !== null` rows.
2. Adds a short parent-goal prefix to each subtask pill so the engagement context is obvious at a glance.
3. Hides the "Unscheduled Tasks" panel while the filter is on (subtasks always get a `target_date` via materialization, so the panel is essentially empty in that mode).

## Goals

- New boolean toolbar toggle "Subtasks only" persisted in localStorage.
- When ON, the calendar grid and day modal show only child subtask rows.
- Each subtask pill in the day cell shows `<parent-goal> › <subtask-label>` (truncated).
- The day modal subtask cards gain a `Part of: <parent goal>` line.
- The "Unscheduled Tasks" panel is hidden when the filter is ON.
- The filter is orthogonal to the existing `Both / Tasks / Plans` layer toggle; it does not affect plans.

## Non-goals

- Grouping subtasks under their parent goal as a collapsible header in the day modal.
- A symmetric "Goals only" filter. The boolean stays a boolean; widening to an enum is deferred.
- Server-side filtering. The existing task list endpoint is unchanged; all filtering is client-side.
- Restyling parent-goal pills (they simply disappear when the filter is ON).
- Filtering work plans by anything subtask-related.

## Architecture

### Filter state

A new boolean `subtasksOnly` is introduced alongside the existing `CalendarLayers` (`"both" | "tasks" | "plans"`). The two axes are independent:

- `CalendarLayers` controls *which row family* renders (tasks, plans, or both).
- `subtasksOnly` narrows the *tasks family* to rows with `parentId !== null`.

Both are persisted in localStorage under separate keys so toggling one does not reset the other.

When `CalendarLayers === "plans"` no tasks are shown anyway. In that mode the "Subtasks only" pill is rendered `disabled` and visually muted so the user understands the toggle is currently a no-op.

### Data flow

The filter is applied in `CalendarPage` immediately after the existing role-based visibility step and before the recurrence projection. Applying it upstream keeps `tasksByDay`, `clientOptions`, `memberOptions`, and `unscheduledTasks` in sync without separate guards.

The parent-goal label needed for the pill prefix comes from a `mainsById` map built from the *unfiltered* task list (the same pattern `Board` already uses via `App.tsx`). Building it from the unfiltered list means the parent label is always resolvable, even when client/member filters would otherwise hide the parent row.

## Components

### `src/utils/calendarLayers.ts`

Add:

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

Default value is `false`. Invalid stored values fall back to `false`.

### `src/components/calendar/CalendarToolbar.tsx`

Add two props:

```ts
subtasksOnly: boolean;
onSubtasksOnlyChange: (v: boolean) => void;
```

Render a pill button immediately after the existing layer toggle group. The pill uses the amber palette (`#f59e0b` active background, `#fff` text; inactive `#fff` background with `#94a3b8` border) so it is visually distinct from the blue layer toggle — communicating that it is a different axis, not another layer state.

The button is `disabled` and dimmed when `layers === "plans"`. Clicking it flips the boolean.

`aria-pressed` reflects the on/off state. The button label reads `Subtasks only`.

### `src/pages/CalendarPage.tsx`

- New state `const [subtasksOnly, setSubtasksOnly] = useState<boolean>(() => loadSubtasksOnly());`
- New effect: `useEffect(() => { saveSubtasksOnly(subtasksOnly); }, [subtasksOnly]);`
- New `mainsById` memo, built from the unfiltered `tasks` prop:

  ```ts
  const mainsById = useMemo(() => {
    const m = new Map<ID, { description: string }>();
    tasks.forEach((t) => {
      if (!t.parentId) m.set(t.id, { description: t.description || "" });
    });
    return m;
  }, [tasks]);
  ```

- `visibleTasks` (the role-scoped list) is wrapped: when `subtasksOnly` is true, filter to `t.parentId !== null` before the recurrence projection. This keeps a single source of truth flowing into both the grid and the unscheduled panel.
- Unscheduled panel render condition becomes `!subtasksOnly && showT && unscheduledTasks.length > 0`.
- Toolbar gets `subtasksOnly={subtasksOnly}` and `onSubtasksOnlyChange={(v) => { setSubtasksOnly(v); setExpandDay(null); }}`. Closing any open day modal on toggle matches the existing pattern used by the layer toggle and filter selects.
- `UnifiedDayCell` and `UnifiedDayModal` receive `mainsById` as a prop.

### `src/components/calendar/UnifiedDayCell.tsx`

Add prop `mainsById: Map<ID, { description: string }>`.

When rendering a task pill, if `t.parentId` is set and `mainsById.get(t.parentId)` exists:

- Prefix the visible label with `<parent (10 chars, …)> › `.
- Keep the existing tooltip — it already shows the full description, status, and recurrence; append the parent goal's description to the tooltip so users hovering on the pill always see the full context.

If `parentId` is null or the parent is missing from `mainsById`, render today's bare label (no behavioral change).

The 10-character cap on the parent prefix is a guardrail for the narrow day-cell width; combined with the existing 16-char cap on the subtask description, the pill stays on a single line.

### `src/components/calendar/UnifiedDayModal.tsx`

Add prop `mainsById: Map<ID, { description: string }>`.

In the task card body, when `parentId` is set and the parent is resolvable, add one line above the description:

```tsx
<div style={{ fontSize: 11, color: "#64748b", marginBottom: 2 }}>
  Part of: <strong style={{ color: "#475569" }}>{parent.description}</strong>
</div>
```

No truncation — the modal has room to show the full parent name.

### `src/App.tsx`

`mainsById` is already computed for the Board with shape `{ category, responsible }`. The Calendar needs only `description`. Rather than reuse the same map (which would force shape coupling), build a parallel `mainsByIdForCalendar` memo or extend the existing one to include `description`. Preferred: extend the existing `mainsById` shape to `{ category, responsible, description }` and pass it through. The Board's existing consumers ignore the new field; the change is additive.

## Edge cases

- **Subtask whose parent is filtered by client/member.** Parent label is built from the unfiltered list, so the prefix still resolves.
- **Subtask whose parent has been hard-deleted.** `mainsById.get(parentId)` returns undefined; the cell falls back to the bare label. No crash, no broken prefix.
- **Filter ON + layer set to "plans".** Tasks are hidden anyway, so the filter has no visible effect. The toggle is disabled and dimmed; users can still see it is set, just inactive.
- **Recurring subtasks projected into a future month.** The recurrence projection step preserves `parentId`, so projected occurrences are correctly included or excluded by the filter.
- **No subtasks in the visible month.** Grid renders empty days; no special empty state needed (parallels existing behavior when client/member filters yield nothing).
- **Storage corruption / quota errors.** `loadSubtasksOnly` returns `false`; `saveSubtasksOnly` silently ignores failures. Same pattern as `loadLayers / saveLayers`.

## Testing

- Extend `src/__tests__/utils/calendarLayers.test.ts` to cover:
  - `loadSubtasksOnly` returns `false` when nothing is stored.
  - `loadSubtasksOnly` returns `false` for invalid stored values.
  - `saveSubtasksOnly` round-trips both `true` and `false`.
- Add `src/__tests__/pages/calendarPage.subtasksOnly.test.tsx`:
  - Render `CalendarPage` with a fixture containing one parent goal and two child subtasks on different days of the current month.
  - With the filter OFF, all three rows appear in day cells; the unscheduled panel renders if applicable.
  - Click the "Subtasks only" pill; assert that only the two child subtask labels remain in day cells, the parent goal is gone, each subtask pill carries the parent prefix, and the unscheduled panel is unmounted.
  - Re-render with `localStorage` pre-seeded to `1`; assert the filter is ON on mount.
- Snapshot or DOM assertion on `CalendarToolbar` to confirm the pill is disabled when layers is `"plans"`.

## Files touched

- `src/utils/calendarLayers.ts` — new persistence helpers.
- `src/components/calendar/CalendarToolbar.tsx` — pill button + two new props.
- `src/components/calendar/UnifiedDayCell.tsx` — parent-goal prefix on subtask pills.
- `src/components/calendar/UnifiedDayModal.tsx` — `Part of: …` line on subtask cards.
- `src/pages/CalendarPage.tsx` — filter state, persistence, upstream filtering, unscheduled panel guard, prop wiring.
- `src/App.tsx` — extend `mainsById` to include parent description and pass to `CalendarPage`.
- `src/__tests__/utils/calendarLayers.test.ts` — extend.
- `src/__tests__/pages/calendarPage.subtasksOnly.test.tsx` — new smoke test.

## Trade-offs and risks

- **Boolean vs enum.** A boolean is the smallest change that satisfies the request. If users later ask for "Goals only", widening to `"all" | "goals" | "subtasks"` is a mechanical refactor — the filter is centralized in `CalendarPage`.
- **Pill button vs adding a fourth layer state.** A separate pill preserves the orthogonality of the two axes. Cramming "subtasks" into the existing radio would force users to give up either the "tasks + plans" combined view or the "tasks only" combined view to see subtasks-only. Not worth the simplification.
- **Parent prefix truncation.** Capping the parent name at 10 chars can produce ambiguous prefixes when two goals share a long common prefix. Acceptable for v1; the tooltip and the day-modal `Part of:` line both show the full name.
- **localStorage coupling.** The filter is per-browser, not per-user-account. Matches the existing `tasktracker.calendar.layers` pattern; consistent UX even if not synced across devices.

## Out of scope (deferred)

- Grouping subtasks under parent goals in the day modal.
- A symmetric "Goals only" filter.
- Server-side filtering at the task list endpoint.
- Restyling parent-goal pills when the filter is OFF (no change to today's look).
- Filtering or labelling work plans by subtask relationship.
