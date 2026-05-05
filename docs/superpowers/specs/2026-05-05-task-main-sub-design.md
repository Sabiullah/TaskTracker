# Main task + sub-tasks (goal-with-subtasks)

**Date:** 2026-05-05
**Branch:** `AddTask_fullchange`
**Scope:** Backend (`core/tasks` model + serializer + view) and frontend (`TaskModal` rebuild). Existing dashboard / board / calendar / work-log views are unchanged.

## Summary

Replace the current flat **Add New Task** modal with a **Main Goal + Sub-tasks** editor. A *Main* goal owns shared context (org, client, recurrence, reporting manager, target date) and zero or more *Sub-tasks*. Each sub has its own category, description, responsible, target date, expected date, and remarks. Sub-task target dates are capped to the main's target date.

The dashboard, board, calendar, and work-log continue to render every task as an individual row — both Mains and Subs appear flat as today. Clicking any row opens the new full-goal modal (Main + all its Subs) for editing.

All currently existing tasks become Mains automatically (no data migration needed; new `parent` column is null on every existing row).

## Motivation

A "task" today is one flat row, but real work is goals with sub-deliverables. A manager wants to set a goal once with a target date, and break it into pieces assigned to different people, each with its own target date that can't slip past the goal's. Today users either compress everything into one row, losing per-person tracking, or create N unrelated tasks, losing the goal grouping.

## Non-goals

- Recurring goals that auto-replicate parent + subs each period.
- Sub-of-sub nesting (3+ levels). Two levels max.
- Templates ("create the standard 5 subs for monthly close").
- Bulk reordering of subs (rendered in creation order).
- Roll-up status — Main does not auto-complete when subs complete.
- Per-sub Reporting Manager override.
- Changes to dashboard/board/calendar/work-log queries or filters.

Each is a clean follow-up if needed later.

## Decisions (from brainstorming)

| # | Decision |
| --- | --- |
| Q1 | Main has `reporting_manager` (= "Main Owner"). Sub has `responsible` (= "Task Owner"). Sub inherits `reporting_manager` from parent. |
| Q2 | Main owns: `org`, `client`, `recurrence` (inherited by subs). Per-row: `category`, `description`, dates, `remarks`. |
| Q3 | Clicking any row (Main or Sub) in dashboard/board opens the **full goal modal** (Main + all subs). If a Sub was clicked, that sub-row is auto-scrolled and briefly highlighted. |
| Q4 | Statuses are independent. Main has its own auto-status; subs have their own. No rollup. |
| Q5 | Modal layout: Main fields on top (current form style), Sub-tasks table below with add/remove rows. |

## Architecture

### Data model

Single `Task` table (no new table). Add a self-referential `parent` FK:

```python
# core/tasks/models.py
class Task(TimeStampedModel):
    ...
    parent = models.ForeignKey(
        "self",
        null=True, blank=True,
        on_delete=models.CASCADE,
        related_name="subtasks",
        db_index=True,
    )
```

- `parent IS NULL` → row is a **Main**.
- `parent IS NOT NULL` → row is a **Sub**.
- Subs cannot have subs. Enforced in `clean()`: if `parent` is set, `parent.parent` must be NULL.
- Inheritance fields (`org`, `client`, `reporting_manager`, `recurrence`) are **denormalized** onto sub rows: when a sub is saved through the goal serializer, we copy these from the parent, so existing per-row queries continue to work without joins.
- Cascade: deleting a Main deletes its subs (`on_delete=CASCADE`). The frontend confirms with sub count.

### Validation rules

Layered on top of existing checks (description required, expected_date ≥ target_date, completed_date only with completed status):

1. **No grandchildren.** If `parent` is set, `parent.parent` must be NULL.
2. **Sub target ≤ Main target.** If both dates are set, `sub.target_date ≤ parent.target_date`. Error: *"Sub-task target date cannot be after the main goal's target date (YYYY-MM-DD)."*
3. **Expected date is uncapped vs main.** `sub.expected_date` may exceed `parent.target_date` — it's a realistic estimate. Existing rule (`sub.expected_date ≥ sub.target_date`) still applies.
4. **Main shrinkage check.** If a Main's `target_date` is moved earlier so any existing sub's `target_date` would now exceed it, block with: *"Cannot move main target date earlier than sub-tasks: {sub list}."* User adjusts the offending subs first (or in the same save — see Frontend below).

### Migration

One Django migration adds the `parent` column (nullable, indexed). No data migration. Every existing row remains a valid Main implicitly.

```
core/tasks/migrations/0XXX_task_parent.py
  - Add parent FK to self, null=True, blank=True, db_index=True
```

### API

A single create/update endpoint accepts the whole goal in one request, in one transaction.

- `POST /api/tasks/` — create a goal (Main + zero or more Subs).
- `PATCH /api/tasks/{main_uid}/` — update the goal as a tree.

Body shape:

```json
{
  "org": "...", "client": "...", "category": "...",
  "description": "...", "reporting_manager": "...",
  "target_date": "...", "expected_date": "...",
  "recurrence": "...", "remarks": "...",
  "subtasks": [
    {
      "uid": "<existing-or-null>",
      "category": "...",
      "description": "...",
      "responsible": "...",
      "target_date": "...",
      "expected_date": "...",
      "remarks": ""
    }
  ]
}
```

New `TaskWithSubtasksSerializer` wraps the existing `TaskSerializer` and handles subs. In one DB transaction:

1. Upsert the Main row.
2. For each sub in `subtasks`: create (no `uid`) or update (matching `uid`).
3. Delete any sub rows whose `uid` is no longer in the list.
4. Re-validate the Main↔Sub date constraints across the full tree before commit.

The existing flat `TaskSerializer` stays in place for the single-row endpoints used by board/dashboard quick-toggles (status changes, inline edits). Both Mains and Subs can still be patched individually outside the modal — the serializer rejects sub edits that would violate parent constraints.

`TaskLog` audit: each create/update inside the transaction emits its own `TaskLog` entry, same as today.

### Frontend modal

Replace `TaskModal` + `TaskFormFields` with three components:

```
TaskModal.tsx          // orchestrator, holds form state + submit
  ├─ MainGoalFields.tsx  // top form (org, client, category, description, RM, dates, remarks)
  └─ SubtaskTable.tsx    // bottom table; renders + manages sub rows
```

Layout (per Q5 = Option 1):

```
┌─ Add New Task / Edit Goal #123 ────────────────────────────┐
│  MAIN GOAL                                                 │
│  Org [▾]      Client [▾]    Recurrence [▾]   Status (auto) │
│  Category [▾] Reporting Manager [▾] *  (= Main Owner)      │
│  Description [____________________________________]        │
│  Target Date [__]  Expected Date [__]  Completed [__]      │
│  Remarks [________________________________________]        │
│                                                            │
│  SUBTASKS  (n)                            [+ Add subtask]  │
│  ┌─────────┬───────────────┬───────┬────────┬────────┬───┐ │
│  │Category │ Description * │Owner *│Target *│Expected│ ✕ │ │
│  ├─────────┼───────────────┼───────┼────────┼────────┼───┤ │
│  │ [▾]     │ [           ] │ [▾]   │ [__]   │ [__]   │ ✕ │ │
│  └─────────┴───────────────┴───────┴────────┴────────┴───┘ │
│                                                            │
│  [Cancel]                              [+ Save Goal]       │
└────────────────────────────────────────────────────────────┘
```

Behavior:

- Required to save: Main `description`, Main `reporting_manager`. Subs are optional.
- Per sub row required-on-add: `description`, `responsible` (Owner), `target_date`.
- Sub-row category dropdown reuses existing categories master.
- Sub-row Owner dropdown filters by Main's Org (consistent with current `responsible` filtering).
- "+ Add subtask" appends a blank row. "✕" removes; if the row was loaded from the server, confirm before removing (it will be deleted from DB on save).
- Sub date pickers set `max=` to Main target date. Inline red message under the cell if violated; Save button disabled until cleared.
- Existing rule `expected ≥ target` enforced on each row.
- If Main target date is changed to be earlier than any sub's target, those sub cells turn red and Save is disabled — user fixes the subs in the same modal and saves once.
- Each saved sub row shows its own auto-status as a small read-only badge.
- Mobile/narrow screens: subtasks render as stacked cards (one per sub) with the same fields.

### Edit flow (Q3 = A)

- Every list/board/calendar row's click handler routes to: `openGoalModal(row.parent?.uid ?? row.uid)`.
- Modal title: `Edit Goal #<main.serial_no>` regardless of which row was clicked.
- If a Sub was clicked, the modal scrolls to and briefly highlights that sub's row in the table.
- One Save button → one API call → atomic update of the whole tree.

### Dashboard / board / calendar

No query or filter changes. Optional cosmetic polish:

- Sub rows (where `parent IS NOT NULL`) get a small `↳` indicator next to the title in list views.
- Sub rows with empty title fall back to `"Sub of #<main.serial_no>"`.

These are display-only changes; no schema or query impact.

## Risk and rollback

- The migration is additive (one nullable column). Backwards-compatible — older clients hitting the flat `TaskSerializer` keep working; the new `TaskWithSubtasksSerializer` is opt-in via the new request shape.
- If a defect is found post-deploy, revert the frontend modal change and the new serializer; the data model can stay in place harmlessly (no rows have a parent yet).

## Acceptance checks

- Existing tasks display unchanged in dashboard/board/calendar after migration.
- Creating a Main with zero subs behaves identically to today's Add Task (same serial_no allocation, same logs).
- Creating a Main with N subs creates 1+N rows in one transaction, all with the same `org`/`client`/`reporting_manager`/`recurrence`.
- Sub target date > Main target date is rejected with the spec's error message — both server and client side.
- Editing a Main's target date to be earlier than any sub's target is rejected with the listed-sub error message.
- Deleting a Main cascades to its subs and writes the audit log.
- Clicking a Sub in dashboard opens the full goal modal with that sub auto-scrolled.
