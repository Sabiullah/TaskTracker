# Daily Standup — Matrix Report

**Date:** 2026-05-22
**Status:** Approved (brainstorm)
**Area:** PACE → Daily Standup
**Branch:** StandingMeet_Rpt

## Problem

The current Daily Standup page (`frontend/task-tracker/src/pages/DailyStandupPage.tsx`) groups entries by date, with one date section per day expanded inline. To answer "what has Hashim been doing this month?" or "did Aravindh submit on May 15, 18, and 20?" the user has to expand each date section in turn. There is no single view that lets a manager scan an employee's standups across the month, or compare what several employees worked on across the same set of days.

## Goal

Add a second view to the existing Daily Standup page — a matrix table with employees as rows and dates as columns — so a manager can read a full month of standup updates at a glance, per employee.

## Scope

In scope:

- A **List / Matrix** toggle on `DailyStandupPage`. List is the existing view and default.
- A new read-only Matrix view, built as `DailyStandupMatrixView.tsx`, sharing the page's existing month picker, stats cards, and "+ Add Entry" button.
- Matrix rows: only employees with at least one standup entry in the selected month.
- Matrix columns: every date in the selected month (working days, weekends, and holidays — same set the attendance matrix already returns).
- Cell content:
  - If a standup entry exists for that (employee, date): show the **full `priorities` text** wrapped, with a small **BT / BD** chip indicating `breakthrough_type`, and a left-border tint indicating approval roll-up (green = all approvals Approved, amber = any Pending). Hover/title shows `collaboration_need` and `remarks`.
  - If no entry: look up the employee's attendance code for that date from `/attendance/matrix/`. Render a muted-grey label — `Leave`, `WFH`, `Half Day`, `Holiday`, `Sunday`, or `—` (default).
- Sticky left column (employee name + org chips), sticky top row (weekday + date).

Out of scope:

- Excel / CSV export.
- Click-to-edit from a matrix cell. Editing stays in the List view.
- Custom date ranges, week-by-week pagination, or multi-month spans.
- Org filter dropdown — rows continue to come from the standup visibility rules in `OperationalStandupViewSet.get_queryset`.
- Server-side aggregation. No new Python endpoints.

## Approach

Frontend assembly. The Matrix view re-uses two existing endpoints and joins them client-side:

1. `GET /operational_standups/?month=YYYY-MM` — already returns the full month of standups with priorities, type, approvals, and `profile_detail`. Used by the existing hook `useOperationalStandups`.
2. `GET /attendance/matrix/?month=YYYY-MM` — already returns `{employees, dates, cells}` keyed by employee uid and date, with attendance codes (`L`, `WFH`, `HD`, `H`, etc.). Used by `useAttendanceMatrix`.

No backend changes. No new permission checks — standup visibility is already enforced by `OperationalStandupViewSet.get_queryset` (caller must share at least one org with the profile).

## Components and data flow

```
DailyStandupPage
├── existing: month picker, stats cards, "+ Add Entry"
├── NEW: view toggle (List | Matrix)  — local useState, default "List"
├── List view (unchanged): DailyStandupDateSection per date
└── NEW: DailyStandupMatrixView
        props: { month, profile, isManager, standups, attendanceMatrix }
```

### `DailyStandupPage` changes

- Add `viewMode: "list" | "matrix"` state, default `"list"`.
- Render the toggle next to the month picker / "+ Add Entry" button in the header. Two pill buttons, active state matching existing button styling.
- When `viewMode === "matrix"`, call `useAttendanceMatrix(month)` alongside the existing `useOperationalStandups(...)`. Render `<DailyStandupMatrixView />` instead of the `dateGroups.map(...)` block. Pass `standups` and `attendanceMatrix.data` down.
- Stats cards remain visible above both views.

### `DailyStandupMatrixView` — new component at `frontend/task-tracker/src/components/pace/DailyStandupMatrixView.tsx`

Inputs:

- `month: string` (YYYY-MM)
- `standups: OperationalStandupDto[]` from `useOperationalStandups`
- `attendanceMatrix: MatrixPayload | null` from `useAttendanceMatrix`
- `loading: boolean` — true while either fetch is in flight

Local derivations (all `useMemo`):

- `dates: MatrixDate[]` — from `attendanceMatrix.dates`. If the matrix payload hasn't arrived, derive a fallback list from the month so the view degrades gracefully (cells will just show `—`).
- `employees: { uid, full_name, org_chips }[]` — unique by `profile.uid` from `standups`, sorted by `full_name`. Org chips are the union of `approvals[].org_name` across that employee's entries.
- `byEmpDate: Map<string, Map<string, OperationalStandupDto>>` — `emp_uid → date → entry` for O(1) cell lookup.
- `attendanceByEmpDate: Record<emp_uid, Record<date, CellPayload>>` — directly `attendanceMatrix.cells`.

