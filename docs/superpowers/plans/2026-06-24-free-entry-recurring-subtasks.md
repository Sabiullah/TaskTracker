# Free-Entry Recurring Subtasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users add subtasks with no category master during goal creation and have those free-entry rows persist and recur exactly like master-backed subtasks.

**Architecture:** Give each `TaskSubcategoryPlan` a master-independent identity by adding a direct `plan` FK on the child `Task`, re-keying the recurrence engine on `plan_id` instead of `category_id == subcategory_id`. Make `TaskSubcategoryPlan.subcategory` nullable and add `plan.description` to carry the free text. The frontend stops dropping master-less rows and joins children to plans via a new `plan_uid`.

**Tech Stack:** Django 5 / DRF (Python, `uv`), SQLite in CI / Postgres in prod, React + TypeScript (Vite), pytest, pre-commit (ruff/format/mypy/pyright/eslint/tsc).

**Spec:** `docs/superpowers/specs/2026-06-24-free-entry-recurring-subtasks-design.md`

---

## File Structure

**Backend (`core/tasks/`)**
- `models.py` — `Task.plan` FK; `TaskSubcategoryPlan.subcategory` nullable + `description` field; constraint swaps.
- `migrations/0016_free_entry_plans.py` — schema (new field/FK, constraint changes).
- `migrations/0017_backfill_child_plan_fk.py` — data migration backfilling `Task.plan`.
- `services.py` — re-key materialize/cascade/recurrence-update/cap on `plan_id`; description from plan.
- `serializers.py` — nullable subcategory + `description` on plan serializer; `plan_uid` on `TaskSerializer`; free-plan branch in `_create_plans`.
- `tests.py`, `tests_migrations.py` — engine, serializer/API, migration tests.

**Frontend (`frontend/task-tracker/src/`)**
- `types/api/task.ts` — `plan_uid` on child DTO; nullable `subcategory` + `description` on plan DTO; free-plan shape in `TaskWithPlansCreate`.
- `types/task.ts` — (no change needed; `SubtaskItem` already has `planUid`, `recurrence`, `subcategoryUid`).
- `components/board/TaskModal.tsx` — `buildPlansPayload` emits free entries; child→plan join prefers `plan_uid`.
- `hooks/useTasks.ts` — thread `description` / `subcategory: null` / `active_from_month` through the plans payload.

Each task below is self-contained and ends at a green test + commit.

---

## Task 1: Add `plan.description` + nullable `subcategory` to the model

**Files:**
- Modify: `core/tasks/models.py:274-302`
- Test: `core/tasks/tests.py`

- [ ] **Step 1: Write the failing test**

Add to `core/tasks/tests.py` (top-level, near other model tests):

```python
@pytest.mark.django_db
def test_plan_allows_null_subcategory_with_description():
    from core.tasks.models import Task, TaskSubcategoryPlan

    main = Task.objects.create(description="Goal", target_date=None)
    plan = TaskSubcategoryPlan.objects.create(
        main_task=main,
        subcategory=None,
        description="Payroll",
        recurrence="monthly",
        target_day=5,
        active_from_month=dt.date(2026, 7, 1),
    )
    assert plan.subcategory_id is None
    assert plan.description == "Payroll"
```

Ensure `import datetime as dt` and `import pytest` exist at the top of the file (they do — match the existing style).

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest core/tasks/tests.py::test_plan_allows_null_subcategory_with_description -v`
Expected: FAIL — `IntegrityError`/`NOT NULL constraint` on `subcategory`, or `TypeError` for unknown `description` kwarg.

- [ ] **Step 3: Edit the model**

In `core/tasks/models.py`, change the `subcategory` field (currently lines 274-279) and add `description` right after it:

```python
    subcategory = models.ForeignKey(
        "masters.Master",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        limit_choices_to={"type": "category"},
        related_name="plans",
    )
    # Free-entry plans have no master sub-category — this holds the
    # user-typed name that drives the materialised children's description.
    # Blank for master-backed plans (their name comes from the master).
    description = models.TextField(blank=True, default="")
```

Replace the `Meta` block (currently lines 298-302) with:

```python
    class Meta:
        ordering = ["main_task_id", "subcategory_id"]
        verbose_name = "task subcategory plan"
        verbose_name_plural = "task subcategory plans"
        constraints = [
            # A goal may hold at most one plan per MASTER sub-category.
            # Free-entry plans (subcategory IS NULL) are exempt so a goal
            # can carry several of them.
            models.UniqueConstraint(
                fields=["main_task", "subcategory"],
                condition=models.Q(subcategory__isnull=False),
                name="uniq_master_plan_per_goal",
            ),
        ]
