# Recurring "work month" label on task descriptions — Design

Date: 2026-07-18
Branch: Month_Addn

## Problem

Monthly recurring tasks are meant to show which period the work covers
(e.g. a task due **10 Jul 2026** is June's work). Today that month is only
present when someone **hand-typed** it into the free-text `description`
(e.g. `BRS — Jun 2026`). This produces two defects:

1. **Inconsistency between clients / rows.** One goal shows
   `Purchase — Jun 2026` while another shows a bare `Book Review`; within a
   single goal, `BRS — Jun 2026` sits next to `Creditors Ageing` with no
   month. It depends entirely on what text a user typed.
2. **Staleness.** The typed month never updates. The same plan keeps
   stamping `Jun 2026` onto July, August, … children forever, because the
   materializer copies `plan.description` verbatim
   (`core/tasks/services.py`), and both display paths render `description`
   as-is. Verified against the local DB: 52 identical monthly children per
   plan, zero auto-generated months.

## Goal

The month shown must be **derived automatically** from each row's own
`target_date`, and must be the **month *before*** the target date — because
the team works for the previous month (target = deadline early in the
following month).

Example: `target_date = 2026-07-10` → label `Jun 2026`.

## Rule (single source of truth)

A task gets the derived ` — <MonthLabel>` suffix **only when all** hold:

- `recurrence === "Monthly"`, AND
- it is a materialized **occurrence** (`parentId != null`) — the umbrella
  main goal is excluded, AND
- it has a `targetDate`.

`<MonthLabel>` = the month one calendar month **before** `targetDate`,
formatted `MMM YYYY` (e.g. `Jun 2026`). January target rolls back to
December of the prior year (`2026-01-10` → `Dec 2025`).

Weekly / Onetime tasks, main goals, and rows without a target date are
returned unchanged.

## Design

### 1. One-time data cleanup (backend migration)

A Django data migration strips any trailing hand-typed month suffix so the
derived label is never doubled (`BRS — Jun 2026 — May 2026`).

- Targets `tasks_task.description` **and**
  `tasks_tasksubcategoryplan.description` (the plan is the template new
  children copy from — cleaning it keeps future children clean).
- Strips a trailing separator + month + year:
  regex `\s*[—-]\s*(Jan|Feb|…|Dec)\w*\s+\d{4}\s*$` (case-insensitive,
  tolerant of `—` or `-`, and of full month names like `June`).
- `RunPython` in Python (DB-agnostic: passes on CI SQLite and prod
  Postgres — see project constraint that CI is SQLite, prod is Postgres).
- Idempotent: re-running strips nothing further. Only touches rows whose
  description actually ends in a month suffix; leaves everything else byte
  for byte.
- Reverse migration is a no-op (we do not re-add typed months).

### 2. Shared display helper (frontend)

Two small pure functions, unit-tested in isolation:

- `workMonthLabel(targetDate: DateString | null): string` in
  `utils/date.ts` — returns the previous-month label via the existing
  `formatMonthLabel` (which already renders `"Jun 2026"`), or `""` when no
  date. Handles the January→December rollover.
- `taskDisplayDescription(task): string` in a new
  `utils/taskDescription.ts` — applies the Rule above and returns
  `` `${description} — ${label}` `` or the raw `description`.

Keeping the rule in one function means every surface (and the CSV export)
stays consistent and there is exactly one place to change the format.

### 3. Apply at read-only display + export surfaces

Replace the raw `description` render with `taskDisplayDescription(task)` at:

- Board occurrence card — `components/board/TaskCard.tsx:181`
- Dashboard drilldown table (on-screen) —
  `components/dashboard/TaskDetailTable.tsx:517`
- Dashboard drilldown **CSV export** `Description` field —
  `components/dashboard/TaskDetailTable.tsx:309-311`
  (this satisfies the "download with that text too" requirement; the CSV is
  built client-side, so the same helper covers it — there is no server-side
  task report export; `core/backup/views.py` is a raw restore backup and is
  intentionally left untouched)
- Calendar day cell / day modal — `components/calendar/UnifiedDayCell.tsx`,
  `UnifiedDayModal.tsx` (where a task description is shown)
- Client roadmap / action-point / overdue panels and Recent completions —
  where each renders a task's `description`

### 4. Edit surfaces are NOT changed

`TaskFormFields`, `SubtaskTable` row inputs, `EditRow`, and any other
`<input>`/editable cell keep binding to the raw `description`. Editing must
show and save just `BRS`, never a derived month the user could accidentally
persist.

## Non-goals

- No change to how children are materialized or stored — `description`
  stays the bare name.
- No month on Weekly / Onetime tasks or on umbrella main goals.
- No backend/API field for the label; it is purely presentational
  (plus the client-side CSV).

## Testing

Frontend (Vitest):
- `workMonthLabel`: `2026-07-10` → `Jun 2026`; `2026-01-10` → `Dec 2025`;
  `null` → `""`.
- `taskDisplayDescription`: Monthly occurrence → suffix appended; Monthly
  main goal (no parent) → unchanged; Weekly occurrence → unchanged;
  Monthly occurrence with null target → unchanged; already-clean name
  produces exactly one month.
- A render assertion on Board card / drilldown that a Monthly child shows
  `Sales — Jun 2026`.

Backend (Django):
- Migration test: rows with `BRS — Jun 2026`, `X - June 2026`, and a bare
  `Creditors Ageing` → become `BRS`, `X`, `Creditors Ageing`; running the
  strip twice changes nothing.

## Risks / edge cases

- Descriptions that legitimately end in a 4-digit year that is **not** a
  month suffix (e.g. `Audit FY 2025`) — the regex requires a month token
  immediately before the year, so `FY 2025` is not stripped. Confirmed by
  the `(Jan…Dec)` requirement.
- Timezone: label is derived by month arithmetic on the `YYYY-MM-DD`
  string, not `Date` UTC parsing, to avoid off-by-one-day month shifts.