Render:

- A bordered, scrollable container (same pattern as `AttendanceMatrixView`), `max-height: calc(100vh - 320px)`.
- Sticky thead row: empty corner cell, then one `<th>` per date showing `weekday` (small, muted) above `dd` (bold). Holiday columns: light grey background, weekday label hidden or shown as `H`.
- One `<tr>` per employee. First cell is sticky-left: full name (bold) + org chips on a second line.
- For each (employee, date) cell:
  - **With standup entry:**
    - Outer cell: `min-width: 220px; max-width: 280px; padding: 8px; vertical-align: top; border-left: 3px solid <approval-tint>;`
    - Approval tint: `#16a34a` if every approval is `Approved`, `#d97706` if any are `Pending`, transparent if there are no approval rows yet.
    - Type chip (top): small pill, `BT` = green (`#dcfce7` / `#166534`), `BD` = orange (`#fed7aa` / `#9a3412`), hidden if `breakthrough_type === ""`.
    - Body: `entry.priorities` rendered with `white-space: pre-wrap; font-size: 12px; line-height: 1.4;`.
    - `title` attribute combines `Collaboration: {collaboration_need || "—"}\nRemarks: {remarks || "—"}` so hover reveals the rest.
  - **Without standup entry:** look up `attendanceByEmpDate[emp_uid]?.[date]?.code`:
    - `L`, `L½`, `L½+H` → "Leave" (muted purple)
    - `WFH`, `WP` → "WFH" (muted teal)
    - `H` → "Half Day" (muted amber)
    - `HD` → use `holiday_name` if present (e.g. "Sunday", "Independence Day"), else "Holiday"; muted grey
    - `HW` → "Worked on holiday"; muted grey
    - `?` → "Open punch"; muted red
    - `A`, missing, anything else → `—`
- Empty state: if `employees.length === 0`, show "No standup entries this month." centred inside the bordered container.

### `useOperationalStandups` and `useAttendanceMatrix`

No changes. The page composes them.

## File-level change list

- `frontend/task-tracker/src/pages/DailyStandupPage.tsx` — add `viewMode` state, render toggle, conditionally render List vs. Matrix, call `useAttendanceMatrix(month)` when in matrix mode.
- `frontend/task-tracker/src/components/pace/DailyStandupMatrixView.tsx` — new file, pure presentational + memo-based joins.
- `frontend/task-tracker/src/components/pace/DailyStandupMatrixView.test.tsx` — new file, unit tests for the join + empty-cell logic (see Testing).

No backend changes. No type changes.

## Testing

Frontend (`vitest` + `@testing-library/react`):

- Renders one row per unique employee with a standup in the month.
- Excludes employees who have zero entries for the month even if they exist in `attendanceMatrix.employees`.
- Renders the full priorities text including line breaks.
- BT / BD chip renders based on `breakthrough_type`; hidden when empty.
- Left-border approval tint: all-approved → green; any-pending → amber; no approvals → transparent.
- Smart empty cells:
  - Standup absent + `L` code → "Leave"
  - Standup absent + `WFH` code → "WFH"
  - Standup absent + `HD` with `holiday_name: "Sunday"` → "Sunday"
  - Standup absent + no attendance entry → `—`
- Sticky behaviour: smoke test that the first column and header row have `position: sticky` classes applied.

No new backend tests (no backend changes). Existing tests in `core/pace/tests.py` and `core/attendance/test_matrix.py` continue to cover the underlying endpoints.

## Risks and mitigations

- **Wide tables on small screens.** Mitigation: horizontal scroll on a fixed container, sticky employee column, min/max cell width tuned for ~220–280px.
- **Long priorities cells make rows tall and uneven.** Mitigation: cell `max-width` caps width; row height grows to match the tallest cell, same as the existing date-grouped view's rendering of multi-line priorities. No truncation — the user explicitly chose "full text wraps."
- **Two parallel fetches on entering Matrix mode.** Mitigation: both endpoints are already used elsewhere and cached client-side; `Promise.all` keeps perceived latency to whichever is slower.
- **Attendance matrix payload missing for the month.** Mitigation: render `—` for empty cells when `attendanceMatrix === null` so the view still functions; the smart label is a progressive enhancement, not a hard dependency.

## Open questions

None at design time. All clarifications resolved during brainstorm.