```

(The old `unique_together = [("main_task", "subcategory")]` is removed — the partial constraint replaces it.)

- [ ] **Step 4: Make and apply the schema migration**

Run: `uv run python manage.py makemigrations tasks --name free_entry_plans`
Expected: a new `core/tasks/migrations/0016_free_entry_plans.py` altering `subcategory`, adding `description`, removing `unique_together`, adding `uniq_master_plan_per_goal`.

Then: `uv run python manage.py migrate tasks`
Expected: applies cleanly.

- [ ] **Step 5: Run test to verify it passes**

Run: `uv run pytest core/tasks/tests.py::test_plan_allows_null_subcategory_with_description -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add core/tasks/models.py core/tasks/migrations/0016_free_entry_plans.py core/tasks/tests.py
git commit -m "feat(tasks): allow free-entry plans (nullable subcategory + description)"
```

---

## Task 2: Add the `Task.plan` FK + plan-keyed child constraint

**Files:**
- Modify: `core/tasks/models.py:103-133` (Task fields + Meta constraints)
- Test: `core/tasks/tests.py`

- [ ] **Step 1: Write the failing test**

```python
@pytest.mark.django_db
def test_child_task_links_to_plan_fk():
    from core.tasks.models import Task, TaskSubcategoryPlan

    main = Task.objects.create(description="Goal")
    plan = TaskSubcategoryPlan.objects.create(
        main_task=main, subcategory=None, description="Payroll",
        recurrence="monthly", target_day=5, active_from_month=dt.date(2026, 7, 1),
    )
    child = Task.objects.create(
        parent=main, plan=plan, description="Payroll", target_date=dt.date(2026, 7, 5),
    )
    assert child.plan_id == plan.pk
    assert list(plan.children.all()) == [child]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest core/tasks/tests.py::test_child_task_links_to_plan_fk -v`
Expected: FAIL — `TypeError`/`FieldError` for unknown `plan` kwarg.

- [ ] **Step 3: Edit the Task model**

In `core/tasks/models.py`, add to the implicit-id hints block (after line 16, near `sub_plans`):

```python
    plan_id: int | None
```

Add the FK field after the `parent` field (after line 110):

```python
    # Canonical link from a materialised child to the plan that produced it.
    # Replaces the old "(parent, category)" matching so free-entry plans
    # (whose children have category=NULL) can still be tracked. NULL for
    # legacy/manual children that predate plans.
    plan = models.ForeignKey(
        "TaskSubcategoryPlan",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="children",
        db_index=True,
    )
```

Add a second constraint to `Task.Meta.constraints` (the list currently at lines 116-133) — append after the existing `uniq_child_per_plan_slot`:

```python
            # Plan-keyed dedupe slot — the free-entry analogue of
            # uniq_child_per_plan_slot, which only covers rows with a
            # non-null category. Guarantees one child per (goal, plan, date)
            # so the materialise race can't double-emit free-entry rows.
            models.UniqueConstraint(
                fields=["parent", "plan", "target_date"],
                condition=models.Q(
                    parent__isnull=False,
                    plan__isnull=False,
                    target_date__isnull=False,
                ),
                name="uniq_child_per_plan_fk_slot",
            ),
```

- [ ] **Step 4: Make and apply the migration**

Run: `uv run python manage.py makemigrations tasks --name add_child_plan_fk`
Expected: `0017_add_child_plan_fk.py` adding the `plan` FK + `uniq_child_per_plan_fk_slot`.

Then: `uv run python manage.py migrate tasks`

- [ ] **Step 5: Run test to verify it passes**

Run: `uv run pytest core/tasks/tests.py::test_child_task_links_to_plan_fk -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add core/tasks/models.py core/tasks/migrations/0017_add_child_plan_fk.py core/tasks/tests.py
git commit -m "feat(tasks): add Task.plan FK + plan-keyed child dedupe constraint"
```

---

## Task 3: Data migration — backfill `Task.plan` on existing children

**Files:**
- Create: `core/tasks/migrations/0018_backfill_child_plan_fk.py`
- Test: `core/tasks/tests_migrations.py`

- [ ] **Step 1: Write the failing test**

Add to `core/tasks/tests_migrations.py` (follow the existing `migrator`/`django_assert` style already used in that file; the snippet below uses `django-test-migrations`' `Migrator` which the file already imports — match whatever harness is present):

```python
@pytest.mark.django_db
def test_backfill_links_children_to_matching_plan(migrator):
    old = migrator.apply_initial_migration(("tasks", "0017_add_child_plan_fk"))
    Task = old.apps.get_model("tasks", "Task")
    Plan = old.apps.get_model("tasks", "TaskSubcategoryPlan")
    Master = old.apps.get_model("masters", "Master")

    cat = Master.objects.create(type="category", name="Payroll")
    main = Task.objects.create(description="Goal")
    plan = Plan.objects.create(
        main_task=main, subcategory=cat, recurrence="monthly",
        target_day=5, active_from_month=dt.date(2026, 7, 1),
    )
    child = Task.objects.create(
        parent=main, category=cat, description="Payroll",
        target_date=dt.date(2026, 7, 5),
    )
    orphan = Task.objects.create(
        parent=main, category=None, description="Manual one-off",
        target_date=dt.date(2026, 7, 9),
    )

    new = migrator.apply_tested_migration(("tasks", "0018_backfill_child_plan_fk"))
    Task2 = new.apps.get_model("tasks", "Task")
    assert Task2.objects.get(pk=child.pk).plan_id == plan.pk
    assert Task2.objects.get(pk=orphan.pk).plan_id is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest core/tasks/tests_migrations.py::test_backfill_links_children_to_matching_plan -v`
Expected: FAIL — migration `0018_backfill_child_plan_fk` does not exist.

- [ ] **Step 3: Write the data migration**

Create `core/tasks/migrations/0018_backfill_child_plan_fk.py`:

```python
from django.db import migrations


