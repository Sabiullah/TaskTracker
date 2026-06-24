# Free-Entry Recurring Subtasks — Design

**Date:** 2026-06-24
**Status:** Approved design, pending implementation plan
**Branch:** `Task_addition`

## Problem

In the "Add New Task" modal, subtasks can only be saved when they map to a
sub-category **master** under the chosen main category. A row with no category
("-") is a *free entry* (e.g. "Vehicle Log verification", "Payroll"). Today such
a row is **silently dropped** on save: `buildPlansPayload` skips any row without
a resolvable `subcategoryUid` ([TaskModal.tsx:848](../../../frontend/task-tracker/src/components/board/TaskModal.tsx)),
and the backend `create()` only ever processes the `plans` array, ignoring rows
that have no master ([serializers.py:619](../../../core/tasks/serializers.py)).

### Desired behaviour

1. Subtask **category is not mandatory** when adding subtasks during main-task
   creation.
2. If a subtask is assigned against a sub-category in the master (under the
   selected main category), it behaves as today (template-driven recurrence).
3. Otherwise the user gets a **free entry** (free-text description + a chosen
   recurrence) and it **saves successfully**.
4. **Decision (confirmed):** free-entry subtasks **recur like master-backed
   rows** — same lazy month materialization, recurrence editing, owner cascade,
   and capping.

## Why this is an engine change, not a validation tweak

The recurrence engine in [services.py](../../../core/tasks/services.py) links
every child `Task` to its `TaskSubcategoryPlan` by matching
`child.category_id == plan.subcategory_id`. That single assumption drives:

- child creation + description (`plan.subcategory.name`),
- per-month dedupe (`plans_touched_this_month` keyed on `subcategory_id`),
- the `uniq_child_per_plan_slot` DB constraint (`(parent, category, target_date)`),
- owner cascade, recurrence edits, and plan capping (all filter
  `category_id=plan.subcategory_id`),
- the **frontend** child→plan join (`planByCat.set(String(p.subcategory))`,
  looked up by `dto.category`) in [TaskModal.tsx](../../../frontend/task-tracker/src/components/board/TaskModal.tsx).

The model also declares `subcategory` as a non-null `PROTECT` FK with
`unique_together(main_task, subcategory)` ([models.py:274-300](../../../core/tasks/models.py)).

A free-entry row has no master, so it has nothing to key on. Giving it parity
means giving a plan an **identity that is not a master**, and re-keying the
engine on that identity.

## Chosen approach: First-class free-entry plans (Approach A)

Introduce a stable, master-independent identity for plans and their children:
a direct **`plan` FK on the child `Task`**. Re-key the engine on `plan_id`
instead of `category_id == subcategory_id`. This makes free and master-backed
plans structurally identical everywhere downstream.

### Data model changes (`core/tasks/models.py`)

1. `TaskSubcategoryPlan.subcategory` → `null=True, blank=True` (keep
   `on_delete=PROTECT`, `limit_choices_to`). NULL means a free-entry plan.
2. Add `TaskSubcategoryPlan.description = models.TextField(blank=True, default="")`
   — the free-text name. For master plans it stays blank (name comes from the
   master); for free plans it carries the row's description.
3. Drop `unique_together(main_task, subcategory)` (NULL subcategories must be
   allowed to repeat). Replace with a **partial** unique constraint that still
   prevents duplicate *master* plans on a goal:
   `UniqueConstraint(fields=["main_task", "subcategory"],
   condition=Q(subcategory__isnull=False), name="uniq_master_plan_per_goal")`.
4. Add `Task.plan = models.ForeignKey(TaskSubcategoryPlan, null=True,
   blank=True, on_delete=models.SET_NULL, related_name="children")`.
   This is the canonical child→plan link. **`SET_NULL`, not `CASCADE`**:
   capping/recurrence-change delete only *open future* children explicitly and
   preserve completed ones as history before they may `plan.delete()`. A
   cascade would destroy that preserved history, so surviving children are
   instead orphaned from the plan (plan→NULL), exactly like a legacy manual
   row. (Corrected during implementation — `CASCADE` broke
   `test_cascade_when_plan_missing_still_updates_child`.)
5. Add a new child-dedupe constraint keyed on the plan:
   `UniqueConstraint(fields=["parent", "plan", "target_date"],
   condition=Q(parent__isnull=False, plan__isnull=False,
   target_date__isnull=False), name="uniq_child_per_plan_fk_slot")`.
   Keep the existing `uniq_child_per_plan_slot` for legacy plan-less rows.

### Migration (data)

- Schema migration for the fields/constraints above.
- Data migration: for every existing child `Task` (parent + category set),
  set `child.plan` = the `TaskSubcategoryPlan` matching `(parent, category)`.
  Children with no matching plan keep `plan=NULL` (legacy/manual rows —
  unchanged behaviour). Idempotent; safe to re-run.
- **Postgres caveat (per project memory):** verify the migration on real
  Postgres, not just SQLite — partial unique constraints and the backfill
  `UPDATE ... FROM` join must be checked there before deploy.

### Engine changes (`core/tasks/services.py`)

Re-key everything on `plan_id`; derive description/category from the plan:

- `materialize_month`: iterate `main.sub_plans`, create each child with
  `plan=plan`, `category=plan.subcategory` (may be None),
  `description = plan.subcategory.name if plan.subcategory_id else plan.description`,
  `responsible=plan.default_owner`. Dedupe via `plans_touched_this_month`
  keyed on **`plan_id`** (read from `child.plan_id`). The name-based fallback
  dedupe is no longer needed once children carry `plan_id` — keep a guard only
  for legacy plan-less children.
