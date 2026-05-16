# Weekly Recurrence Bugfix — May 16 2026

## Symptom

A goal's sub-category plan was meant to materialise every Monday (sub-cat
master set to Weekly + target_day=1), but instead emitted one child per
month at day 1 — e.g. May 1 2026 (Friday) instead of every Monday.
Reopening Edit Goal then showed the day-1 row plus the user's expected
Monday rows, and subsequent months kept repeating the day-1 pattern.

## Root cause

Three issues compounded:

1. **Backend** — `_create_plans` in `core/tasks/serializers.py` fell back
   to `_normalize_recurrence("")` when both the plan-row override AND the
   master's recurrence were empty. That returns `"monthly"` for legacy
   compatibility — so a master with `recurrence=""` + `target_day=1`
   produced a `monthly target_day=1` plan, emitting day-1 of every month
   at engagement_start instead of Mondays.

2. **Frontend** — `buildPlansPayload` in `TaskModal.tsx` only emitted the
   `recurrence` override when `row.recurrence` was truthy. If `catMasters`
   had a stale empty value at preview time, the row's recurrence stayed
   empty even when the master's current recurrence was already "Weekly"
   — and the backend's fallback path (above) silently picked "monthly".

3. **Frontend display** — `TASK_TO_MASTER_RECURRENCE` and
   `RECURRENCE_OPTIONS` were missing the `weekly` ↔ `Weekly` mapping.
   Existing weekly plans showed the per-row Recurrence dropdown as blank
   (`"—"`), and users had no way to pick Weekly from the dropdown.

## Fix

- Frontend `buildPlansPayload` now **always** sends `recurrence` and
  `target_day` read fresh from the master at save time. Stale row state
  can't infiltrate.
- Frontend `TASK_TO_MASTER_RECURRENCE` adds `weekly: "Weekly"`. Existing
  weekly plans now render with "Weekly" pre-selected in the per-row
  dropdown.
- Frontend `RECURRENCE_OPTIONS` adds `{ value: "Weekly", label: "Weekly" }`
  so the per-row dropdown can switch plans to Weekly.
- Backend `_create_plans` now rejects plan creation when both the
  override and the master's recurrence are empty — raises 400 with a
  clear "open Masters → Categories and set a recurrence" message
  instead of silently defaulting to monthly.

## Repairing an existing goal that has the bug

Goals created BEFORE this fix may have a `monthly target_day=1` plan
where the user expected `weekly target_day=1`. To repair without losing
data:

1. Open the Edit Goal modal for the affected goal.
2. For each subtask row whose Recurrence column shows "Monthly" (but
   should be Weekly), change the dropdown to **Weekly**.
3. The backend `update_plan_recurrence` endpoint:
   - Sets the plan's recurrence to `"weekly"`.
   - Deletes every uncompleted child of that plan from the current
     month forward.
   - Re-materialises children on the new weekly cadence.
4. Completed children (history) are preserved as-is.

For Weekly with `target_day=1`, the plan now emits every Monday inside
the goal's engagement window — May 4, 11, 18, 25, 2026 (and so on for
each subsequent month).

If a goal has too many bad rows to fix by hand, the simplest path is
to delete the goal and recreate it. The masters keep their current
config; only the goal-scoped plans need to be replayed.

## Tests added

- `CreateGoalWithWeeklyPlansTests` in `core/tasks/tests.py`:
  - `test_plans_from_weekly_master_create_weekly_plans_with_monday_children`
  - `test_plans_inherit_recurrence_from_master_when_override_omitted`
  - `test_plan_create_rejects_master_with_empty_recurrence`
  - `test_per_plan_recurrence_override_wins_over_master`