def backfill(apps, schema_editor):
    Task = apps.get_model("tasks", "Task")
    Plan = apps.get_model("tasks", "TaskSubcategoryPlan")

    # Map (main_task_id, subcategory_id) -> plan_id for master-backed plans.
    plan_by_key = {
        (p.main_task_id, p.subcategory_id): p.pk
        for p in Plan.objects.filter(subcategory__isnull=False).iterator()
    }
    # Children link to their plan via (parent_id, category_id). Rows whose
    # pair has no plan (manual/legacy one-offs) stay plan=NULL.
    for child in Task.objects.filter(
        parent__isnull=False, category__isnull=False, plan__isnull=True
    ).iterator():
        plan_id = plan_by_key.get((child.parent_id, child.category_id))
        if plan_id is not None:
            Task.objects.filter(pk=child.pk).update(plan_id=plan_id)


def noop_reverse(apps, schema_editor):
    Task = apps.get_model("tasks", "Task")
    Task.objects.filter(plan__isnull=False).update(plan=None)


class Migration(migrations.Migration):
    dependencies = [("tasks", "0017_add_child_plan_fk")]
    operations = [migrations.RunPython(backfill, noop_reverse)]
```

- [ ] **Step 4: Apply and run the test**

Run: `uv run python manage.py migrate tasks`
Then: `uv run pytest core/tasks/tests_migrations.py::test_backfill_links_children_to_matching_plan -v`
Expected: PASS

- [ ] **Step 5: Verify on Postgres (project memory: CI is SQLite, prod is Postgres)**

Spin up the project's Postgres locally (compose/`.env` per repo) and run
`uv run python manage.py migrate tasks` against it. Confirm both new
migrations + the backfill apply with no error. Document the result in the
commit body.

- [ ] **Step 6: Commit**

```bash
git add core/tasks/migrations/0018_backfill_child_plan_fk.py core/tasks/tests_migrations.py
git commit -m "feat(tasks): backfill Task.plan FK for existing children (verified on Postgres)"
```

---

## Task 4: Re-key `materialize_month` on `plan_id`

**Files:**
- Modify: `core/tasks/services.py:147-269`
- Test: `core/tasks/tests.py`

- [ ] **Step 1: Write the failing test**

```python
@pytest.mark.django_db
def test_materialize_free_plan_creates_children_with_plan_and_description():
    from core.tasks.models import Task, TaskSubcategoryPlan
    from core.tasks.services import materialize_month

    main = Task.objects.create(
        description="Goal", target_date=dt.date(2026, 12, 31),
        engagement_start=dt.date(2026, 7, 1), engagement_end=dt.date(2026, 9, 1),
    )
    plan = TaskSubcategoryPlan.objects.create(
        main_task=main, subcategory=None, description="Payroll",
        recurrence="monthly", target_day=5, active_from_month=dt.date(2026, 7, 1),
        active_until_month=dt.date(2026, 9, 1),
    )
    created = materialize_month(main, dt.date(2026, 7, 1))
    assert len(created) == 1
    child = created[0]
    assert child.plan_id == plan.pk
    assert child.category_id is None
    assert child.description == "Payroll"
    assert child.target_date == dt.date(2026, 7, 5)
    # Idempotent: second run emits nothing (deduped by plan_id).
    assert materialize_month(main, dt.date(2026, 7, 1)) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest core/tasks/tests.py::test_materialize_free_plan_creates_children_with_plan_and_description -v`
Expected: FAIL — child has `description == plan.subcategory.name` lookup which raises (subcategory is None) or dedupe keyed on `subcategory_id` mis-handles None.

- [ ] **Step 3: Edit `materialize_month` and `_existing_children_in_month`**

In `core/tasks/services.py`, change `_existing_children_in_month` (lines 147-157) to select `plan` instead of `category`:

```python
def _existing_children_in_month(main: Task, month_start: dt.date, month_end: dt.date) -> list[Task]:
    """Children already materialised for this (goal, month). Extracted as a
    seam so the dedupe read is a single, mockable point — the race that
    spawns duplicates is precisely a stale result from this read."""
    return list(
        Task.objects.filter(
            parent=main,
            target_date__gte=month_start,
            target_date__lt=month_end,
        ).select_related("plan", "category")
    )
