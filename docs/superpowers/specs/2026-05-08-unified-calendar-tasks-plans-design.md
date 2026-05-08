# Unified Calendar: Tasks + Work Plans

**Date:** 2026-05-08
**Status:** Approved (pending implementation plan)

## Goal

Merge the standalone Work Plan calendar (today inside `Work Log → 📅 Calendar`) into the **main Calendar** page so that admins and managers can monitor, in one view:

- **Client work allocation** — what work is scheduled across clients on any given day.
- **Member performance** — what each member is planned and delivering, side-by-side with their tasks.

Tasks and Work Plans are different data shapes with different colour languages today. The design preserves both languages by stacking them as two visually distinct sections inside each day cell, controlled by a layer toggle.

## Current state (for reference)

### Main Calendar (`pages/CalendarPage.tsx`)
- Receives `tasks: Task[]` from `App.tsx`.
- Filters by **Client** and **Member** (dropdowns derived from visible tasks).
- Each day cell shows up to 3 task chips, coloured by **task status** (Overdue red, Today cyan, Pending orange, etc.). `+N more` for overflow.
- Click a day → modal lists all tasks with status, recurrence, client, responsible, category, remarks.
- Has an **Unscheduled Tasks** panel below the grid for tasks with no `targetDate`.
- Role-based visibility filtered client-side: admin sees all, manager sees own + managed, employee sees own.

### Work Log → Work Plan Calendar (`components/worklog/WorkPlanCalendar.tsx`)
- Loads its own data via `apiGet('/work_plans/')` inside `WorkPlanTab`, with a `ws.subscribe('work-plans', …)` live-update channel.
- Filters by **Member**, **Client**, **Month** (the calendar nav replaces the month dropdown when in calendar view).
- Each day cell shows up to 3 plan chips, coloured by **employee** (stable per-member colour from `MEMBER_PALETTE`), with member initials avatar + client/task label.
- Click a day → inline detail panel below the grid showing employee avatar, client, `task_description`, and `hours_planned` per plan, plus a planned-hours total.
- Role-based visibility is server-side via `/work_plans/`.

The two views answer different questions today, and that is the tension the unified design resolves.

## Design

### 1. Each day cell renders two sections

Each cell has up to two stacked sections, separated by a thin dashed divider:

1. **Tasks section** (top) — chips coloured by status, existing `CalendarPage` chip style. Recurring tasks keep the `⟳` prefix.
2. **Plans section** (bottom) — chips coloured by employee, existing `WorkPlanCalendar` chip style with initials avatar + label.

Each section shows up to **2** items, then a `+N more` line. Either section is hidden when its layer is toggled off, or when it has zero items for that day.

**Top-right cell badge** behaviour:
- Plans layer **off** (Tasks only) → keep today's `N ⤢` task-count badge.
- Plans layer **on** → show planned-hours badge `Xhr` (e.g. `4hr`). The chip counts in each section already convey "how many", so the badge focuses on the planning signal that the cell layout otherwise hides.

### 2. Toolbar above the grid

Single row replacing the current filter row, in this order from left to right:

```
[ ‹ Prev ] [Month Year] [ Next › ] [ Today ]   [Both | Tasks | Plans]   [Client▾] [Member▾] [✕ Clear]
```

- **Layer toggle** — three pill buttons; default `Both`. Selection is persisted in `localStorage` under a stable key (e.g., `calendar.layers`) so the choice survives reloads.
- **Filters**:
  - `Client` and `Member` dropdowns are shared across both layers.
  - Option lists are the **union** of values from visible tasks and visible plans (after role-based visibility, before any layer toggle).
  - Filters apply to both layers simultaneously. `✕ Clear` resets both filters.

### 3. Layer-aware legend

Below the toolbar:

- Tasks layer on → render the existing **status legend** row (every status from `COLUMNS` plus the `⟳ = Recurring` marker), unchanged from today's `CalendarPage`.
- Plans layer on → render the **employee colour legend** row, identical to the one in `WorkPlanCalendar` (rounded chips with member dot + name).
- Both on → both rows, vertically stacked, compact spacing.

### 4. Day expand modal

Same modal trigger as today (click any day with content). Inside, two clearly labelled sections:

```
📅 8 May 2026                                  ✕
{N} tasks · {M} plans · {H} hrs planned
─────────────────────────────────────────────
TASKS ({N})
   [status pill] description   👤 responsible  🏷 category  💬 remarks
   …
─────────────────────────────────────────────
WORK PLANS ({M} · {H} hrs)
   {avatar} name · client      📋 task_description   ⏱ hours_planned
   …
```

- A section is omitted if its layer toggle is off, **or** if it has zero items.
- Header summary line counts only the visible (toggled-on) sections.
- Inside-section card styling re-uses the existing renderers from `CalendarPage` (task card) and `WorkPlanCalendar` (plan card).

### 5. Data fetching — extract `useWorkPlans` hook

Today, `WorkPlanTab` is the only consumer of `/work_plans/`. The main Calendar now needs the same data. Rather than duplicate the load + WS subscribe block, extract a shared hook:

**New file:** `frontend/task-tracker/src/hooks/useWorkPlans.ts`

```ts
// Returns { plans, loading, reload }.
// Internally: loads via apiGet('/work_plans/'), maps DTO→WorkPlan, sorts by date,
// fills `day` via getDayName, and subscribes to ws topic 'work-plans' for live updates.
```

**Consumers:**
- `WorkPlanTab` — replace its in-component `load` + `useEffect` block with `useWorkPlans()`.
- `CalendarPage` — call `useWorkPlans()` and apply the same role-based visibility logic that already exists for tasks (admin → all; manager → self + managed; employee → self).

The backend `/work_plans/` already enforces role-based visibility, so the client-side filter is defence-in-depth, not a security boundary.

### 6. Out of scope

The unified Calendar is **read-only** for plans:

- No add-plan or edit-plan UI on the main Calendar. Plan CRUD stays inside `Work Log → Work Plan tab`.
- No drag-to-reschedule for either tasks or plans.
- No change to the Work Log → Calendar view; it remains as the focused planning view.
- Unscheduled-tasks panel stays Tasks-only. Work plans always carry a date in the schema (`WorkPlanDto.date: IsoDate`), so there are no unscheduled plans to surface.

## Files touched

| File | Change |
|------|--------|
| `frontend/task-tracker/src/pages/CalendarPage.tsx` | Major edit. Adds plan rendering, layer toggle, two-section cells, two-section expand modal, layer-aware legend. |
| `frontend/task-tracker/src/hooks/useWorkPlans.ts` | **New.** Shared hook for `/work_plans/` load + WS subscribe. |
| `frontend/task-tracker/src/components/worklog/WorkPlanTab.tsx` | Small refactor — replace inline `load`/`useEffect` with `useWorkPlans()`. No behaviour change for Work Log. |
| `frontend/task-tracker/src/App.tsx` | No change. `CalendarPage` fetches plans itself via the hook. |

## Acceptance criteria

1. The main Calendar page renders both Task chips and Work Plan chips for the visible month, with the layout and styling described above.
2. Layer toggle pills `Both | Tasks only | Plans only` switch which sections render in each cell, in the day-modal, and in the legend. Choice persists across reloads.
3. `Client` and `Member` filters apply to both tasks and plans simultaneously.
4. Click on a day with at least one item opens the modal; the modal shows tasks and plans in their own sections according to the active layer toggle.
5. Role-based visibility behaves the same as today on both layers (admin all, manager self+managed, employee self).
6. The Work Log → Work Plan calendar continues to function unchanged for users.
7. Live updates (WS `work-plans` topic) refresh both the main Calendar and Work Log without a manual reload.
8. The legend updates when layers toggle on/off; only relevant decoders are visible.

## Notes & open questions

- **Cell height with both layers on**: with 2 + "+N more" per section, a busy day shows ~6 lines plus the date row. Existing `minHeight: 90` may need to grow to ~140 when Plans layer is visible. Final value to be tuned during implementation.
- **localStorage key**: use `tasktracker.calendar.layers` to namespace.
- **Empty state**: when both layers have zero items in the visible month, the grid still renders but cells show only the date number (no badge). The Unscheduled-tasks panel below still appears if there are unscheduled tasks.
