# Monthly Subtask Materialization with Cascading Edits

**Date:** 2026-05-10
**Branch:** Add_Task_subcategoryRepeatance
**Status:** Spec for implementation

## Problem

When a user creates a goal in the Add Task modal, the current flow eagerly materializes one subtask row per occurrence across the entire engagement window. A 12-month engagement with ~10 sub-categories produces 100+ rows, all visible at creation time. This is overwhelming, makes per-client customization fiddly, and conflates "the engagement plan" with "the work for this month".

The desired flow:

1. **At creation** the modal shows subtask rows for the **current calendar month only**, not the full engagement.
2. The user adjusts the month's roster (add/remove sub-categories) and assigns owners. Both adjustments **persist forward** — they apply to all later months too.
3. Opening the goal in a later calendar month shows that month's roster, with dates and owners inherited from the most recent earlier month. Editing owners in any month cascades **forward** to subsequent months but never rewrites the past.

## Goals

- Subtask grid in the Add/Edit Task modal shows exactly one month at a time, selectable via a month dropdown.
- Add/remove of sub-categories in the current or a future month propagates to every later month.
- Owner change in month M updates M and every later already-materialized row of the same plan, plus the plan's default for not-yet-materialized future months.
- Past months are read-only.
- Existing tasks (already materialized eagerly) are migrated to the new model so the modal looks identical regardless of when the goal was created.
- The DB no longer stores hundreds of pre-materialized rows for newly created goals.

## Non-goals

- Indefinite engagements with no end date. Engagement length stays a per-goal field; we just don't pre-materialize the whole window.
- Re-adding a removed sub-category with a *gap* (e.g. remove BRS in July, re-add in October leaving Aug/Sept inactive). For now, re-adding extends the existing plan from the current month forward; gaps are out of scope.
- Per-month owner *forks* (e.g. "use owner X only for July, but keep August's existing owner Y untouched"). Owner cascade always overwrites future rows; if the user needs a per-month override later, they can edit that month after the cascade.
- A separate read-only "history" view across months. Past months are accessible via the same month dropdown but are rendered read-only inline.
- Migrating completed tasks differently. Migration treats every existing goal the same way regardless of completion state.

## Architecture

### Data model

A new `TaskSubcategoryPlan` row sits between a goal Task and its child Task rows. It captures *what* sub-categories the goal includes and *when* they are active; child Tasks remain the per-month materializations.

```python
# core/tasks/models.py

class TaskSubcategoryPlan(TimeStampedModel):
    main_task = models.ForeignKey(
        Task, on_delete=models.CASCADE, related_name="sub_plans"
    )
    subcategory = models.ForeignKey(
        "masters.Master",
        on_delete=models.PROTECT,
        limit_choices_to={"type": "category"},
        related_name="plans",
    )
    # Frozen at attach time so a master rename / recurrence change doesn't
    # retro-shift the plan for already-running goals.
    recurrence = models.CharField(
        max_length=20, choices=Task.RECURRENCE_CHOICES, default="monthly"
    )
    target_day = models.PositiveSmallIntegerField(null=True, blank=True)
    default_owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name="default_owner_plans",
    )
    # Both stored as the first day of the month for clean month-arithmetic.
    active_from_month = models.DateField()
    active_until_month = models.DateField(null=True, blank=True)

    class Meta:
        unique_together = [("main_task", "subcategory")]
```

`Task` gains two date fields used by the modal as defaults and to bound the month dropdown:

- `engagement_start: DateField(null=True)` — first-of-month
- `engagement_end: DateField(null=True)` — first-of-month

Both populated at creation from the modal's Start Month + Length. They never auto-update; the user can edit them in the Edit Task modal if the engagement gets extended.

### Materialization

A child Task for plan P in month M exists iff:

- M ∈ [P.active_from_month, P.active_until_month] (inclusive), and
- M is on a recurrence step from P.active_from_month (e.g. quarterly only every third month from the start).

A `materialize_month(task, month)` helper, called by the GET endpoint, walks each active plan and creates any missing child Task for `month`. It is idempotent: running it twice on the same (goal, month) is a no-op.

Materialization does not touch past months. A goal's past child rows reflect what was current at the time they were materialized; that history is preserved verbatim.

### Owner cascade

When a child row in month M has its `responsible` field changed via the cascading endpoint:

1. The row itself is updated.
2. Every already-materialized child of the same plan with `target_date > row.target_date` is updated to the new owner.
3. The plan's `default_owner` is updated, so any month materialized after this point also picks up the new owner.