```

Replace the body of `materialize_month` from the `existing_in_month` block through the child-creation loop (lines 217-269) with a `plan_id`-keyed version:

```python
    month_end = _add_months(month_start, 1)
    existing_in_month = _existing_children_in_month(main, month_start, month_end)
    # Primary dedupe key: the plan FK. Free-entry plans (category=NULL) are
    # tracked the same as master-backed ones. A plan with ANY child this
    # month is user-managed — leave the month alone.
    plans_touched_this_month: set[int] = {
        s.plan_id for s in existing_in_month if s.plan_id is not None
    }
    # Legacy name guard, MASTER plans only: two same-named master sub-cats
    # under one goal must not both emit a row this month. Kept because the
    # plan_id key can't see that A and B are "the same" to the user. Free
    # plans are excluded — their identity IS the plan, not the name.
    names_touched_this_month: set[str] = {
        (s.category.name or "").strip().casefold()
        for s in existing_in_month
        if s.category_id is not None and s.category and (s.category.name or "").strip()
    }

    ceiling = main.target_date

    for plan in plans:
        if plan.pk in plans_touched_this_month:
            continue
        plan_name_key = (
            (plan.subcategory.name or "").strip().casefold() if plan.subcategory_id else ""
        )
        if plan_name_key and plan_name_key in names_touched_this_month:
            continue
        description = plan.subcategory.name if plan.subcategory_id else plan.description
        for target_date in _target_dates_in_month(plan, month_start):
            if ceiling and target_date > ceiling:
                continue
            child = Task(
                parent=main,
                plan=plan,
                org=main.org,
                client=main.client,
                reporting_manager=main.reporting_manager,
                recurrence=main.recurrence,
                description=description,
                category=plan.subcategory,
                responsible=plan.default_owner,
                target_date=target_date,
                status="pending",
            )
            if _save_child_guarded(child):
                created.append(child)
        plans_touched_this_month.add(plan.pk)
        if plan_name_key:
            names_touched_this_month.add(plan_name_key)

    return created
```

Also confirm the `plans` queryset prefetch a few lines up (line 196) keeps `subcategory` selected (still needed for master names — leave it as-is):

```python
    plans = list(main.sub_plans.select_related("subcategory", "default_owner").all())
```

(The `_existing_children_in_month` change in Step 3 must `select_related("plan", "category")` so both the `plan_id` and name guards read without extra queries — update that snippet's `.select_related(...)` to `("plan", "category")`.)

- [ ] **Step 4: Run the test + the existing engine suite**

Run: `uv run pytest core/tasks/tests.py -k "materialize" -v`
Expected: the new test PASSES and existing materialize tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add core/tasks/services.py core/tasks/tests.py
git commit -m "feat(tasks): materialize children keyed on plan FK (supports free plans)"
```

---

## Task 5: Re-key `_plan_for_child`, owner cascade, recurrence update, capping on `plan_id`

**Files:**
- Modify: `core/tasks/services.py:272-322` (`_plan_for_child`, `cascade_owner_forward`), `:417-532` (`update_plan_recurrence`, `cap_plan`)
- Test: `core/tasks/tests.py`

- [ ] **Step 1: Write the failing test**

```python
@pytest.mark.django_db
def test_free_plan_recurrence_update_and_cap_use_plan_fk():
    from core.tasks.models import Task, TaskSubcategoryPlan
    from core.tasks.services import (
        materialize_engagement, update_plan_recurrence, cap_plan,
    )

    main = Task.objects.create(
        description="Goal", target_date=dt.date(2027, 6, 30),
        engagement_start=dt.date(2026, 7, 1), engagement_end=dt.date(2026, 10, 1),
    )
    plan = TaskSubcategoryPlan.objects.create(
        main_task=main, subcategory=None, description="Payroll",
        recurrence="monthly", target_day=5, active_from_month=dt.date(2026, 7, 1),
        active_until_month=dt.date(2026, 10, 1),
    )
    materialize_engagement(main)
    # Cap from September → August onward kept, Sep/Oct open children deleted.
    result = cap_plan(plan, dt.date(2026, 9, 1))
    assert result["children_deleted"] >= 1
    remaining = Task.objects.filter(plan=plan).count()
    assert remaining == 2  # Jul + Aug
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest core/tasks/tests.py::test_free_plan_recurrence_update_and_cap_use_plan_fk -v`
Expected: FAIL — `cap_plan` filters children by `category_id=plan.subcategory_id` (None) so it deletes/keeps the wrong set.

- [ ] **Step 3: Edit the three functions to filter by `plan_id`**

In `core/tasks/services.py`:

`_plan_for_child` (lines 272-279) — return the FK directly, fall back for legacy:

```python
def _plan_for_child(child: Task) -> TaskSubcategoryPlan | None:
    """Find the plan that produced this child Task. Prefer the direct FK;
    fall back to (main_task, subcategory) for legacy rows that predate it."""
    if child.plan_id is not None:
        return child.plan
    if child.parent_id is None or child.category_id is None:
        return None
    return TaskSubcategoryPlan.objects.filter(
        main_task_id=child.parent_id,
        subcategory_id=child.category_id,
    ).first()
```

`cascade_owner_forward` (line 313-317) — change the affected-children filter:

```python
    affected_qs = Task.objects.filter(
        plan_id=plan.pk,
        target_date__gt=child.target_date,
    )
```

`update_plan_recurrence` (lines 453-458) — change the to-delete filter:

```python
    to_delete_qs = Task.objects.filter(
        plan_id=plan.pk,
        target_date__gte=from_month,
        completed_date__isnull=True,
    )
```

`cap_plan` — both to-delete filters (lines 490-495 and 519-524):

```python
        to_delete_qs = Task.objects.filter(
            plan_id=plan.pk,
            target_date__gte=from_month,
            completed_date__isnull=True,
        )
```

(Apply the identical replacement to both occurrences in `cap_plan`.)

- [ ] **Step 4: Run the engine suite**

Run: `uv run pytest core/tasks/tests.py -k "plan or cascade or cap or recurrence" -v`
Expected: new test PASSES; existing master-plan cascade/cap/recurrence tests still PASS (they now match by `plan_id`, which the backfill set for their children).

