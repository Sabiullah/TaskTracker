# Completing a recurring goal stops it and discards future subtasks

**Date:** 2026-06-28
**Status:** Approved

## Problem

A recurring main goal (e.g. Monthly, 12 months) materializes a child subtask
for every month in its engagement window (`materialize_engagement`). Children
in months that haven't arrived yet are open *by design*. When the user wants to
stop working a goal early and mark the main complete, the completion guard in
`Task.clean()` counts **all** open subtasks regardless of month, so it lists
every future-month child as "open" (goal #1218 surfaced ~130) and the goal can
never be saved as complete.

The user's intent: a recurring goal should be completable at any time. Work that
was due by the completion date must be finished first; everything scheduled
after it should be dropped and the recurrence should stop.

## Behavior rules

When a main goal is saved with a completed status (`completed` /
`completed_delay`, i.e. `completed_date` is set):

1. **Completion gate.** Block the save only if an *open* subtask is due on or
   before the completion date: `target_date <= completed_date`, or the subtask
   has no `target_date` (can't prove it's future, so it blocks). The error names
   the blocking subtasks. Open subs dated strictly after the completion date
   never block.
   - Threshold = `completed_date`, falling back to `target_date` if for some
     reason `completed_date` is unset while status is completed.

2. **Discard future (permanent delete).** Permanently delete every *open*
   subtask whose `target_date > completed_date`. Completed subtasks (any with a
   `completed_date`) are always preserved as history, even if dated after the
   completion date.

3. **Stop recurrence permanently.** Cap every plan's `active_until_month` and the
   goal's `engagement_end` to the completion month, and make materialization a
   no-op while the goal is in a completed status, so no re-rendered month can
   resurrect a discarded sub or generate new months.

## Implementation

| Piece | Change |
|---|---|
| **Gate** — `Task.clean()` (`core/tasks/models.py`) | Threshold becomes `completed_date or target_date`. Block open subs with `target_date <= threshold` OR null `target_date`. Replaces the prior `target_date`-based future exemption. |
| **Service** — `cap_completed_goal(main)` (`core/tasks/services.py`) | Delete open children where `target_date > completed_date`; set each plan's `active_until_month` and `main.engagement_end` to `first_of_month(completed_date)` (never extend forward). Returns deleted child uids for live broadcast. Reuses the preserve-completed / cap pattern of `cap_plan`. |
| **Materialize guard** — `materialize_engagement` / `materialize_month` | Return `[]` when `main.status` is in `COMPLETED_STATUSES`. |
| **Hook** — `TaskSerializer.save` (inline-patch) and `MainTaskSerializer.update` (modal) | After the main saves and validates, if it is a parent now in a completed status, call `cap_completed_goal(main)` inside the existing atomic block. |

## Testing

- **Gate**
  - Open sub due before completion date → 400, names the sub.
  - Open sub due exactly on the completion date → 400 (must be completed first).
  - All on/before-completion subs done, a future-dated sub still open → 200.
- **`cap_completed_goal`**
  - Open children dated after `completed_date` are deleted.
  - Completed children dated after `completed_date` are preserved.
  - Each plan's `active_until_month` and `main.engagement_end` are capped to the
    completion month.
  - After completion, re-running `materialize_engagement` creates nothing.
- Existing `MainCompletionGuardTests` continue to pass under the new threshold.

## Consequence

Completion is one-way: if the goal is later re-opened (completion date cleared),
the discarded subtasks are gone and the capped window is not auto-restored. This
is the accepted behavior for "stop permanently."