Past child rows (`target_date < row.target_date`) are not touched.

If a user changes owners in month M, then later changes owners in an earlier-but-still-future month M' (M' < M but both > today), step 2 will overwrite the M-era change for any row in [M', ∞). This is the documented behavior — most-recent-edit wins forward.

### Add / remove flow

**Add sub-cat in month M:**

- If a plan already exists for (goal, sub-cat):
  - Set `active_from_month = min(existing, M)` and clear `active_until_month` if it was set to a value before M.
- Else:
  - Create a plan with `active_from_month = M`, `active_until_month = goal.engagement_end` (or null if engagement_end is null), `default_owner = ` user-supplied or null, recurrence/target_day copied from the sub-cat master.
- Materialize the row for M immediately so the user sees their new sub-cat in the grid.

**Remove sub-cat in month M:**

- Set the plan's `active_until_month = M - 1 month`. If that falls before `active_from_month`, hard-delete the plan instead.
- Hard-delete every materialized child for that plan with `target_date >= first_of_month(M)` *that has no completion data*. Rows with a `completed_date` set are preserved (history) but unlinked from the plan by setting their `category` field unchanged — they remain visible in past-month views but won't generate future rows.

### Past-month read-only enforcement

The serializer rejects writes to a child Task whose `target_date < first_of(today's calendar month)`. The modal also disables inputs client-side as a UX guardrail; the server is the source of truth.

"Today's calendar month" is computed in the server's local timezone (the existing project convention). For cross-timezone correctness this can be revisited, but it matches every other date-bounded feature in the codebase today.

## API surface

All paths assume the existing `/api/tasks/` viewset.

- `POST /api/tasks/` — payload now includes `plans: [{ subcategory_uid, recurrence, target_day, default_owner_uid }]` instead of a flat `subs` list. Server creates Task + plan rows + materializes current-month children.
- `GET /api/tasks/<uid>/?month=YYYY-MM` — returns the goal plus children whose `target_date` is in the requested month. If `month` is the current calendar month, lazy-materializes any missing rows for active plans before returning. For past months, returns whatever exists. For future months within the engagement window, also lazy-materializes (so the user can preview).
- `POST /api/tasks/<uid>/plans/` — `{ subcategory_uid, month, default_owner_uid? }`. Adds or extends a plan, materializes the row for `month`, returns the new child + updated plan.
- `DELETE /api/tasks/<uid>/plans/<plan_uid>/?from_month=YYYY-MM` — caps the plan's `active_until_month` and removes future un-completed children.
- `PATCH /api/tasks/<uid>/subtasks/<child_uid>/` — accepts `cascade_owner: bool`. When true and `responsible` changed, cascades per the rules above. When false (or absent), behaves like today (single-row edit).

The board's existing list endpoint (`GET /api/tasks/?status=...`) keeps returning flat child rows scoped by status; only the modal's detail fetch is month-scoped.

## Migration

A single Django data migration runs once per deploy:

1. For every `Task` with `parent IS NULL` and at least one child:
   1. Group children by `category_id`.
   2. For each group:
      - `subcategory = the Master with that id`. Skip the group if `category_id IS NULL` (legacy goal with un-categorised children — leave as-is).
      - `recurrence` and `target_day` come from the sub-cat master. If missing or 'onetime', infer from the spread of `target_date`s: monthly if every consecutive month is present, quarterly if step ≈ 3, etc. Fall back to 'monthly'.
      - `active_from_month = first-of-month of min(target_date)` across the group.
      - `active_until_month = first-of-month of max(target_date)`.
      - `default_owner = responsible` of the child with the largest `target_date` (most recent).
   3. Create the `TaskSubcategoryPlan`. Children stay as-is.
2. For every `Task` with `parent IS NULL`, populate `engagement_start` / `engagement_end` from min/max of plan dates if any plan exists; otherwise leave null.

The migration is idempotent: re-running on a goal that already has plans skips it.

## UI / UX

### Add Task modal (creation)

- Engagement panel and the existing Start Month + Length fields stay. They now default the plan dates instead of pre-materializing rows.
- Subtask grid header gains: a **Month dropdown** (defaulted to today's calendar month — never the engagement start when they differ; today's month is what the user is operating in) and a label like "Showing 7 sub-tasks for May 2026 (Plan: 7 active)".
- "+ Add subtask" opens the existing sub-cat picker; on save the row is created for the selected month only, plus the plan entry behind it.
- "✕" on a row triggers a confirm: "Remove [sub-cat] from this goal starting [Month]? Past months stay; future months won't generate." On confirm, plan is capped + future rows deleted.
- Owner cell change shows an inline "Apply to following months" hint that is *informational only* — cascade always happens. The hint sets the user's expectation and matches the agreed behavior.

### Edit Task modal (existing goal, today's month)

Identical to the creation modal but the month dropdown now ranges across `[engagement_start, engagement_end]`, defaulted to today's calendar month.

### Edit Task modal, past month selected

- Inputs are disabled. Add subtask button hidden. Remove (✕) hidden. Owner dropdowns disabled.
- A subtle banner: "Showing [Month] — past months are read-only."

### Edit Task modal, future month selected

- Same as current-month behavior: editable, cascading. Adding/removing in a future month sets active_from_month / active_until_month accordingly so the change still propagates to every month from that point on.

### Empty / boundary cases

- A goal whose engagement_end is in the past: the dropdown still includes today's month and the next month so the user can extend the engagement by adding a plan there.
- A goal with no plans (legacy or fully-removed): grid renders empty; "+ Add subtask" works as expected and creates the first plan.

## Files touched

**Backend**
- `core/tasks/models.py` — new `TaskSubcategoryPlan` model; `engagement_start` / `engagement_end` on `Task`.
- `core/tasks/serializers.py` — accept `plans` payload at create; new month-scoped read serializer; cascade flag on subtask PATCH.
- `core/tasks/views.py` — `month` query param; new `plans` action endpoints; cascade logic in subtask update.
- `core/tasks/services.py` (new file, narrow) — `materialize_month`, `cascade_owner_forward`, `add_or_extend_plan`, `cap_plan`. Keeping these out of views/serializers makes them unit-testable in isolation.
- `core/tasks/migrations/00xx_add_subcategory_plan_and_engagement.py` — schema migration.
- `core/tasks/migrations/00xy_backfill_subcategory_plans.py` — data migration (idempotent, RunPython).
- `core/tasks/tests.py` — coverage for materialization, cascade, add/remove edge cases, past-month read-only enforcement, migration backfill.

**Frontend**
- `frontend/task-tracker/src/components/board/TaskModal.tsx` — month state; selector; replace eager `buildSubsFromTemplate` flow with plan-payload + month-scoped fetch.
- `frontend/task-tracker/src/components/board/SubtaskTable.tsx` — `readOnly` mode for past months; cascade flag on owner change; add/remove call new plan endpoints.
- `frontend/task-tracker/src/components/board/recurrence.ts` — add `monthsBetween(start, end)` helper for the dropdown.
- `frontend/task-tracker/src/types/api.ts` — types for `TaskSubcategoryPlan`, month-scoped task response.
- `frontend/task-tracker/src/hooks/useTask.ts` (or equivalent fetch hook) — `month` query param threading.

## Trade-offs and risks

- **Lazy materialization** keeps storage clean and supports indefinite engagements later; the cost is one extra round-trip when switching months. For typical 12-month engagements this is well below 100ms.
- **One plan per (goal, sub-cat)** is simple but doesn't model gaps. If users start needing remove-then-re-add-with-gap, we add a second plan row instead of extending — schema already supports it (just drop the unique_together).
- **Cascade always overwrites** is the simplest model and matches the user's stated behavior. Trade-off: a user who wanted "change July only" gets future months overwritten and has to re-edit them. Acceptable for v1; can add a "this month only" toggle later.
- **Migration inference**: when a sub-cat master lacks recurrence info, we infer from child date spacing. Goals with irregular spacing (e.g. ad-hoc one-off children) will get classified as 'monthly' and *might* materialize phantom future months on first view if the user's engagement_end is later than the last child. Mitigation: the migration sets `active_until_month` = max child date, so phantoms only happen if the user later extends the engagement. We accept this as low-risk.
- **Owner cascade vs per-row history**: cascade rewrites future rows in place. We don't keep a per-month audit of "owner was X before Y took over" beyond the existing `TaskLog` snapshots. Existing TaskLog entries continue to capture each cascade as a per-row change.

## Out of scope (deferred)

- Recurrence editing per plan after creation (currently you remove + re-add to change cadence).
- Bulk sub-cat add (pick multiple at once).
- Per-month overrides for `target_day` (e.g. "April only, due on the 20th not the 5th").
- A history-only "see all months at once" view; the existing dashboard / filter views still surface this if needed.