- [ ] **Step 5: Commit**

```bash
git add core/tasks/services.py core/tasks/tests.py
git commit -m "feat(tasks): key owner-cascade/recurrence/cap on plan FK"
```

---

## Task 6: Serializer — nullable subcategory + `description` + `plan_uid` + free-plan create

**Files:**
- Modify: `core/tasks/serializers.py:132-170` (`TaskSubcategoryPlanSerializer`), `:285-313` (`TaskSerializer.Meta.fields`), `:559-612` (`_create_plans`)
- Test: `core/tasks/tests.py`

- [ ] **Step 1: Write the failing test**

```python
@pytest.mark.django_db
def test_create_goal_with_free_entry_plan(api_client_admin):
    # api_client_admin: an authenticated manager/admin DRF client fixture
    # already used by other API tests in this file — reuse it.
    from masters.models import Master

    cat = Master.objects.create(type="category", name="Admin")  # main category
    payload = {
        "description": "June goal",
        "category": str(cat.uid),
        "reporting_manager": <manager_uid>,        # use the fixture's manager uid
        "engagement_start": "2026-07-01",
        "engagement_end": "2026-09-01",
        "plans": [
            {
                "subcategory": None,
                "description": "Payroll",
                "recurrence": "Monthly",
                "target_day": 5,
                "active_from_month": "2026-07-01",
            }
        ],
    }
    resp = api_client_admin.post("/api/tasks/", payload, format="json")
    assert resp.status_code == 201, resp.content

    from core.tasks.models import Task, TaskSubcategoryPlan
    plan = TaskSubcategoryPlan.objects.get(description="Payroll")
    assert plan.subcategory_id is None
    assert plan.recurrence == "monthly"
    child = Task.objects.get(plan=plan)
    assert child.description == "Payroll"
    assert child.target_date == dt.date(2026, 7, 5)
```

Replace `<manager_uid>` and the fixture name with whatever the existing API tests in `tests.py` use (search the file for an authenticated POST `/api/tasks/` test and copy its setup verbatim).

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest core/tasks/tests.py::test_create_goal_with_free_entry_plan -v`
Expected: FAIL — `subcategory` is required on the plan serializer (400), or `_create_plans` does `row["subcategory"]` and KeyErrors / rejects None.

- [ ] **Step 3: Edit `TaskSubcategoryPlanSerializer`**

In `core/tasks/serializers.py` (lines 132-170), make `subcategory` optional, add `description`, and add cross-field validation. Replace the field declarations + add `validate`:

```python
    subcategory = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Master.objects.filter(type="category"),
        required=False,
        allow_null=True,
    )
    subcategory_detail = MasterMinSerializer(source="subcategory", read_only=True)
    description = serializers.CharField(required=False, allow_blank=True)
```

Add `"description"` to the serializer's `Meta.fields` list (after `"subcategory_detail"`).

Add a `validate` method to the class:

```python
    def validate(self, attrs):
        sub = attrs.get("subcategory")
        desc = (attrs.get("description") or "").strip()
        if sub is None and not desc:
            raise serializers.ValidationError(
                "A plan needs either a sub-category or a description."
            )
        # Free-entry plans have no master to fall back to, so recurrence
        # is mandatory for them.
        if sub is None and not (attrs.get("recurrence") or "").strip():
            raise serializers.ValidationError(
                {"recurrence": "Recurrence is required for a free-entry subtask."}
            )
        return super().validate(attrs)
```

- [ ] **Step 4: Expose `plan_uid` on child rows**

In `TaskSerializer` (lines ~190-313), add a read-only field declaration near the other detail fields:

```python
    plan_uid = serializers.UUIDField(source="plan.uid", read_only=True, allow_null=True)
```

Add `"plan_uid"` to both `Meta.fields` and `Meta.read_only_fields`.

- [ ] **Step 5: Edit `_create_plans` to handle free rows**

In `core/tasks/serializers.py` `_create_plans` (lines 559-612), replace the loop body so it branches on a missing subcategory. Full replacement of the method body after the docstring:

```python
        seen_pks: set = set()
        seen_names: set[str] = set()
        seen_free: set[str] = set()
        for row in plan_rows:
            sub_cat = row.get("subcategory")
            if sub_cat is None:
                # Free-entry plan — keyed by its description.
                desc = (row.get("description") or "").strip()
                name_key = desc.casefold()
                if not desc or name_key in seen_free:
                    continue
                seen_free.add(name_key)
                raw_rec = row.get("recurrence")
                if not raw_rec:
                    raise serializers.ValidationError(
                        {"recurrence": "Recurrence is required for a free-entry subtask."}
                    )
                active_from = row.get("active_from_month") or _first_of_month_or_today(
                    main.engagement_start
                )
                TaskSubcategoryPlan.objects.create(
                    main_task=main,
                    subcategory=None,
                    description=desc,
                    recurrence=_normalize_recurrence(raw_rec),
                    target_day=row.get("target_day"),
                    default_owner=row.get("default_owner"),
                    active_from_month=active_from,
                    active_until_month=row.get("active_until_month") or main.engagement_end,
                )
                continue

            name_key = (sub_cat.name or "").strip().casefold()
            if sub_cat.pk in seen_pks or (name_key and name_key in seen_names):
                continue
            seen_pks.add(sub_cat.pk)
            if name_key:
                seen_names.add(name_key)
            raw_rec = row.get("recurrence") or sub_cat.recurrence
            if not raw_rec:
                raise serializers.ValidationError(
                    {
                        "plans": (
                            f"Sub-category {sub_cat.name!r} has no recurrence configured — "
                            f"open Masters → Categories and set one before creating this goal."
                        )
                    }
                )
            target_day = row.get("target_day")
            if target_day is None:
                target_day = sub_cat.target_day
            TaskSubcategoryPlan.objects.create(
                main_task=main,
                subcategory=sub_cat,
                recurrence=_normalize_recurrence(raw_rec),
                target_day=target_day,
                default_owner=row.get("default_owner"),
                active_from_month=row.get("active_from_month") or _first_of_month_or_today(main.engagement_start),
                active_until_month=row.get("active_until_month") or main.engagement_end,
            )
