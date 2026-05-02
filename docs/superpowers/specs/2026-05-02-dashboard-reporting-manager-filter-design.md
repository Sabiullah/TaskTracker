# Dashboard — Reporting Manager filter

**Date:** 2026-05-02
**Page:** Team Dashboard (`frontend/task-tracker/src/pages/DashboardPage.tsx`)
**Branch:** `Reporting_manager_filter`

## Problem

The Team Dashboard filter bar today exposes Month, Client, and Member. Admins
who want to slice the dashboard by a manager's team have to pick each member
one by one. Managers who themselves have sub-managers cannot focus on a
sub-manager's slice without doing the same.

## Goal

Add a fourth filter — **Reporting Manager** — that scopes all dashboard
content (stat cards, Team Performance table, By Client table, Status
Distribution, drill-downs) to the selected manager and their entire reporting
sub-tree.

## Visibility

- **Admins** — filter visible. Dropdown lists every profile that appears as a
  manager somewhere (i.e. is present in at least one other profile's
  `manager_ids`).
- **Managers** — filter visible only when they have at least one sub-manager
  under them. Dropdown lists actual managers in their own reporting sub-tree
  (excluding themselves).
- **Regular members** — filter hidden.

## Filter semantics

When `fReportingManager = M`:

- Dashboard shows tasks whose `responsible` is in `subtree(M)`, where
  `subtree(M)` = M's `full_name` plus the `full_name` of every direct and
  indirect report (whole sub-tree, transitive).
- The Member filter is **overridden** — it is ignored in the filter pipeline
  AND the Member `<select>` is disabled in the UI. Selecting an RM auto-clears
  any current Member value so the visible state matches the active filter.
- Client (🏢) and Month (📅) filters compose normally on top of RM (AND).

## Data & helpers

`actualManagers(profiles): Profile[]`
Returns all profiles whose `id` appears in some other profile's `manager_ids`.
Used for the admin dropdown.

`subTreeManagers(rootId, profiles): Profile[]`
Returns every actual-manager whose chain leads back to `rootId` (BFS over
reverse `manager_ids` edges, excludes `rootId` itself). Used to scope the
manager's dropdown to their own sub-tree.

`subTreeNames(rootId, profiles): Set<string>`
Returns the `full_name` of `rootId` plus every direct and indirect report,
BFS over reverse edges. Used by the filter pipeline. Cycle-safe via a visited
set on profile id.

All three helpers live in a new module
`frontend/task-tracker/src/components/dashboard/reportingManager.ts` so they
can be unit-tested without rendering the page.

## State

New state on `DashboardPage`:

```ts
const [fReportingManager, setFReportingManager] = useState<string>(""); // profile.id
```

The dropdown's `value` is the profile **id** (not `full_name`), because the
sub-tree walk operates on `manager_ids` which are UUIDs. The filter pipeline
resolves id → set of names via `subTreeNames`.

## Filter pipeline change

In the existing `filteredTasks` useMemo, after the role-gating block
(currently lines 142–154 of `DashboardPage.tsx`) and before the Client/Member
filters:

```ts
if (fReportingManager) {
  const names = subTreeNames(fReportingManager, profiles);
  src = src.filter((t) => names.has(t.responsible));
}
if (fClient) src = src.filter((t) => t.client === fClient);
if (fMember && !fReportingManager) {
  src = src.filter((t) => t.responsible === fMember);
}
```

`fReportingManager` is added to the useMemo dependency array.

## UI

New `<select>` in the filter bar, between the Client and Member selects, with
icon 👔 and default option "All Reporting Managers". Hidden entirely when
`rmDropdownOptions.length === 0` (regular members; managers with no
sub-managers).

When an RM is selected:
- The Member `<select>` gets `disabled` attribute and a muted background.
- `setFMember("")` is called in the same handler that sets the RM, so the
  visible Member value matches the (ignored) filter state.
- Clearing the RM (back to "All Reporting Managers") re-enables Member.

The existing Clear (✕) button additionally clears `fReportingManager`.
Visibility condition for Clear becomes
`(period || fClient || fMember || fReportingManager)`.

## Tests

New file `frontend/task-tracker/src/__tests__/components/dashboard/reportingManagerFilter.test.ts`:

- `subTreeNames` — root only (no reports), root + direct, root + direct +
  indirect (3 levels), cycle (A manages B, B manages A) does not infinite-loop.
- `actualManagers` — excludes profiles never referenced as a manager.
- `subTreeManagers` — for a logged-in manager, returns only sub-managers under
  them, never peers or seniors.

Smoke test extension on `DashboardPage` (new file
`frontend/task-tracker/src/__tests__/pages/dashboardReportingManager.smoke.test.tsx`):

- Admin renders the RM dropdown; picking a manager filters the team table to
  only the sub-tree.
- Picking an RM auto-clears `fMember` and disables the Member dropdown.
- Clearing the RM re-enables the Member dropdown.
- Manager with no sub-managers does not see the RM dropdown.

## Out of scope

- No backend or API changes.
- No "Reporting Manager" column added to TeamTable / ClientTable / drill-down
  tables. (TaskDrillModal already added an RM column on this branch — separate
  work.)
- The RM filter does not flow into CSV export beyond what filteredTasks
  already drives (export already serializes `filteredTasks`, so it
  automatically respects the new filter).
- No changes to non-admin/non-manager users beyond hiding the new control.
