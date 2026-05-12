# Employee Dashboard — Match Admin Layout

**Date:** 2026-05-12
**File touched:** `frontend/task-tracker/src/pages/DashboardPage.tsx` (employee branch only)

## Goal

Make the Dashboard for regular employees look like the admin/manager dashboard — same panels, same click-to-drill behaviour — but scoped to the employee's own tasks. Managers already see an admin-style view (Team Performance + By Client) scoped to their team; this spec brings solo employees into the same visual family.

## Current vs. New

### Current employee layout

```
[Stats row]
[Active Tasks table — inline TaskDetailTable]
[Status Distribution  |  Recent Completions]    ← 2-col grid
```

### New employee layout

```
[Stats row]                  (unchanged)
[By Client]                  full-width, admin-style, click-to-drill
[Status Distribution]        full-width, admin-style, click-to-drill
```

## Decisions

| Question | Choice |
|---|---|
| Show Team Performance for solo employees (one-row table)? | **No** — hide entirely. |
| Keep Recent Completions block? | **No** — remove for clean match with admin. |
| Side-by-side or stacked layout for the two panels? | **Stacked**, full-width each. By Client typically has more rows and benefits from horizontal room. |
| Keep inline Active Tasks table? | **No** — Active stat card already drills into it. |
| Admin/manager branches? | **No change.** |

## Data scope

No new filtering. The existing `filteredTasks` (DashboardPage.tsx:207–219) already restricts to the employee's own tasks when `!isAdmin && !isManager`. Both panels consume that same array.

## Component reuse

- **`<ClientTable>`** — same component the admin view renders. Props: `tasks`, `allTasks`, `clientNames`, `todayStr`, `onSelectClient`, `onTaskUpdated`, `onPatchTask`, `profile`, `onEditTaskFull`.
- **`<StatusDist>`** — same component the admin view renders. Props: `tasks`, `onSelectStatus`.

`clientNames` for the employee view is derived from `filteredTasks` (already employee-scoped), exactly like the admin branch.

## Panel headers

Match admin wording:

- `🏢 By Client` with subtitle `(click to view tasks)`
- `📈 Status Distribution` with subtitle `(click to view tasks)`

## Click-to-drill behaviour

Both panels reuse the existing `setDrillDown({ type: "client", value: c })` and `setDrillDown({ type: "status", value: s })` paths. Drill-down views (`drillDown?.type === "client"` etc.) already exist higher up in the file and need no change — they render `<TaskDetailTable>` against `filteredTasks` which is already employee-scoped.

## What gets removed

From the existing employee branch (DashboardPage.tsx:1003–1040):

- Outer `<div className="dm-box">` containing `📋 Active Tasks` and its inline `<TaskDetailTable>`.
- The 2-column grid wrapper holding `Status Distribution` and `Recent Completions`.
- The `Recent Completions` panel and its `<RecentCompletions>` import (if unused elsewhere).

## What stays unchanged

- Page title line (already reads `📊 My Dashboard — {myName}` for solo employees).
- Filter bar (period / client / reporting manager / main category / main responsibility / member / clear / export CSV).
- Stats row (6 cards: My Tasks, Completed, Active, Today, Overdue, Completion Rate).
- Full Report button and drill-down handlers.
- Admin branch (DashboardPage.tsx:888–1001).
- All other pages.

## Imports

After the change, `RecentCompletions` is no longer referenced in the employee branch. If grep confirms it's used nowhere else in the file, remove the import to avoid an unused-import warning.

## Acceptance criteria

1. A regular employee (not admin, not manager) sees, in order: title, filter bar, stats row, **By Client** panel (full width), **Status Distribution** panel (full width).
2. The employee no longer sees an inline Active Tasks table or a Recent Completions panel on the dashboard root.
3. Clicking a client name in **By Client** drills into the existing `TaskDetailTable` for that client, scoped to the employee's tasks.
4. Clicking a status bar in **Status Distribution** drills into the existing `TaskDetailTable` for that status, scoped to the employee's tasks.
5. The Active stat card still drills into the active-tasks list (existing behaviour).
6. Admins and managers see no visual change.
7. No TypeScript or ESLint errors introduced (including unused-import warnings).