```

Confirm `_normalize_recurrence` and `_first_of_month_or_today` are already imported in this module (they are — they're used in the original method).

- [ ] **Step 6: Run the test + serializer suite**

Run: `uv run pytest core/tasks/tests.py -k "plan or subtask or create_goal" -v`
Expected: new test PASSES; existing master-plan create/retrieve tests still PASS.

- [ ] **Step 7: Commit**

```bash
git add core/tasks/serializers.py core/tasks/tests.py
git commit -m "feat(tasks): serializer support for free-entry plans + plan_uid on children"
```

---

## Task 7: Frontend types — `plan_uid`, nullable subcategory, free-plan create shape

**Files:**
- Modify: `frontend/task-tracker/src/types/api/task.ts:144-192`
- Test: type-check (`tsc`) — no runtime test for pure types.

- [ ] **Step 1: Edit the DTO + create types**

In `frontend/task-tracker/src/types/api/task.ts`:

Add `plan_uid` to the child task DTO (find `TaskDto` in this file and add):

```typescript
  readonly plan_uid: Uid | null;
```

Change `TaskSubcategoryPlanDto` (lines 144-154) so `subcategory` is nullable and add `description`:

```typescript
export interface TaskSubcategoryPlanDto {
  readonly uid: Uid;
  readonly subcategory: Uid | null;
  readonly subcategory_detail: MasterRefDto | null;
  readonly description: string;
  readonly recurrence: TaskRecurrenceValue;
  readonly target_day: number | null;
  readonly default_owner: Uid | null;
  readonly default_owner_detail: UserRefDto | null;
  readonly active_from_month: IsoDate;
  readonly active_until_month: IsoDate | null;
}
```

Change the `plans` element type in `TaskWithPlansCreate` (lines 180-191) to allow free entries:

```typescript
  readonly plans: ReadonlyArray<{
    readonly subcategory: Uid | null;
    readonly description?: string;
    readonly default_owner?: Uid;
    readonly recurrence?: string;
    readonly target_day?: number | null;
    readonly active_from_month?: IsoDate;
  }>;
```

- [ ] **Step 2: Type-check**

Run: `cd frontend/task-tracker && npx tsc --noEmit`
Expected: errors ONLY where `subcategory`/`plan_uid` are consumed (TaskModal join + useTasks payload) — those are fixed in Tasks 8-9. If there are unrelated errors, stop and reassess.

- [ ] **Step 3: Commit**

```bash
git add frontend/task-tracker/src/types/api/task.ts
git commit -m "feat(web): plan_uid + nullable subcategory + free-plan create types"
```

---

## Task 8: Frontend — `buildPlansPayload` emits free entries

**Files:**
- Modify: `frontend/task-tracker/src/components/board/TaskModal.tsx:819-868`
- Modify: `frontend/task-tracker/src/hooks/useTasks.ts:206-233`

- [ ] **Step 1: Extend the payload type + mapping in `useTasks.ts`**

In `frontend/task-tracker/src/hooks/useTasks.ts`, widen the `plansPayload` param type (lines 206-211) and the mapping (lines 226-231):

```typescript
      plansPayload?: Array<{
        subcategory_uid: string | null;
        description?: string;
        default_owner_uid: string | null;
        recurrence: MasterRecurrence;
        target_day: number | null;
        active_from_month?: string;
      }>,
```

```typescript
            plans: plansPayload.map((p) => ({
              subcategory: p.subcategory_uid,
              description: p.description,
              default_owner: p.default_owner_uid ?? undefined,
              recurrence: p.recurrence,
              target_day: p.target_day,
              active_from_month: p.active_from_month,
            })),