- `_existing_children_in_month`: select `plan` instead of `category` for the
  touched-set computation.
- `_plan_for_child`: return `child.plan` directly (drop the
  `(main_task, category)` lookup; keep it as a fallback only for legacy
  plan-less children).
- `cascade_owner_forward`, `update_plan_recurrence`, `cap_plan`: filter the
  affected children by `plan_id=plan.pk` instead of
  `category_id=plan.subcategory_id`.
- `add_or_extend_plan`: unchanged for master plans; not used by the free-entry
  create path (free plans are created inline in the serializer like master
  plans are today).

### Serializer changes (`core/tasks/serializers.py`)

- `TaskSubcategoryPlanSerializer`:
  - `subcategory` → `required=False, allow_null=True`.
  - Add `description` (writable, optional).
  - `validate`: require **either** a `subcategory` **or** a non-blank
    `description`. A free plan must still have a `recurrence` (explicit, or the
    existing "empty recurrence is rejected" rule applies — free plans have no
    master to fall back to, so recurrence is mandatory for them).
- `TaskSerializer`: expose read-only `plan_uid` on child rows
  (`source="plan.uid"`) so the frontend can join child→plan without relying on
  category.
- `_create_plans`: handle free rows — when `subcategory` is None, use the
  row's `description`, `recurrence`, `target_day`, and set
  `active_from_month = first-of-month(row target month)` (sent by the client),
  `active_until_month = main.engagement_end`. Dedupe free plans by
  casefolded description (mirrors the existing master dedupe by pk/name).
- `materialize_month` is still called once after plan creation (start month),
  unchanged.

### Frontend changes

- **Types** ([types/api/task.ts](../../../frontend/task-tracker/src/types/api/task.ts)):
  add `description: string` and make `subcategory: Uid | null` on
  `TaskSubcategoryPlanDto`; add `plan_uid: Uid | null` to the child `TaskDto`.
- **`buildPlansPayload`** ([TaskModal.tsx](../../../frontend/task-tracker/src/components/board/TaskModal.tsx)):
  stop skipping rows with no `subcategoryUid`. For such a row, if it has a
  non-blank `description`, emit a **free plan** entry:
  `{ subcategory_uid: null, description, recurrence: row.recurrence,
  target_day: <day-of-month or ISO-weekday derived from row.targetDate>,
  default_owner_uid, active_from_month: first-of-month(row.targetDate) }`.
  Require `recurrence` + `targetDate` on free rows (Target is already `*`).
  Default a free row's recurrence to "Monthly" if the user leaves it blank.
  Dedupe free entries by casefolded description.
- **Child→plan join** (month load, recurrence-change refresh, add-plan):
  prefer `dto.plan_uid` to link a row to its plan; fall back to the
  category-based `planByCat` map for legacy rows. Plan recurrence/uid keyed by
  `plan_uid` rather than `subcategory`.
- **`useTasks.saveGoalTree` / DTO mapping**: pass `description`,
  `active_from_month`, nullable `subcategory` through in the `plans` payload.
- No new buttons/columns. The existing Category dropdown left at "-" *is* the
  free-entry affordance; the existing Description + Recurrence + Target fields
  drive the free plan.

### Frontend validation

- Remove any implicit requirement that a subtask resolve to a master. Keep the
  **main goal** category mandatory on create ([TaskModal.tsx:884](../../../frontend/task-tracker/src/components/board/TaskModal.tsx)) —
  unchanged; this is the goal-level category, not the subtask's.
- A free row is valid when it has a description, a recurrence, and a target
  date. Show a clear inline error if a free row is missing recurrence/target.

## Error handling

- Backend rejects a free plan with no recurrence and no description with a
  clear `plans` validation message (reusing the existing pattern).
- The `uniq_child_per_plan_fk_slot` constraint + `_save_child_guarded`'s
  `IntegrityError` swallow protect against the materialization race for free
  plans exactly as the existing constraint does for master plans.
- The "Failed to fetch" seen in prod is a network-level error, not a 400;
  it is out of scope for this design but should disappear once free rows stop
  producing an empty/invalid payload. If it persists, debug separately.

## Testing

- **Engine unit tests** (`core/tasks/tests.py`): free plan materializes monthly
  / weekly children across the engagement window; dedupe by `plan_id`; owner
  cascade, recurrence change, and capping all operate on free plans via
  `plan_id`.
- **Migration test** (`core/tasks/tests_migrations.py`): existing children
  backfill their `plan` FK correctly; plan-less legacy rows stay NULL.
- **Serializer/API tests**: create a goal mixing master-backed and free
  subtasks; assert both persist, free plan has null subcategory + description,
  children carry `plan_uid`; retrieve `?month=` returns both with correct
  recurrence; free plan recurrence edit + cap via the `plans` action work.
- **Frontend**: `buildPlansPayload` emits free entries; child→plan join uses
  `plan_uid`; round-trip of a free row's recurrence override.
- Run `uv run pre-commit run --all-files` before pushing (per project memory) —
  covers ruff/format/mypy/pyright/eslint/tsc/build, which tests alone miss.
- Verify migration against real Postgres before deploy (per project memory).

## Out of scope

- Auto-creating master sub-categories from free text (explicitly rejected).
- Changing the goal-level (main) category requirement.
- Reworking the legacy `subtasks`-array create path beyond what parity needs.