```

- [ ] **Step 2: Edit `buildPlansPayload` in `TaskModal.tsx`**

Replace `buildPlansPayload` (lines 819-868). Keep the master-backed branch identical, and add a free-entry branch for rows with no resolvable sub-cat but a description. Add a small helper for target_day before the function:

```typescript
  // Day-of-month (1-31) for cadenced recurrences, ISO weekday (1-7) for
  // weekly, derived from the row's target date. Mirrors the backend's
  // _target_dates_in_month semantics.
  const deriveTargetDay = (
    rec: MasterRecurrence,
    iso: string,
  ): number | null => {
    if (!iso) return null;
    const d = new Date(iso + "T00:00:00");
    if (Number.isNaN(d.getTime())) return null;
    if (rec === "Weekly") {
      const wd = d.getUTCDay(); // 0=Sun..6=Sat
      return wd === 0 ? 7 : wd; // ISO: Mon=1..Sun=7
    }
    return d.getUTCDate();
  };

  const buildPlansPayload = (rows: readonly SubtaskItem[]): Array<{
    subcategory_uid: string | null;
    description?: string;
    default_owner_uid: string | null;
    recurrence: MasterRecurrence;
    target_day: number | null;
    active_from_month?: string;
  }> => {
    const seen = new Set<string>();
    const seenFree = new Set<string>();
    const out: Array<{
      subcategory_uid: string | null;
      description?: string;
      default_owner_uid: string | null;
      recurrence: MasterRecurrence;
      target_day: number | null;
      active_from_month?: string;
    }> = [];
    for (const row of rows) {
      let subUid = row.subcategoryUid ? String(row.subcategoryUid) : null;
      if (!subUid && row.category) {
        const subCat = catMasters.find(
          (c) =>
            c.name === row.category &&
            c.parent &&
            (selectedMainUid ? String(c.parent) === selectedMainUid : true),
        );
        subUid = subCat ? String(subCat.id) : null;
      }

      if (!subUid) {
        // Free-entry row: no master. Persist it as a free plan driven by
        // the typed description + chosen recurrence + target date.
        const desc = row.description.trim();
        if (!desc) continue;
        const key = desc.toLowerCase();
        if (seenFree.has(key)) continue;
        seenFree.add(key);
        const recurrence = (row.recurrence || "Monthly") as MasterRecurrence;
        const owner = profiles.find((p) => p.full_name === row.responsible);
        const activeFrom = row.targetDate
          ? `${row.targetDate.slice(0, 7)}-01`
          : undefined;
        out.push({
          subcategory_uid: null,
          description: desc,
          default_owner_uid: owner ? String(owner.id) : null,
          recurrence,
          target_day: deriveTargetDay(recurrence, row.targetDate),
          active_from_month: activeFrom,
        });
        continue;
      }

      if (seen.has(subUid)) continue;
      seen.add(subUid);
      const subCat = catMasters.find((c) => String(c.id) === subUid);
      if (!subCat) continue;
      const owner = profiles.find((p) => p.full_name === row.responsible);
      out.push({
        subcategory_uid: subUid,
        default_owner_uid: owner ? String(owner.id) : null,
        recurrence: (subCat.recurrence ?? "") as MasterRecurrence,
        target_day: subCat.target_day ?? null,
      });
    }
    return out;
  };
```

- [ ] **Step 3: Add free-row validation in `handleSubmit`**

In `handleSubmit` (lines 870-922), after the existing `subsHaveErrors` check (line 892-895), add a guard so a free row without a target date is caught early:

```typescript
    if (isCreate) {
      const badFree = subs.find(
        (s) =>
          s.description.trim() &&
          !s.subcategoryUid &&
          !s.category &&
          !s.targetDate,
      );
      if (badFree) {
        alert(
          "Each free-entry subtask needs a Target date so its recurrence can start.",
        );
        return;
      }
    }
```

- [ ] **Step 4: Type-check + build**

Run: `cd frontend/task-tracker && npx tsc --noEmit`
Expected: PASS (no type errors).

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/components/board/TaskModal.tsx frontend/task-tracker/src/hooks/useTasks.ts
git commit -m "feat(web): send free-entry subtasks as free plans on goal create"
```

---

## Task 9: Frontend — join children to plans by `plan_uid`

**Files:**
- Modify: `frontend/task-tracker/src/components/board/TaskModal.tsx:90-109` (`dtoToTaskAsSub`), `:302-351` (month load), `:509-592` (recurrence-change refresh)

- [ ] **Step 1: Edit `dtoToTaskAsSub`**

Replace `dtoToTaskAsSub` (lines 90-109) so the plan can be looked up by uid and so the row carries `plan_uid` from the child DTO when no explicit plan is passed:

```typescript
function dtoToTaskAsSub(
  dto: TaskDto,
  plan?: { uid: string; recurrence: string },
): SubtaskItem {
  return {
    id: dto.uid,
    description: dto.description,
    category: dto.category_detail?.name ?? "",
    subcategoryUid: dto.category ? String(dto.category) : null,
    responsible: dto.responsible_detail?.full_name ?? "",
    targetDate: dto.target_date ?? "",
    expectedDate: dto.expected_date ?? "",
    completedDate: dto.completed_date ?? "",
    remarks: dto.remarks ?? "",
    planUid: plan?.uid ?? dto.plan_uid ?? null,
    recurrence: plan
      ? (TASK_TO_MASTER_RECURRENCE[plan.recurrence] ?? "")
      : (TASK_TO_MASTER_RECURRENCE[dto.recurrence] ?? ""),
  };
}
```

- [ ] **Step 2: Edit the month-load mapping (lines 302-351)**

Build the plan lookup keyed by **plan uid** and join on `dto.plan_uid`, falling back to the category map for legacy rows. Replace the `planByCat` construction + the `monthSubs` map:

```typescript
      const planByUid = new Map<
        string,
        { uid: string; recurrence: MasterRecurrence }
      >();
      const planByCat = new Map<
        string,
        { uid: string; recurrence: MasterRecurrence }
      >();
      for (const p of data.plans ?? []) {
        const info = {
          uid: p.uid,
          recurrence: TASK_TO_MASTER_RECURRENCE[p.recurrence] ?? "",
        };
        planByUid.set(String(p.uid), info);
        if (p.subcategory) planByCat.set(String(p.subcategory), info);
      }
      const monthSubs: SubtaskItem[] = (data.subtasks ?? []).map((dto) => {
        const planInfo = dto.plan_uid
          ? planByUid.get(String(dto.plan_uid))
          : dto.category
            ? planByCat.get(String(dto.category))
            : undefined;
        return {
          id: dto.uid,
          description: dto.description,
          category: dto.category_detail?.name ?? "",
          subcategoryUid: dto.category ? String(dto.category) : null,
          responsible: dto.responsible_detail?.full_name ?? "",
          targetDate: dto.target_date ?? "",
          expectedDate: dto.expected_date ?? "",
          completedDate: dto.completed_date ?? "",
          remarks: dto.remarks ?? "",
          planUid: planInfo?.uid ?? dto.plan_uid ?? null,
          recurrence: planInfo?.recurrence ?? "",
        };
      });
      setSubs(monthSubs);
```

- [ ] **Step 3: Apply the same join in the recurrence-change refresh (lines 509-592)**

Inside `handleRecurrenceChange`, the post-PATCH refresh rebuilds `planByCat` and re-maps subs (lines ~556-590). Replace that block with the identical `planByUid`/`planByCat` + `dto.plan_uid`-first join used in Step 2 so a free row's recurrence override round-trips:

```typescript
      const planByUid = new Map<
        string,
        { uid: string; recurrence: MasterRecurrence }
      >();
      const planByCat = new Map<
        string,
        { uid: string; recurrence: MasterRecurrence }
      >();
      for (const p of data.plans ?? []) {
        const info = {
          uid: p.uid,
          recurrence: TASK_TO_MASTER_RECURRENCE[p.recurrence] ?? "",
        };
        planByUid.set(String(p.uid), info);
        if (p.subcategory) planByCat.set(String(p.subcategory), info);
      }
      setSubs(
        (data.subtasks ?? []).map((dto) => {
          const info = dto.plan_uid
            ? planByUid.get(String(dto.plan_uid))
            : dto.category
              ? planByCat.get(String(dto.category))
              : undefined;
          return {
            id: dto.uid,
            description: dto.description,
            category: dto.category_detail?.name ?? "",
            subcategoryUid: dto.category ? String(dto.category) : null,
            responsible: dto.responsible_detail?.full_name ?? "",
            targetDate: dto.target_date ?? "",
            expectedDate: dto.expected_date ?? "",
            completedDate: dto.completed_date ?? "",
            remarks: dto.remarks ?? "",
            planUid: info?.uid ?? dto.plan_uid ?? null,
            recurrence: info?.recurrence ?? "",
          };
        }),
      );
```

- [ ] **Step 4: Type-check + build**

Run: `cd frontend/task-tracker && npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/components/board/TaskModal.tsx
git commit -m "feat(web): join subtask rows to plans by plan_uid (free plans incl.)"
```

---

## Task 10: Full verification + pre-commit + push

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend test suite**

Run: `uv run pytest core/tasks -v`
Expected: all PASS, including the new free-entry tests and the migration test.

- [ ] **Step 2: Run pre-commit across everything (project memory)**

Run: `uv run pre-commit run --all-files`
Expected: ruff / format / line-endings / mypy / pyright / eslint / tsc / build all PASS. Fix anything they flag and re-run until clean.

- [ ] **Step 3: Manual smoke (project memory: deploy success ≠ app healthy)**

Start the app per the `run` skill / repo instructions. In the "Add New Task" modal:
1. Pick a main category, add a master-backed subtask AND a free-entry subtask
   (category "-", description "Payroll", recurrence Monthly, a target date).
2. Save → expect success (no "Save failed").
3. Reopen the goal, step through months → the free row recurs, shows
   "Monthly" in its Recurrence dropdown, and supports recurrence-change + remove.

- [ ] **Step 4: Commit any pre-commit fixups, then push**

```bash
git push -u origin Task_addition
```

(Per project memory: `gh` is not installed — open the PR from the GitHub web URL printed by `git push`.)

---

## Notes for the implementer

- **TDD order matters:** the data migration (Task 3) must run before the engine
  tests in Tasks 4-5 rely on existing master children having `plan_id`. Run
  `uv run python manage.py migrate` after each model/migration task.
- **Postgres:** partial unique constraints and the backfill behave differently
  on SQLite vs Postgres. Task 3 Step 5 is not optional — verify on Postgres.
- **Don't remove** the legacy `uniq_child_per_plan_slot` constraint or the
  category-based fallbacks; plan-less legacy children still depend on them.
- **`active_from_month` for free rows** = first-of-month of the row's target
  date (decided in the spec). The backend falls back to `engagement_start` only
  if the client omits it.
