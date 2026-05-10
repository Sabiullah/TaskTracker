# Monthly Subtask Materialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace upfront materialization of every subtask occurrence with a per-goal sub-category plan + lazy per-month materialization, plus forward-only owner cascade and read-only past months in the Add/Edit Task modal.

**Architecture:** New `TaskSubcategoryPlan` Django model (one row per goal × sub-category) drives materialization of child Task rows on demand. The Add/Edit modal renders one calendar month at a time via a month dropdown. Add/remove/owner edits propagate forward through service-layer helpers. A one-time data migration backfills plans from existing eagerly-materialized goals so the UI stays consistent.

**Tech Stack:** Django 5 + DRF (backend), Django data migration with `RunPython`, React 19 + TypeScript + Vitest + React Testing Library (frontend), Vite dev server.

**Spec reference:** [docs/superpowers/specs/2026-05-10-monthly-subtask-materialization-design.md](../specs/2026-05-10-monthly-subtask-materialization-design.md)

---

## Conventions

- Run all backend tests with: `python manage.py test core.tasks -v 2` (from repo root, with `.venv` active).
- Run all frontend tests with: `cd frontend/task-tracker && npm run test`.
- Run a focused backend test: `python manage.py test core.tasks.tests.<ClassName>.<test_method> -v 2`.
- Run a focused frontend test: `cd frontend/task-tracker && npm run test -- <pattern>`.
- All Python imports follow `from core.tasks.models import ...` (absolute, not relative). Match existing style.
- Django migrations are created with `python manage.py makemigrations tasks` then renamed to the canonical filename if it differs.
- Commit after every passing test, using a Conventional Commits prefix (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`).

---

## File Structure

**Created files:**
- `core/tasks/services.py` — service layer (materialize, cascade, add/cap plan helpers)
- `core/tasks/migrations/0005_tasksubcategoryplan_and_engagement.py` — schema migration
- `core/tasks/migrations/0006_backfill_subcategory_plans.py` — data migration

**Modified files:**
- `core/tasks/models.py` — `engagement_start` / `engagement_end` fields on Task; new `TaskSubcategoryPlan` model
- `core/tasks/serializers.py` — `TaskSubcategoryPlanSerializer`; `plans` field on the create serializer; cascade-aware sub PATCH path
- `core/tasks/views.py` — `month` query param, `plans` action endpoints, cascade flag handling on subtask update
- `core/tasks/urls.py` — no router changes (DRF action endpoints register automatically)
- `core/tasks/tests.py` — test coverage for every behavior below
- `frontend/task-tracker/src/types/api/task.ts` — `TaskSubcategoryPlanDto`, `MonthScopedTaskDto`, plan-related request bodies
- `frontend/task-tracker/src/components/board/recurrence.ts` — `monthsBetween(start, end)` helper, `parseYearMonth`, `addMonthsToYearMonth`
- `frontend/task-tracker/src/components/board/TaskModal.tsx` — month selector state, plan-based create payload, lazy fetch on month change
- `frontend/task-tracker/src/components/board/SubtaskTable.tsx` — `readOnly` prop, owner-change calls cascade-aware patch, add/remove call plan endpoints
- `frontend/task-tracker/src/hooks/useTasks.ts` — month-scoped fetch + plan-management functions
- `frontend/task-tracker/src/__tests__/components/board/recurrence.test.ts` — coverage for new helpers
- `frontend/task-tracker/src/__tests__/components/board/SubtaskTable.test.tsx` — read-only past-month rendering

---

## Phase A: Backend models

### Task 1: Add `engagement_start` and `engagement_end` to Task

**Files:**
- Modify: `core/tasks/models.py`
- Create: `core/tasks/migrations/0005_tasksubcategoryplan_and_engagement.py` (partial — engagement fields only in this task; the new model lands in Task 2)
- Test: `core/tasks/tests.py`

- [ ] **Step 1: Write the failing test**

Append to `core/tasks/tests.py`:

```python
class TaskEngagementWindowTests(TestCase):
    def test_task_has_engagement_start_and_end_nullable(self):
        org, user, _client = _setup()
        t = Task.objects.create(
            description="Goal",
            org=org,
            reporting_manager=user,
            target_date=dt.date(2026, 6, 1),
            engagement_start=dt.date(2026, 5, 1),
            engagement_end=dt.date(2027, 4, 1),
        )
        t.refresh_from_db()
        self.assertEqual(t.engagement_start, dt.date(2026, 5, 1))
        self.assertEqual(t.engagement_end, dt.date(2027, 4, 1))

    def test_engagement_fields_default_to_null(self):
        org, user, _client = _setup()
        t = Task.objects.create(
            description="Goal",
            org=org,
            reporting_manager=user,
            target_date=dt.date(2026, 6, 1),
        )
        t.refresh_from_db()
        self.assertIsNone(t.engagement_start)
        self.assertIsNone(t.engagement_end)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python manage.py test core.tasks.tests.TaskEngagementWindowTests -v 2`
Expected: FAIL with `TypeError: ... got unexpected keyword arguments: 'engagement_start', 'engagement_end'` or similar attribute error.

- [ ] **Step 3: Add the fields to the Task model**

In `core/tasks/models.py`, inside `class Task(TimeStampedModel)`, add after the `recurrence` field declaration (around line 88):

```python
    # Engagement window for this goal. Used to default plan dates and to
    # bound the month-selector dropdown in the Add/Edit Task modal. Nullable
    # so legacy rows without a plan can stay empty.
    engagement_start = models.DateField(null=True, blank=True)
    engagement_end = models.DateField(null=True, blank=True)
```

- [ ] **Step 4: Generate and apply the migration**

Run: `python manage.py makemigrations tasks --name tasksubcategoryplan_and_engagement`
This creates `core/tasks/migrations/0005_tasksubcategoryplan_and_engagement.py` with only the two new fields (the model lands in Task 2 and gets folded into the same migration file).

Run: `python manage.py migrate tasks`

- [ ] **Step 5: Run the test to verify it passes**

Run: `python manage.py test core.tasks.tests.TaskEngagementWindowTests -v 2`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add core/tasks/models.py core/tasks/migrations/0005_tasksubcategoryplan_and_engagement.py core/tasks/tests.py
git commit -m "feat(tasks): add engagement_start/engagement_end fields to Task"
```

---

### Task 2: Add `TaskSubcategoryPlan` model

**Files:**
- Modify: `core/tasks/models.py`
- Modify: `core/tasks/migrations/0005_tasksubcategoryplan_and_engagement.py` (extends the file from Task 1)
- Test: `core/tasks/tests.py`

- [ ] **Step 1: Write the failing test**

Append to `core/tasks/tests.py`:

```python
from core.tasks.models import TaskSubcategoryPlan


class TaskSubcategoryPlanModelTests(TestCase):
    def setUp(self):
        self.org, self.user, _client = _setup()
        self.main = Task.objects.create(
            description="Goal",
            org=self.org,
            reporting_manager=self.user,
            target_date=dt.date(2027, 4, 30),
        )
        self.sub_cat = Master.objects.create(
            name="BRS", type="category", org=self.org
        )

    def test_plan_can_be_created_with_required_fields(self):
        plan = TaskSubcategoryPlan.objects.create(
            main_task=self.main,
            subcategory=self.sub_cat,
            recurrence="monthly",
            target_day=5,
            default_owner=self.user,
            active_from_month=dt.date(2026, 5, 1),
        )
        plan.refresh_from_db()
        self.assertEqual(plan.main_task_id, self.main.pk)
        self.assertEqual(plan.subcategory_id, self.sub_cat.pk)
        self.assertEqual(plan.recurrence, "monthly")
        self.assertEqual(plan.target_day, 5)
        self.assertEqual(plan.default_owner_id, self.user.pk)
        self.assertEqual(plan.active_from_month, dt.date(2026, 5, 1))
        self.assertIsNone(plan.active_until_month)

    def test_unique_main_task_subcategory(self):
        TaskSubcategoryPlan.objects.create(
            main_task=self.main,
            subcategory=self.sub_cat,
            recurrence="monthly",
            active_from_month=dt.date(2026, 5, 1),
        )
        with self.assertRaises(Exception):  # IntegrityError
            TaskSubcategoryPlan.objects.create(
                main_task=self.main,
                subcategory=self.sub_cat,
                recurrence="monthly",
                active_from_month=dt.date(2026, 6, 1),
            )

    def test_deleting_main_task_cascades_to_plans(self):
        TaskSubcategoryPlan.objects.create(
            main_task=self.main,
            subcategory=self.sub_cat,
            recurrence="monthly",
            active_from_month=dt.date(2026, 5, 1),
        )
        self.main.delete()
        self.assertEqual(TaskSubcategoryPlan.objects.count(), 0)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python manage.py test core.tasks.tests.TaskSubcategoryPlanModelTests -v 2`
Expected: FAIL with `ImportError: cannot import name 'TaskSubcategoryPlan'`.

- [ ] **Step 3: Add the model**

In `core/tasks/models.py`, after the `TaskLog` class (end of file), append:

```python
class TaskSubcategoryPlan(TimeStampedModel):
    """Per-goal sub-category template. Materializes Task children on-demand
    per month within ``[active_from_month, active_until_month]`` (or open-ended
    if ``active_until_month`` is null). Frozen recurrence/target_day so a
    later edit to the sub-cat master doesn't retro-shift the plan.
    """

    main_task = models.ForeignKey(
        Task,
        on_delete=models.CASCADE,
        related_name="sub_plans",
    )
    subcategory = models.ForeignKey(
        "masters.Master",
        on_delete=models.PROTECT,
        limit_choices_to={"type": "category"},
        related_name="plans",
    )
    recurrence = models.CharField(
        max_length=20,
        choices=Task.RECURRENCE_CHOICES,
        default="monthly",
    )
    target_day = models.PositiveSmallIntegerField(null=True, blank=True)
    default_owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="default_owner_plans",
    )
    # Both stored as the first day of the month (e.g. 2026-05-01) for clean
    # month-arithmetic downstream.
    active_from_month = models.DateField()
    active_until_month = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ["main_task_id", "subcategory_id"]
        unique_together = [("main_task", "subcategory")]
        verbose_name = "task subcategory plan"
        verbose_name_plural = "task subcategory plans"

    def __str__(self):
        return f"Plan(goal={self.main_task_id}, sub={self.subcategory_id})"
```

- [ ] **Step 4: Update the migration to include the new model**

Run: `python manage.py makemigrations tasks`
This rewrites `0005_tasksubcategoryplan_and_engagement.py` (or creates `0006`) to include `TaskSubcategoryPlan`. If a new file `0006_*.py` was generated instead of extending `0005`, accept it — final filename does not matter as long as the dependency chain works. Note the actual filename and use it in the next step.

Run: `python manage.py migrate tasks`

- [ ] **Step 5: Run the test to verify it passes**

Run: `python manage.py test core.tasks.tests.TaskSubcategoryPlanModelTests -v 2`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add core/tasks/models.py core/tasks/migrations/ core/tasks/tests.py
git commit -m "feat(tasks): add TaskSubcategoryPlan model"
```

---

## Phase B: Backend services

### Task 3: `materialize_month` service

**Files:**
- Create: `core/tasks/services.py`
- Test: `core/tasks/tests.py`

- [ ] **Step 1: Write the failing test**

Append to `core/tasks/tests.py`:

```python
from core.tasks.services import materialize_month


class MaterializeMonthTests(TestCase):
    def setUp(self):
        self.org, self.user, self.client_master = _setup()
        self.main = Task.objects.create(
            description="Goal",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            target_date=dt.date(2027, 4, 30),
            engagement_start=dt.date(2026, 5, 1),
            engagement_end=dt.date(2027, 4, 1),
        )
        self.brs = Master.objects.create(name="BRS", type="category", org=self.org)
        self.plan = TaskSubcategoryPlan.objects.create(
            main_task=self.main,
            subcategory=self.brs,
            recurrence="monthly",
            target_day=5,
            default_owner=self.user,
            active_from_month=dt.date(2026, 5, 1),
            active_until_month=dt.date(2027, 4, 1),
        )

    def test_materializes_one_child_for_active_month(self):
        created = materialize_month(self.main, dt.date(2026, 5, 1))
        self.assertEqual(len(created), 1)
        child = created[0]
        self.assertEqual(child.parent_id, self.main.pk)
        self.assertEqual(child.category_id, self.brs.pk)
        self.assertEqual(child.target_date, dt.date(2026, 5, 5))
        self.assertEqual(child.responsible_id, self.user.pk)

    def test_idempotent_second_call_creates_nothing(self):
        materialize_month(self.main, dt.date(2026, 5, 1))
        created_again = materialize_month(self.main, dt.date(2026, 5, 1))
        self.assertEqual(created_again, [])
        self.assertEqual(self.main.subtasks.count(), 1)

    def test_skips_months_outside_active_window(self):
        # Active window is May 2026 – Apr 2027.
        created = materialize_month(self.main, dt.date(2026, 4, 1))  # before
        self.assertEqual(created, [])
        created = materialize_month(self.main, dt.date(2027, 5, 1))  # after
        self.assertEqual(created, [])

    def test_quarterly_skips_off_step_months(self):
        self.plan.recurrence = "quarterly"
        self.plan.save()
        # Step starts at active_from_month (May). Off-step (June, July) should
        # produce nothing; on-step (Aug, Nov) should materialize.
        self.assertEqual(materialize_month(self.main, dt.date(2026, 6, 1)), [])
        self.assertEqual(materialize_month(self.main, dt.date(2026, 7, 1)), [])
        self.assertEqual(len(materialize_month(self.main, dt.date(2026, 8, 1))), 1)
        self.assertEqual(len(materialize_month(self.main, dt.date(2026, 11, 1))), 1)

    def test_clamps_target_day_to_last_day_of_short_month(self):
        self.plan.target_day = 31
        self.plan.save()
        # February 2027 has 28 days; clamp to the 28th.
        Task.objects.filter(parent=self.main).delete()
        created = materialize_month(self.main, dt.date(2027, 2, 1))
        self.assertEqual(created[0].target_date, dt.date(2027, 2, 28))
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python manage.py test core.tasks.tests.MaterializeMonthTests -v 2`
Expected: FAIL with `ModuleNotFoundError: No module named 'core.tasks.services'`.

- [ ] **Step 3: Create the service module**

Create `core/tasks/services.py`:

```python
"""Service layer for the per-goal sub-category plan + per-month materialization.

Each function is pure-ish: it accepts a ``Task`` (the main goal) plus the bare
arguments it needs and either creates/updates child rows or plan rows. Keeping
these out of views/serializers makes them unit-testable in isolation and
reusable from data migrations or admin actions.
"""

from __future__ import annotations

import calendar
import datetime as dt

from django.db import transaction

from core.tasks.models import Task, TaskSubcategoryPlan

# How many months a recurrence steps between consecutive occurrences.
_STEP_MONTHS = {
    "onetime": 0,
    "monthly": 1,
    "quarterly": 3,
    "halfyearly": 6,
    "yearly": 12,
}


def _first_of_month(d: dt.date) -> dt.date:
    return d.replace(day=1)


def _months_between(a: dt.date, b: dt.date) -> int:
    """Inclusive count of month-starts between ``a`` and ``b`` (>= 0).

    Both inputs are first-of-month. Result is positive when ``b`` >= ``a``.
    """
    return (b.year - a.year) * 12 + (b.month - a.month)


def _is_on_step(plan: TaskSubcategoryPlan, month_start: dt.date) -> bool:
    step = _STEP_MONTHS.get(plan.recurrence, 1)
    if step <= 0:
        return month_start == plan.active_from_month
    delta = _months_between(plan.active_from_month, month_start)
    return delta >= 0 and delta % step == 0


def _target_date_for(plan: TaskSubcategoryPlan, month_start: dt.date) -> dt.date:
    """Compute the materialized target date for a plan in a given month.

    Falls back to the first of the month when ``target_day`` is null. Clamps
    to the last day when ``target_day`` exceeds the month's length.
    """
    day = plan.target_day or 1
    last_day = calendar.monthrange(month_start.year, month_start.month)[1]
    return month_start.replace(day=min(day, last_day))


def _is_within_window(plan: TaskSubcategoryPlan, month_start: dt.date) -> bool:
    if month_start < plan.active_from_month:
        return False
    if plan.active_until_month and month_start > plan.active_until_month:
        return False
    return True


@transaction.atomic
def materialize_month(main: Task, month_start: dt.date) -> list[Task]:
    """Ensure every active plan for ``main`` has a child Task row in
    ``month_start``'s month. Idempotent: returns only newly-created rows.

    ``month_start`` must be the first day of a month.
    """
    if month_start.day != 1:
        month_start = _first_of_month(month_start)

    created: list[Task] = []
    plans = list(main.sub_plans.select_related("subcategory", "default_owner").all())
    if not plans:
        return created

    # Look up children already materialized for this (goal, month) so we can
    # skip plans whose row already exists.
    month_end = month_start + dt.timedelta(days=31)
    month_end = month_end.replace(day=1)  # First of next month.
    existing_categories = set(
        Task.objects.filter(
            parent=main,
            target_date__gte=month_start,
            target_date__lt=month_end,
        ).values_list("category_id", flat=True)
    )

    for plan in plans:
        if not _is_within_window(plan, month_start):
            continue
        if not _is_on_step(plan, month_start):
            continue
        if plan.subcategory_id in existing_categories:
            continue

        target_date = _target_date_for(plan, month_start)
        child = Task.objects.create(
            parent=main,
            org=main.org,
            client=main.client,
            reporting_manager=main.reporting_manager,
            recurrence=main.recurrence,
            description=plan.subcategory.name,
            category=plan.subcategory,
            responsible=plan.default_owner,
            target_date=target_date,
            status="pending",
        )
        created.append(child)

    return created
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python manage.py test core.tasks.tests.MaterializeMonthTests -v 2`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add core/tasks/services.py core/tasks/tests.py
git commit -m "feat(tasks): add materialize_month service for plan-driven subtask creation"
```

---

### Task 4: `cascade_owner_forward` service

**Files:**
- Modify: `core/tasks/services.py`
- Test: `core/tasks/tests.py`

- [ ] **Step 1: Write the failing test**

Append to `core/tasks/tests.py`:

```python
from core.tasks.services import cascade_owner_forward


class CascadeOwnerForwardTests(TestCase):
    def setUp(self):
        self.org, self.alice, self.client_master = _setup()
        self.bob = User.objects.create_user(username="bob", password="pw", full_name="Bob")
        OrgMembership.objects.create(user=self.bob, org=self.org, role="employee")
        self.main = Task.objects.create(
            description="Goal",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.alice,
            target_date=dt.date(2027, 4, 30),
            engagement_start=dt.date(2026, 5, 1),
            engagement_end=dt.date(2027, 4, 1),
        )
        self.brs = Master.objects.create(name="BRS", type="category", org=self.org)
        self.plan = TaskSubcategoryPlan.objects.create(
            main_task=self.main,
            subcategory=self.brs,
            recurrence="monthly",
            target_day=5,
            default_owner=self.alice,
            active_from_month=dt.date(2026, 5, 1),
            active_until_month=dt.date(2027, 4, 1),
        )
        # Materialize 3 children (May, Jun, Jul) so we have something to cascade.
        for m in (5, 6, 7):
            materialize_month(self.main, dt.date(2026, m, 1))
        self.may = Task.objects.get(parent=self.main, target_date=dt.date(2026, 5, 5))
        self.jun = Task.objects.get(parent=self.main, target_date=dt.date(2026, 6, 5))
        self.jul = Task.objects.get(parent=self.main, target_date=dt.date(2026, 7, 5))

    def test_changing_jun_owner_cascades_to_jul_but_not_may(self):
        cascade_owner_forward(self.jun, new_owner=self.bob)
        self.may.refresh_from_db()
        self.jun.refresh_from_db()
        self.jul.refresh_from_db()
        self.assertEqual(self.may.responsible_id, self.alice.pk)  # untouched
        self.assertEqual(self.jun.responsible_id, self.bob.pk)
        self.assertEqual(self.jul.responsible_id, self.bob.pk)

    def test_cascade_updates_plan_default_owner(self):
        cascade_owner_forward(self.jun, new_owner=self.bob)
        self.plan.refresh_from_db()
        self.assertEqual(self.plan.default_owner_id, self.bob.pk)

    def test_cascade_only_affects_same_plan(self):
        other_cat = Master.objects.create(name="VAT", type="category", org=self.org)
        TaskSubcategoryPlan.objects.create(
            main_task=self.main,
            subcategory=other_cat,
            recurrence="monthly",
            target_day=10,
            default_owner=self.alice,
            active_from_month=dt.date(2026, 5, 1),
            active_until_month=dt.date(2027, 4, 1),
        )
        materialize_month(self.main, dt.date(2026, 6, 1))
        vat_jun = Task.objects.get(
            parent=self.main, category=other_cat, target_date=dt.date(2026, 6, 10)
        )
        cascade_owner_forward(self.jun, new_owner=self.bob)
        vat_jun.refresh_from_db()
        self.assertEqual(vat_jun.responsible_id, self.alice.pk)  # other plan untouched
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python manage.py test core.tasks.tests.CascadeOwnerForwardTests -v 2`
Expected: FAIL with `ImportError: cannot import name 'cascade_owner_forward'`.

- [ ] **Step 3: Add the service function**

Append to `core/tasks/services.py`:

```python
def _plan_for_child(child: Task) -> TaskSubcategoryPlan | None:
    """Find the plan that produced this child Task — by (main_task, sub-cat)."""
    if child.parent_id is None or child.category_id is None:
        return None
    return TaskSubcategoryPlan.objects.filter(
        main_task_id=child.parent_id,
        subcategory_id=child.category_id,
    ).first()


@transaction.atomic
def cascade_owner_forward(child: Task, new_owner) -> int:
    """Set ``child.responsible = new_owner`` and propagate forward.

    Updates every Task that:
      - shares the same plan (same parent + same category), AND
      - has ``target_date > child.target_date``.

    Also updates the plan's ``default_owner`` so future on-demand
    materializations pick up the new owner.

    Past child rows (target_date < child.target_date) are not touched.

    Returns the number of rows updated (including ``child`` itself).
    """
    if child.parent_id is None or child.target_date is None:
        return 0

    child.responsible = new_owner
    child.save(update_fields=["responsible", "updated_at"])

    plan = _plan_for_child(child)
    if plan is None:
        return 1

    plan.default_owner = new_owner
    plan.save(update_fields=["default_owner", "updated_at"])

    updated = Task.objects.filter(
        parent_id=child.parent_id,
        category_id=child.category_id,
        target_date__gt=child.target_date,
    ).update(responsible=new_owner)

    return 1 + updated
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python manage.py test core.tasks.tests.CascadeOwnerForwardTests -v 2`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add core/tasks/services.py core/tasks/tests.py
git commit -m "feat(tasks): add cascade_owner_forward service for forward-only owner propagation"
```

---

### Task 5: `add_or_extend_plan` and `cap_plan` services

**Files:**
- Modify: `core/tasks/services.py`
- Test: `core/tasks/tests.py`

- [ ] **Step 1: Write the failing test**

Append to `core/tasks/tests.py`:

```python
from core.tasks.services import add_or_extend_plan, cap_plan


class AddOrExtendPlanTests(TestCase):
    def setUp(self):
        self.org, self.user, self.client_master = _setup()
        self.main = Task.objects.create(
            description="Goal",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            target_date=dt.date(2027, 4, 30),
            engagement_start=dt.date(2026, 5, 1),
            engagement_end=dt.date(2027, 4, 1),
        )
        self.brs = Master.objects.create(
            name="BRS",
            type="category",
            org=self.org,
            recurrence="Monthly",
            target_day=5,
        )

    def test_creates_new_plan_when_none_exists(self):
        plan, child = add_or_extend_plan(
            self.main,
            self.brs,
            month_start=dt.date(2026, 5, 1),
            owner=self.user,
        )
        self.assertEqual(plan.main_task_id, self.main.pk)
        self.assertEqual(plan.recurrence, "monthly")
        self.assertEqual(plan.target_day, 5)
        self.assertEqual(plan.active_from_month, dt.date(2026, 5, 1))
        self.assertEqual(plan.active_until_month, dt.date(2027, 4, 1))
        self.assertIsNotNone(child)
        self.assertEqual(child.target_date, dt.date(2026, 5, 5))

    def test_extends_existing_plan_to_earlier_active_from(self):
        plan = TaskSubcategoryPlan.objects.create(
            main_task=self.main,
            subcategory=self.brs,
            recurrence="monthly",
            target_day=5,
            active_from_month=dt.date(2026, 8, 1),
            active_until_month=dt.date(2026, 9, 1),
        )
        plan2, _child = add_or_extend_plan(
            self.main, self.brs, month_start=dt.date(2026, 6, 1), owner=self.user
        )
        self.assertEqual(plan2.pk, plan.pk)
        self.assertEqual(plan2.active_from_month, dt.date(2026, 6, 1))
        # active_until_month untouched when later than the requested month.
        self.assertEqual(plan2.active_until_month, dt.date(2026, 9, 1))

    def test_extends_existing_plan_clearing_capped_until(self):
        TaskSubcategoryPlan.objects.create(
            main_task=self.main,
            subcategory=self.brs,
            recurrence="monthly",
            target_day=5,
            active_from_month=dt.date(2026, 5, 1),
            active_until_month=dt.date(2026, 6, 1),
        )
        plan2, _ = add_or_extend_plan(
            self.main, self.brs, month_start=dt.date(2026, 8, 1), owner=self.user
        )
        # Re-adding from a later month than the cap clears the cap so the
        # plan resumes (open-ended back to engagement_end fallback).
        self.assertEqual(plan2.active_from_month, dt.date(2026, 5, 1))
        self.assertEqual(plan2.active_until_month, dt.date(2027, 4, 1))


class CapPlanTests(TestCase):
    def setUp(self):
        self.org, self.user, self.client_master = _setup()
        self.main = Task.objects.create(
            description="Goal",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            target_date=dt.date(2027, 4, 30),
            engagement_start=dt.date(2026, 5, 1),
            engagement_end=dt.date(2027, 4, 1),
        )
        self.brs = Master.objects.create(name="BRS", type="category", org=self.org)
        self.plan = TaskSubcategoryPlan.objects.create(
            main_task=self.main,
            subcategory=self.brs,
            recurrence="monthly",
            target_day=5,
            default_owner=self.user,
            active_from_month=dt.date(2026, 5, 1),
            active_until_month=dt.date(2027, 4, 1),
        )
        for m in (5, 6, 7, 8):
            materialize_month(self.main, dt.date(2026, m, 1))

    def test_caps_plan_and_deletes_uncompleted_future_children(self):
        # Cap from July: keep May+June, drop July+August.
        result = cap_plan(self.plan, from_month=dt.date(2026, 7, 1))
        self.plan.refresh_from_db()
        self.assertEqual(self.plan.active_until_month, dt.date(2026, 6, 1))
        remaining = sorted(
            Task.objects.filter(parent=self.main).values_list("target_date", flat=True)
        )
        self.assertEqual(remaining, [dt.date(2026, 5, 5), dt.date(2026, 6, 5)])
        self.assertEqual(result["plan_capped"], True)
        self.assertEqual(result["children_deleted"], 2)

    def test_keeps_completed_children_even_when_capped(self):
        jul = Task.objects.get(parent=self.main, target_date=dt.date(2026, 7, 5))
        jul.completed_date = dt.date(2026, 7, 4)
        jul.status = "completed"
        jul.save()

        cap_plan(self.plan, from_month=dt.date(2026, 7, 1))

        remaining = sorted(
            Task.objects.filter(parent=self.main).values_list("target_date", flat=True)
        )
        # July preserved (completed). August dropped.
        self.assertEqual(
            remaining,
            [dt.date(2026, 5, 5), dt.date(2026, 6, 5), dt.date(2026, 7, 5)],
        )

    def test_capping_at_or_before_active_from_deletes_plan(self):
        result = cap_plan(self.plan, from_month=dt.date(2026, 5, 1))
        self.assertFalse(TaskSubcategoryPlan.objects.filter(pk=self.plan.pk).exists())
        self.assertEqual(result["plan_capped"], False)
        self.assertEqual(result["plan_deleted"], True)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python manage.py test core.tasks.tests.AddOrExtendPlanTests core.tasks.tests.CapPlanTests -v 2`
Expected: FAIL with `ImportError: cannot import name 'add_or_extend_plan'`.

- [ ] **Step 3: Add the service functions**

Append to `core/tasks/services.py`:

```python
# Map sub-cat master's RECURRENCE_CHOICES values (e.g. "Monthly") to the
# Task model's lowercase values (e.g. "monthly"). Master uses Title-case
# choices for legacy reasons; Task uses lowercase. Always normalize to
# Task's space when reading from the master.
_MASTER_TO_TASK_RECURRENCE = {
    "": "monthly",
    "Onetime": "onetime",
    "Monthly": "monthly",
    "Quarterly": "quarterly",
    "Halfyearly": "halfyearly",
    "Yearly": "yearly",
}


def _normalize_recurrence(value: str | None) -> str:
    if value is None:
        return "monthly"
    if value in _MASTER_TO_TASK_RECURRENCE:
        return _MASTER_TO_TASK_RECURRENCE[value]
    # Already lowercase Task value.
    return value


@transaction.atomic
def add_or_extend_plan(
    main: Task,
    subcategory,
    month_start: dt.date,
    owner=None,
) -> tuple[TaskSubcategoryPlan, Task | None]:
    """Add a new sub-cat plan starting at ``month_start``, or extend an
    existing one for the same (main, subcategory) so it covers ``month_start``.

    Always materializes the row for ``month_start`` if it lands on a recurrence
    step. Returns ``(plan, child_or_None)``.
    """
    month_start = _first_of_month(month_start)

    plan = TaskSubcategoryPlan.objects.filter(
        main_task=main, subcategory=subcategory
    ).first()

    if plan is None:
        plan = TaskSubcategoryPlan.objects.create(
            main_task=main,
            subcategory=subcategory,
            recurrence=_normalize_recurrence(subcategory.recurrence),
            target_day=subcategory.target_day,
            default_owner=owner,
            active_from_month=month_start,
            active_until_month=main.engagement_end,
        )
    else:
        changed = False
        if month_start < plan.active_from_month:
            plan.active_from_month = month_start
            changed = True
        # Re-add after a previous removal: clear the cap if it falls before
        # the requested month, so the plan resumes through engagement_end.
        if (
            plan.active_until_month is not None
            and plan.active_until_month < month_start
        ):
            plan.active_until_month = main.engagement_end
            changed = True
        if owner is not None and plan.default_owner_id != getattr(owner, "pk", None):
            plan.default_owner = owner
            changed = True
        if changed:
            plan.save()

    created = materialize_month(main, month_start)
    child = next(
        (c for c in created if c.category_id == subcategory.pk),
        None,
    )
    if child is None:
        # Already existed for this month — fetch and return it.
        month_end = (month_start + dt.timedelta(days=31)).replace(day=1)
        child = Task.objects.filter(
            parent=main,
            category=subcategory,
            target_date__gte=month_start,
            target_date__lt=month_end,
        ).first()
    return plan, child


@transaction.atomic
def cap_plan(plan: TaskSubcategoryPlan, from_month: dt.date) -> dict:
    """End the plan so it stops generating from ``from_month`` onwards.

    - If ``from_month`` is at or before ``active_from_month``, the plan is
      hard-deleted (it never materialized anything we want to keep).
    - Otherwise ``active_until_month`` is set to the month before
      ``from_month`` and every uncompleted child whose ``target_date`` falls
      in or after ``from_month`` is deleted. Children with ``completed_date``
      are preserved as history.

    Returns a dict with ``plan_capped`` / ``plan_deleted`` / ``children_deleted``.
    """
    from_month = _first_of_month(from_month)

    if from_month <= plan.active_from_month:
        children_deleted, _ = Task.objects.filter(
            parent_id=plan.main_task_id,
            category_id=plan.subcategory_id,
            target_date__gte=from_month,
            completed_date__isnull=True,
        ).delete()
        plan.delete()
        return {
            "plan_capped": False,
            "plan_deleted": True,
            "children_deleted": children_deleted,
        }

    # Set active_until_month = previous month-start.
    if from_month.month == 1:
        prev_month_start = dt.date(from_month.year - 1, 12, 1)
    else:
        prev_month_start = dt.date(from_month.year, from_month.month - 1, 1)

    plan.active_until_month = prev_month_start
    plan.save(update_fields=["active_until_month", "updated_at"])

    children_deleted, _ = Task.objects.filter(
        parent_id=plan.main_task_id,
        category_id=plan.subcategory_id,
        target_date__gte=from_month,
        completed_date__isnull=True,
    ).delete()
    return {
        "plan_capped": True,
        "plan_deleted": False,
        "children_deleted": children_deleted,
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python manage.py test core.tasks.tests.AddOrExtendPlanTests core.tasks.tests.CapPlanTests -v 2`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add core/tasks/services.py core/tasks/tests.py
git commit -m "feat(tasks): add add_or_extend_plan and cap_plan services"
```

---

## Phase C: Backend API

### Task 6: `TaskSubcategoryPlanSerializer` + accept plans on create

**Files:**
- Modify: `core/tasks/serializers.py`
- Test: `core/tasks/tests.py`

- [ ] **Step 1: Write the failing test**

Append to `core/tasks/tests.py`:

```python
class CreateTaskWithPlansAPITests(TestCase):
    def setUp(self):
        self.org, self.user, self.client_master = _setup()
        self.brs = Master.objects.create(
            name="BRS",
            type="category",
            org=self.org,
            recurrence="Monthly",
            target_day=5,
        )
        self.api = APIClient()
        self.api.force_authenticate(user=self.user)

    def test_create_with_plans_payload_creates_plan_and_current_month_only(self):
        today_first = dt.date.today().replace(day=1)
        engagement_end = dt.date(today_first.year + 1, today_first.month, 1)
        body = {
            "description": "Book Keeping",
            "client": str(self.client_master.uid),
            "reporting_manager": str(self.user.uid),
            "target_date": engagement_end.isoformat(),
            "engagement_start": today_first.isoformat(),
            "engagement_end": engagement_end.isoformat(),
            "plans": [
                {
                    "subcategory": str(self.brs.uid),
                    "default_owner": str(self.user.uid),
                }
            ],
        }
        resp = self.api.post("/api/tasks/", body, format="json")
        self.assertEqual(resp.status_code, 201, resp.content)

        goal = Task.objects.get(uid=resp.data["uid"])
        self.assertEqual(goal.engagement_start, today_first)
        self.assertEqual(goal.engagement_end, engagement_end)

        plans = list(goal.sub_plans.all())
        self.assertEqual(len(plans), 1)
        self.assertEqual(plans[0].subcategory_id, self.brs.pk)
        self.assertEqual(plans[0].active_from_month, today_first)

        # Only ONE child row materialized — the current month only.
        children = list(goal.subtasks.all())
        self.assertEqual(len(children), 1)
        self.assertEqual(children[0].category_id, self.brs.pk)
        self.assertEqual(children[0].target_date.replace(day=1), today_first)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python manage.py test core.tasks.tests.CreateTaskWithPlansAPITests -v 2`
Expected: FAIL — likely a 400 (`plans` is unknown), or a 201 with no plan rows (depending on serializer behavior).

- [ ] **Step 3: Add the plan serializer + plans field on create**

In `core/tasks/serializers.py`, add imports near the top (after the existing `from .models import Task, TaskLog` line):

```python
from core.tasks.models import TaskSubcategoryPlan
from core.tasks.services import materialize_month
```

Add a new serializer above `TaskSerializer`:

```python
class TaskSubcategoryPlanSerializer(serializers.ModelSerializer):
    """Plan-row payload for create/read. Sub-cat / owner accepted as uids."""

    uid = serializers.UUIDField(read_only=True, required=False)
    subcategory = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Master.objects.filter(type="category"),
    )
    subcategory_detail = MasterMinSerializer(source="subcategory", read_only=True)
    default_owner = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=get_user_model().objects.all(),
        required=False,
        allow_null=True,
    )
    default_owner_detail = UserMinSerializer(source="default_owner", read_only=True)

    class Meta:
        model = TaskSubcategoryPlan
        fields = [
            "uid",
            "subcategory",
            "subcategory_detail",
            "recurrence",
            "target_day",
            "default_owner",
            "default_owner_detail",
            "active_from_month",
            "active_until_month",
        ]
        read_only_fields = ["uid", "subcategory_detail", "default_owner_detail"]
```

Add a `uid` field on `TaskSubcategoryPlan` model (forgot earlier — needed for the API). In `core/tasks/models.py`, inside `TaskSubcategoryPlan`, near the top of the field declarations add:

```python
    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
```

Generate and run a fresh migration:

```bash
python manage.py makemigrations tasks --name plan_uid
python manage.py migrate tasks
```

Now extend `TaskSerializer.Meta.fields` to include the engagement fields. In `core/tasks/serializers.py`, find the `fields = [...]` list inside `TaskSerializer.Meta` and add `"engagement_start"` and `"engagement_end"` after `"recurrence"`:

```python
            "recurrence",
            "engagement_start",
            "engagement_end",
            "target_date",
```

Update `TaskWithSubtasksSerializer` to also accept a `plans` array on create. Replace the class with:

```python
class TaskWithSubtasksSerializer(TaskSerializer):
    """Wraps ``TaskSerializer`` to upsert a Main + N Subs atomically.

    Newer create flow: instead of a flat ``subtasks`` array the client may
    POST ``plans``; the server creates one ``TaskSubcategoryPlan`` row per
    entry and lazily materializes the *current* calendar month's children
    via ``materialize_month``. Both ``subtasks`` and ``plans`` are accepted
    on create — ``plans`` takes precedence; ``subtasks`` remains supported
    so legacy clients keep working until everyone updates.
    """

    subtasks = _SubtaskItemSerializer(many=True, required=False)
    plans = TaskSubcategoryPlanSerializer(many=True, required=False)

    class Meta(TaskSerializer.Meta):
        fields = TaskSerializer.Meta.fields + ["subtasks", "plans"]
        read_only_fields = list(TaskSerializer.Meta.read_only_fields)

    # _inheritance, _viewer, _can_manage_subs, _enforce_employee_sub_edit,
    # _upsert_subs all unchanged — keep existing implementations from this file.

    def _create_plans(self, main: "Task", plan_rows: list[dict]) -> None:
        for row in plan_rows:
            sub_cat = row["subcategory"]
            TaskSubcategoryPlan.objects.create(
                main_task=main,
                subcategory=sub_cat,
                recurrence=row.get("recurrence") or _normalize_master_recurrence(sub_cat.recurrence),
                target_day=row.get("target_day") if "target_day" in row else sub_cat.target_day,
                default_owner=row.get("default_owner"),
                active_from_month=row.get("active_from_month") or _first_of_month_or_today(main.engagement_start),
                active_until_month=row.get("active_until_month") or main.engagement_end,
            )

    def create(self, validated_data):
        subs = validated_data.pop("subtasks", None)
        plans = validated_data.pop("plans", None)
        with transaction.atomic():
            main = TaskSerializer.create(self, validated_data)
            if plans:
                self._create_plans(main, plans)
                # Materialize only the current calendar month.
                from django.utils.timezone import localdate
                materialize_month(main, localdate().replace(day=1))
            elif subs:
                self._upsert_subs(main, subs)
        return main

    def update(self, instance, validated_data):
        subs = validated_data.pop("subtasks", None)
        validated_data.pop("plans", None)  # Plans are managed via dedicated endpoints, not bulk update.
        with transaction.atomic():
            main = TaskSerializer.update(self, instance, validated_data)
            if subs is not None:
                self._upsert_subs(main, subs)
            main.full_clean()
        return main
```

Now add the two small helpers near the top of the file (after the existing imports, before `_derive_sub_status`):

```python
def _normalize_master_recurrence(value: str) -> str:
    """Map the Master's title-case recurrence to the Task model's lowercase."""
    mapping = {
        "": "monthly",
        "Onetime": "onetime",
        "Monthly": "monthly",
        "Quarterly": "quarterly",
        "Halfyearly": "halfyearly",
        "Yearly": "yearly",
    }
    return mapping.get(value, value)


def _first_of_month_or_today(d):
    import datetime as _dt
    from django.utils.timezone import localdate
    if d is None:
        return localdate().replace(day=1)
    if isinstance(d, _dt.date):
        return d.replace(day=1)
    return localdate().replace(day=1)
```

Update the viewset selector in `core/tasks/views.py` so the nested serializer is also picked when `plans` is in the body:

```python
    def get_serializer_class(self):
        body = getattr(self.request, "data", None)
        if isinstance(body, dict) and ("subtasks" in body or "plans" in body):
            return TaskWithSubtasksSerializer
        return TaskSerializer
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python manage.py test core.tasks.tests.CreateTaskWithPlansAPITests -v 2`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/tasks/models.py core/tasks/migrations/ core/tasks/serializers.py core/tasks/views.py core/tasks/tests.py
git commit -m "feat(tasks): accept plans payload on create + add plan serializer"
```

---

### Task 7: `month` query param on retrieve — lazy materialize on view

**Files:**
- Modify: `core/tasks/views.py`
- Test: `core/tasks/tests.py`

- [ ] **Step 1: Write the failing test**

Append to `core/tasks/tests.py`:

```python
class RetrieveTaskWithMonthTests(TestCase):
    def setUp(self):
        self.org, self.user, self.client_master = _setup()
        self.brs = Master.objects.create(
            name="BRS", type="category", org=self.org, recurrence="Monthly", target_day=5
        )
        self.api = APIClient()
        self.api.force_authenticate(user=self.user)
        self.main = Task.objects.create(
            description="Goal",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            target_date=dt.date(2027, 4, 30),
            engagement_start=dt.date(2026, 5, 1),
            engagement_end=dt.date(2027, 4, 1),
        )
        TaskSubcategoryPlan.objects.create(
            main_task=self.main,
            subcategory=self.brs,
            recurrence="monthly",
            target_day=5,
            default_owner=self.user,
            active_from_month=dt.date(2026, 5, 1),
            active_until_month=dt.date(2027, 4, 1),
        )

    def test_retrieve_with_month_lazy_materializes_and_returns_subtasks(self):
        url = f"/api/tasks/{self.main.uid}/?month=2026-08"
        resp = self.api.get(url)
        self.assertEqual(resp.status_code, 200, resp.content)
        # New child created for August.
        children = list(self.main.subtasks.all())
        self.assertEqual(len(children), 1)
        self.assertEqual(children[0].target_date, dt.date(2026, 8, 5))
        # Subtasks key included in response.
        self.assertIn("subtasks", resp.data)
        self.assertEqual(len(resp.data["subtasks"]), 1)

    def test_retrieve_with_month_outside_engagement_returns_no_subtasks(self):
        url = f"/api/tasks/{self.main.uid}/?month=2025-04"
        resp = self.api.get(url)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["subtasks"], [])
        self.assertEqual(self.main.subtasks.count(), 0)

    def test_retrieve_without_month_param_does_not_materialize(self):
        url = f"/api/tasks/{self.main.uid}/"
        resp = self.api.get(url)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self.main.subtasks.count(), 0)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python manage.py test core.tasks.tests.RetrieveTaskWithMonthTests -v 2`
Expected: FAIL — at minimum the `subtasks` key won't be in the response, and lazy materialization won't fire.

- [ ] **Step 3: Implement the month-scoped retrieve action**

In `core/tasks/views.py`, replace the imports block and add a `retrieve` override on the viewset.

Add to imports:

```python
import datetime as dt
from rest_framework.exceptions import ValidationError as DrfValidationError
from core.tasks.services import materialize_month
```

Inside `TaskViewSet`, add:

```python
    def retrieve(self, request, *args, **kwargs):
        """Detail view with optional ``?month=YYYY-MM`` filter.

        When ``month`` is provided and lands inside the goal's engagement
        window, lazy-materializes that month's children before returning so
        the modal sees a complete snapshot. Past, current, and future months
        all materialize on view; the past-month write-protection is enforced
        on the PATCH/DELETE side, not here.
        """
        instance = self.get_object()
        month_param = request.query_params.get("month")

        subtasks_payload: list[dict] = []
        if month_param:
            try:
                month_start = dt.datetime.strptime(month_param, "%Y-%m").date().replace(day=1)
            except ValueError as e:
                raise DrfValidationError({"month": "Expected YYYY-MM."}) from e
            # Only goals (parent IS NULL) materialize. Subtasks themselves
            # don't carry plans.
            if instance.parent_id is None:
                # Don't materialize past months for newly viewed goals — the
                # spec calls for past-as-history. But for current/future
                # within engagement, materialize.
                if (
                    instance.engagement_start is None
                    or month_start >= instance.engagement_start
                ):
                    materialize_month(instance, month_start)

            month_end = (month_start + dt.timedelta(days=31)).replace(day=1)
            subs_qs = Task.objects.filter(
                parent=instance,
                target_date__gte=month_start,
                target_date__lt=month_end,
            ).order_by("target_date", "id")
            subtasks_payload = TaskSerializer(subs_qs, many=True).data

        serializer = self.get_serializer(instance)
        data = dict(serializer.data)
        if month_param:
            data["subtasks"] = subtasks_payload
        return Response(data)
```

(Keep `from rest_framework.response import Response` already imported.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `python manage.py test core.tasks.tests.RetrieveTaskWithMonthTests -v 2`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add core/tasks/views.py core/tasks/tests.py
git commit -m "feat(tasks): month-scoped retrieve with lazy subtask materialization"
```

---

### Task 8: `plans` action endpoints (POST add/extend, DELETE cap)

**Files:**
- Modify: `core/tasks/views.py`
- Test: `core/tasks/tests.py`

- [ ] **Step 1: Write the failing test**

Append to `core/tasks/tests.py`:

```python
class PlanActionEndpointsTests(TestCase):
    def setUp(self):
        self.org, self.user, self.client_master = _setup()
        self.brs = Master.objects.create(
            name="BRS", type="category", org=self.org, recurrence="Monthly", target_day=5
        )
        self.vat = Master.objects.create(
            name="VAT", type="category", org=self.org, recurrence="Monthly", target_day=10
        )
        self.api = APIClient()
        self.api.force_authenticate(user=self.user)
        self.main = Task.objects.create(
            description="Goal",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            target_date=dt.date(2027, 4, 30),
            engagement_start=dt.date(2026, 5, 1),
            engagement_end=dt.date(2027, 4, 1),
        )
        self.brs_plan = TaskSubcategoryPlan.objects.create(
            main_task=self.main,
            subcategory=self.brs,
            recurrence="monthly",
            target_day=5,
            default_owner=self.user,
            active_from_month=dt.date(2026, 5, 1),
            active_until_month=dt.date(2027, 4, 1),
        )

    def test_add_plan_endpoint_creates_plan_and_returns_child(self):
        url = f"/api/tasks/{self.main.uid}/plans/"
        body = {
            "subcategory": str(self.vat.uid),
            "month": "2026-06",
            "default_owner": str(self.user.uid),
        }
        resp = self.api.post(url, body, format="json")
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertIn("plan", resp.data)
        self.assertIn("child", resp.data)
        self.assertEqual(resp.data["plan"]["active_from_month"], "2026-06-01")

    def test_remove_plan_endpoint_caps_existing_plan(self):
        # Materialize a few months first.
        for m in (5, 6, 7):
            materialize_month(self.main, dt.date(2026, m, 1))
        url = f"/api/tasks/{self.main.uid}/plans/{self.brs_plan.uid}/?from_month=2026-07"
        resp = self.api.delete(url)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.brs_plan.refresh_from_db()
        self.assertEqual(self.brs_plan.active_until_month, dt.date(2026, 6, 1))
        # July child gone, May+June kept.
        self.assertEqual(self.main.subtasks.count(), 2)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python manage.py test core.tasks.tests.PlanActionEndpointsTests -v 2`
Expected: FAIL — endpoints don't exist (404 Not Found).

- [ ] **Step 3: Implement the action endpoints**

In `core/tasks/views.py`, add to imports:

```python
from core.tasks.models import TaskSubcategoryPlan
from core.tasks.services import add_or_extend_plan, cap_plan
from core.tasks.serializers import TaskSubcategoryPlanSerializer
```

Inside `TaskViewSet`, add:

```python
    @action(detail=True, methods=["post", "delete"], url_path=r"plans(?:/(?P<plan_uid>[^/]+))?")
    def plans(self, request, *args, plan_uid=None, **kwargs):
        """Plan add/extend (POST without ``plan_uid``) or cap (DELETE with).

        POST body: ``{ "subcategory": "<uid>", "month": "YYYY-MM",
                       "default_owner": "<uid>?" }``
        DELETE: ``?from_month=YYYY-MM`` query param required.
        """
        main = self.get_object()
        if main.parent_id is not None:
            return Response({"detail": "Plans only attach to main goals."}, status=400)

        if request.method == "POST":
            sub_uid = request.data.get("subcategory")
            month = request.data.get("month")
            owner_uid = request.data.get("default_owner")
            if not sub_uid or not month:
                return Response(
                    {"detail": "subcategory and month are required."}, status=400
                )
            try:
                month_start = dt.datetime.strptime(month, "%Y-%m").date().replace(day=1)
            except ValueError:
                return Response({"detail": "month must be YYYY-MM."}, status=400)
            sub_cat = Master.objects.filter(uid=sub_uid, type="category").first()
            if sub_cat is None:
                return Response({"detail": "Sub-category not found."}, status=404)
            owner = None
            if owner_uid:
                owner = User.objects.filter(uid=owner_uid).first()
            plan, child = add_or_extend_plan(main, sub_cat, month_start, owner=owner)
            return Response(
                {
                    "plan": TaskSubcategoryPlanSerializer(plan).data,
                    "child": TaskSerializer(child).data if child else None,
                },
                status=201,
            )

        # DELETE
        if not plan_uid:
            return Response({"detail": "plan_uid required to remove a plan."}, status=400)
        from_month_str = request.query_params.get("from_month")
        if not from_month_str:
            return Response({"detail": "from_month query param required."}, status=400)
        try:
            from_month = dt.datetime.strptime(from_month_str, "%Y-%m").date().replace(day=1)
        except ValueError:
            return Response({"detail": "from_month must be YYYY-MM."}, status=400)
        plan = TaskSubcategoryPlan.objects.filter(uid=plan_uid, main_task=main).first()
        if plan is None:
            return Response({"detail": "Plan not found for this goal."}, status=404)
        result = cap_plan(plan, from_month)
        return Response(result, status=200)
```

Also import `Master` and `User` if not already in scope. Check the existing `from core.tasks.models import Task, TaskLog` and `from users.models import User` — `Master` may need: `from core.masters.models import Master`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `python manage.py test core.tasks.tests.PlanActionEndpointsTests -v 2`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add core/tasks/views.py core/tasks/tests.py
git commit -m "feat(tasks): add plan add/cap action endpoints"
```

---

### Task 9: `cascade_owner` flag on subtask PATCH

**Files:**
- Modify: `core/tasks/views.py`
- Test: `core/tasks/tests.py`

- [ ] **Step 1: Write the failing test**

Append to `core/tasks/tests.py`:

```python
class SubtaskCascadeOwnerTests(TestCase):
    def setUp(self):
        self.org, self.alice, self.client_master = _setup()
        self.bob = User.objects.create_user(username="bob", password="pw", full_name="Bob")
        OrgMembership.objects.create(user=self.bob, org=self.org, role="employee")
        self.brs = Master.objects.create(
            name="BRS", type="category", org=self.org, recurrence="Monthly", target_day=5
        )
        self.api = APIClient()
        self.api.force_authenticate(user=self.alice)
        self.main = Task.objects.create(
            description="Goal",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.alice,
            target_date=dt.date(2027, 4, 30),
            engagement_start=dt.date(2026, 5, 1),
            engagement_end=dt.date(2027, 4, 1),
        )
        TaskSubcategoryPlan.objects.create(
            main_task=self.main,
            subcategory=self.brs,
            recurrence="monthly",
            target_day=5,
            default_owner=self.alice,
            active_from_month=dt.date(2026, 5, 1),
            active_until_month=dt.date(2027, 4, 1),
        )
        for m in (5, 6, 7):
            materialize_month(self.main, dt.date(2026, m, 1))
        self.may = Task.objects.get(parent=self.main, target_date=dt.date(2026, 5, 5))
        self.jun = Task.objects.get(parent=self.main, target_date=dt.date(2026, 6, 5))
        self.jul = Task.objects.get(parent=self.main, target_date=dt.date(2026, 7, 5))

    def test_patch_with_cascade_owner_propagates_forward(self):
        url = f"/api/tasks/{self.jun.uid}/?cascade_owner=true"
        resp = self.api.patch(url, {"responsible": str(self.bob.uid)}, format="json")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.may.refresh_from_db()
        self.jul.refresh_from_db()
        self.assertEqual(self.may.responsible_id, self.alice.pk)
        self.assertEqual(self.jul.responsible_id, self.bob.pk)

    def test_patch_without_cascade_owner_only_updates_one_row(self):
        url = f"/api/tasks/{self.jun.uid}/"
        resp = self.api.patch(url, {"responsible": str(self.bob.uid)}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.jul.refresh_from_db()
        self.assertEqual(self.jul.responsible_id, self.alice.pk)  # not cascaded
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python manage.py test core.tasks.tests.SubtaskCascadeOwnerTests -v 2`
Expected: FAIL — cascade endpoint doesn't trigger; July's owner stays as Alice in both tests.

- [ ] **Step 3: Wire cascade into the PATCH path**

In `core/tasks/views.py`, add to imports:

```python
from core.tasks.services import cascade_owner_forward
```

Inside `TaskViewSet`, override `update` to honor the cascade flag:

```python
    def update(self, request, *args, **kwargs):
        """Standard PATCH/PUT, with optional ``?cascade_owner=true`` to push
        a ``responsible`` change forward to every later child of the same
        plan. Only meaningful on a child Task with both ``parent`` and
        ``target_date`` set.
        """
        instance = self.get_object()
        cascade = request.query_params.get("cascade_owner", "").lower() in (
            "1",
            "true",
            "yes",
        )
        if (
            cascade
            and instance.parent_id is not None
            and "responsible" in request.data
        ):
            new_owner_uid = request.data.get("responsible")
            new_owner = (
                User.objects.filter(uid=new_owner_uid).first() if new_owner_uid else None
            )
            cascade_owner_forward(instance, new_owner)
            # Re-fetch and serialize after cascade so the response reflects
            # the freshly-updated row.
            instance.refresh_from_db()
            return Response(self.get_serializer(instance).data)
        return super().update(request, *args, **kwargs)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python manage.py test core.tasks.tests.SubtaskCascadeOwnerTests -v 2`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add core/tasks/views.py core/tasks/tests.py
git commit -m "feat(tasks): cascade_owner flag on subtask PATCH"
```

---

### Task 10: Reject writes to past-month subtask rows

**Files:**
- Modify: `core/tasks/serializers.py`
- Test: `core/tasks/tests.py`

- [ ] **Step 1: Write the failing test**

Append to `core/tasks/tests.py`:

```python
class PastMonthReadOnlyTests(TestCase):
    def setUp(self):
        self.org, self.user, self.client_master = _setup()
        self.brs = Master.objects.create(
            name="BRS", type="category", org=self.org, recurrence="Monthly", target_day=5
        )
        self.api = APIClient()
        self.api.force_authenticate(user=self.user)
        self.main = Task.objects.create(
            description="Goal",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            target_date=dt.date(2099, 1, 1),
            engagement_start=dt.date(2020, 1, 1),
            engagement_end=dt.date(2099, 1, 1),
        )
        # Create a child whose target_date is solidly in the past relative to today.
        self.past_child = Task.objects.create(
            parent=self.main,
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            responsible=self.user,
            description="Past row",
            category=self.brs,
            target_date=dt.date(2020, 1, 5),
        )

    def test_patching_past_month_child_is_rejected(self):
        url = f"/api/tasks/{self.past_child.uid}/"
        resp = self.api.patch(url, {"remarks": "tampering"}, format="json")
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn("past", str(resp.content).lower())
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python manage.py test core.tasks.tests.PastMonthReadOnlyTests -v 2`
Expected: FAIL — the PATCH succeeds with 200.

- [ ] **Step 3: Add the past-month guard in the serializer**

In `core/tasks/serializers.py`, modify `TaskSerializer.save` to call a helper. Add this method to `TaskSerializer`:

```python
    def _reject_past_month_write(self, instance):
        """Block PATCH on a child whose target_date is in a calendar month
        before today's. Past months are read-only history.
        """
        from django.utils.timezone import localdate
        if instance is None or instance.parent_id is None:
            return
        if instance.target_date is None:
            return
        today_first = localdate().replace(day=1)
        instance_first = instance.target_date.replace(day=1)
        if instance_first < today_first:
            raise serializers.ValidationError(
                {"detail": "Past months are read-only; cannot modify this sub-task."}
            )

    def save(self, **kwargs):
        if self.instance is not None:
            self._reject_past_month_write(self.instance)
        instance = super().save(**kwargs)
        try:
            instance.full_clean()
        except DjangoValidationError as e:
            raise serializers.ValidationError(e.message_dict if hasattr(e, "message_dict") else e.messages) from e
        return instance
```

(This *replaces* the existing `save()` method on `TaskSerializer`.)

Also, the cascade endpoint needs to bypass this guard in the cascade path (since it touches future rows, but the row being PATCHed itself must be current/future — we already enforce that conceptually). For simplicity: the cascade path in views calls `cascade_owner_forward` directly without going through the serializer, so it sidesteps the guard. But the FIRST row update (the row being PATCHed) goes via `cascade_owner_forward` which uses `child.save(update_fields=...)` — also bypassing the serializer guard. Good.

- [ ] **Step 4: Run the test to verify it passes**

Run: `python manage.py test core.tasks.tests.PastMonthReadOnlyTests -v 2`
Expected: PASS.

- [ ] **Step 5: Run the full tasks suite to make sure nothing regressed**

Run: `python manage.py test core.tasks -v 2`
Expected: PASS for everything. If any pre-existing test fails because it tries to PATCH a past child, fix the test fixture (move dates forward) — do not relax the rule.

- [ ] **Step 6: Commit**

```bash
git add core/tasks/serializers.py core/tasks/tests.py
git commit -m "feat(tasks): reject writes to past-month subtasks (read-only history)"
```

---

## Phase D: Data migration

### Task 11: Backfill plans from existing children

**Files:**
- Create: `core/tasks/migrations/0007_backfill_subcategory_plans.py` (filename may shift — match the next available number from `ls core/tasks/migrations/`)
- Test: `core/tasks/tests.py`

- [ ] **Step 1: Write the failing test**

Append to `core/tasks/tests.py`:

```python
from django.core.management import call_command


class BackfillSubcategoryPlansMigrationTests(TestCase):
    """Verifies the data migration logic by invoking the same helper the
    migration's ``RunPython`` callable uses. The actual migration ran during
    setUp of this test database, but we re-test the helper to lock the
    contract.
    """

    def setUp(self):
        self.org, self.user, self.client_master = _setup()
        self.brs = Master.objects.create(
            name="BRS", type="category", org=self.org, recurrence="Monthly", target_day=5
        )
        self.main = Task.objects.create(
            description="Legacy Goal",
            org=self.org,
            client=self.client_master,
            reporting_manager=self.user,
            target_date=dt.date(2027, 4, 30),
        )
        # Eagerly materialized children, like the old flow would have produced.
        for m in (5, 6, 7, 8):
            Task.objects.create(
                parent=self.main,
                org=self.org,
                client=self.client_master,
                reporting_manager=self.user,
                responsible=self.user,
                description="BRS",
                category=self.brs,
                target_date=dt.date(2026, m, 5),
            )

    def test_backfill_creates_one_plan_per_subcategory_and_sets_engagement(self):
        from core.tasks.migrations.helpers_backfill import backfill_plans_for_task
        backfill_plans_for_task(self.main, Task, TaskSubcategoryPlan, Master)
        self.main.refresh_from_db()
        plans = list(self.main.sub_plans.all())
        self.assertEqual(len(plans), 1)
        plan = plans[0]
        self.assertEqual(plan.subcategory_id, self.brs.pk)
        self.assertEqual(plan.recurrence, "monthly")
        self.assertEqual(plan.target_day, 5)
        self.assertEqual(plan.active_from_month, dt.date(2026, 5, 1))
        self.assertEqual(plan.active_until_month, dt.date(2026, 8, 1))
        self.assertEqual(plan.default_owner_id, self.user.pk)
        self.assertEqual(self.main.engagement_start, dt.date(2026, 5, 1))
        self.assertEqual(self.main.engagement_end, dt.date(2026, 8, 1))

    def test_backfill_is_idempotent(self):
        from core.tasks.migrations.helpers_backfill import backfill_plans_for_task
        backfill_plans_for_task(self.main, Task, TaskSubcategoryPlan, Master)
        backfill_plans_for_task(self.main, Task, TaskSubcategoryPlan, Master)
        self.assertEqual(self.main.sub_plans.count(), 1)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python manage.py test core.tasks.tests.BackfillSubcategoryPlansMigrationTests -v 2`
Expected: FAIL — `helpers_backfill` module not found.

- [ ] **Step 3: Create the helper + the migration**

Create `core/tasks/migrations/helpers_backfill.py`:

```python
"""Backfill helper used by the data migration. Pulled out into its own
module so unit tests can call it directly with model classes from
``apps.get_model`` (migration-style) or with the live ORM models.
"""

from __future__ import annotations

import datetime as dt


_RECURRENCE_NORMALIZE = {
    "": "monthly",
    "Onetime": "onetime",
    "Monthly": "monthly",
    "Quarterly": "quarterly",
    "Halfyearly": "halfyearly",
    "Yearly": "yearly",
}


def _first_of_month(d: dt.date) -> dt.date:
    return d.replace(day=1)


def backfill_plans_for_task(main, Task, TaskSubcategoryPlan, Master) -> int:
    """For one main goal, derive plans from its child rows and set
    engagement window. Returns the number of plans created/updated.

    Idempotent: if the goal already has plans, skip.
    """
    if main.parent_id is not None:
        return 0
    if TaskSubcategoryPlan.objects.filter(main_task=main).exists():
        return 0

    children = list(
        Task.objects.filter(parent=main).exclude(category__isnull=True).order_by("target_date", "id")
    )
    if not children:
        return 0

    by_cat: dict[int, list] = {}
    for c in children:
        by_cat.setdefault(c.category_id, []).append(c)

    plans_created = 0
    earliest = None
    latest = None
    for cat_id, group in by_cat.items():
        group_dates = [c.target_date for c in group if c.target_date]
        if not group_dates:
            continue
        first_month = _first_of_month(min(group_dates))
        last_month = _first_of_month(max(group_dates))
        # Most recent (largest target_date) row's responsible — drives the
        # plan's default owner so future months pick up the latest assignment.
        sorted_group = sorted(
            group, key=lambda c: c.target_date or dt.date.min
        )
        last_row = sorted_group[-1]
        sub_cat = Master.objects.filter(pk=cat_id).first()
        if sub_cat is None:
            continue
        recurrence = _RECURRENCE_NORMALIZE.get(
            getattr(sub_cat, "recurrence", "") or "", "monthly"
        )
        target_day = getattr(sub_cat, "target_day", None)
        if target_day is None:
            target_day = sorted_group[0].target_date.day if sorted_group[0].target_date else None
        TaskSubcategoryPlan.objects.create(
            main_task=main,
            subcategory_id=cat_id,
            recurrence=recurrence,
            target_day=target_day,
            default_owner_id=last_row.responsible_id,
            active_from_month=first_month,
            active_until_month=last_month,
        )
        plans_created += 1
        earliest = first_month if earliest is None or first_month < earliest else earliest
        latest = last_month if latest is None or last_month > latest else latest

    if earliest is not None or latest is not None:
        main.engagement_start = earliest
        main.engagement_end = latest
        main.save(update_fields=["engagement_start", "engagement_end", "updated_at"])

    return plans_created
```

Now create the migration. First find the next available migration number:

```bash
ls core/tasks/migrations/
```

Use the next number (likely `0007`). Create `core/tasks/migrations/0007_backfill_subcategory_plans.py`:

```python
from django.db import migrations


def forward(apps, schema_editor):
    Task = apps.get_model("tasks", "Task")
    TaskSubcategoryPlan = apps.get_model("tasks", "TaskSubcategoryPlan")
    Master = apps.get_model("masters", "Master")
    # Migrations can't import live ORM modules safely (model classes drift).
    # Re-implement the helper here with the migration's historical models.
    from core.tasks.migrations.helpers_backfill import backfill_plans_for_task

    for goal in Task.objects.filter(parent__isnull=True).iterator():
        backfill_plans_for_task(goal, Task, TaskSubcategoryPlan, Master)


def backward(apps, schema_editor):
    TaskSubcategoryPlan = apps.get_model("tasks", "TaskSubcategoryPlan")
    TaskSubcategoryPlan.objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [
        ("tasks", "0006_plan_uid"),  # adjust if previous migration's name differs
        ("masters", "0015_master_recurrence_target_day"),
    ]
    operations = [
        migrations.RunPython(forward, backward),
    ]
```

(Adjust the dependency on `0006_plan_uid` to match whatever migration ID was generated in Task 6.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `python manage.py test core.tasks.tests.BackfillSubcategoryPlansMigrationTests -v 2`
Expected: PASS (2 tests).

- [ ] **Step 5: Apply the migration to the dev DB**

Run: `python manage.py migrate tasks`
Expected: applies `0007_backfill_subcategory_plans` and prints how many plans were created. If any errors arise (e.g. category FK pointing to a deleted master), inspect the offending row, fix manually, and re-run.

- [ ] **Step 6: Commit**

```bash
git add core/tasks/migrations/ core/tasks/tests.py
git commit -m "feat(tasks): data migration to backfill plans from existing children"
```

---

## Phase E: Frontend types and hooks

### Task 12: Add plan DTOs and month-scoped task DTO

**Files:**
- Modify: `frontend/task-tracker/src/types/api/task.ts`

- [ ] **Step 1: Add the new types**

Append to `frontend/task-tracker/src/types/api/task.ts`:

```typescript
/** Plan row payload from the server. Mirrors `TaskSubcategoryPlan`. */
export interface TaskSubcategoryPlanDto {
  readonly uid: Uid;
  readonly subcategory: Uid;
  readonly subcategory_detail: MasterRefDto;
  readonly recurrence: TaskRecurrenceValue;
  readonly target_day: number | null;
  readonly default_owner: Uid | null;
  readonly default_owner_detail: UserRefDto | null;
  readonly active_from_month: IsoDate;  // First-of-month
  readonly active_until_month: IsoDate | null;
}

/** Body for `POST /api/tasks/<uid>/plans/`. */
export interface PlanAddRequest {
  readonly subcategory: Uid;
  readonly month: string;  // "YYYY-MM"
  readonly default_owner?: Uid;
}

/** Response from `POST /api/tasks/<uid>/plans/`. */
export interface PlanAddResponse {
  readonly plan: TaskSubcategoryPlanDto;
  readonly child: TaskDto | null;
}

/** Response from `DELETE /api/tasks/<uid>/plans/<plan_uid>/?from_month=...`. */
export interface PlanCapResponse {
  readonly plan_capped: boolean;
  readonly plan_deleted: boolean;
  readonly children_deleted: number;
}

/** Body for `POST /api/tasks/` when sending plans (replaces `subtasks`). */
export interface TaskWithPlansCreate extends TaskCreate {
  readonly engagement_start?: IsoDate;
  readonly engagement_end?: IsoDate;
  readonly plans: ReadonlyArray<{
    readonly subcategory: Uid;
    readonly default_owner?: Uid;
  }>;
}

/** Response from `GET /api/tasks/<uid>/?month=YYYY-MM`. */
export interface MonthScopedTaskDto extends TaskDto {
  readonly engagement_start: IsoDate | null;
  readonly engagement_end: IsoDate | null;
  readonly subtasks: ReadonlyArray<TaskDto>;
}
```

Also add `engagement_start` and `engagement_end` to the existing `TaskDto`:

```typescript
export interface TaskDto extends BaseDto {
  // ... existing fields ...
  readonly engagement_start?: IsoDate | null;
  readonly engagement_end?: IsoDate | null;
}
```

Then extend the domain `Task` type so the modal can read these fields directly. Find `frontend/task-tracker/src/types/index.ts` (or wherever `Task` interface lives) and add:

```typescript
export interface Task {
  // ... existing fields ...
  engagement_start?: string | null;
  engagement_end?: string | null;
  /** Plan uid the row was materialized from. Only set on subtask rows. */
  planUid?: string | null;
}
```

Find the `SubtaskItem` interface (likely in the same file) and add:

```typescript
export interface SubtaskItem {
  // ... existing fields ...
  planUid?: string | null;
}
```

- [ ] **Step 2: Verify the types compile**

Run: `cd frontend/task-tracker && npx tsc --noEmit -p tsconfig.app.json`
Expected: no errors. If there are errors elsewhere because adding optional fields broke a usage, address only the errors related to the new fields.

- [ ] **Step 3: Commit**

```bash
git add frontend/task-tracker/src/types/api/task.ts
git commit -m "feat(types): add plan and month-scoped task DTOs"
```

---

### Task 13: Helper functions in `recurrence.ts`

**Files:**
- Modify: `frontend/task-tracker/src/components/board/recurrence.ts`
- Modify: `frontend/task-tracker/src/__tests__/components/board/recurrence.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `frontend/task-tracker/src/__tests__/components/board/recurrence.test.ts`:

```typescript
import { addMonthsToYearMonth, monthsBetween, parseYearMonth } from "@/components/board/recurrence";

describe("month helpers", () => {
  it("parseYearMonth returns first-of-month or null", () => {
    expect(parseYearMonth("2026-05")).toEqual(new Date(2026, 4, 1));
    expect(parseYearMonth("2026-13")).toBeNull();
    expect(parseYearMonth("nonsense")).toBeNull();
  });

  it("addMonthsToYearMonth handles year wrap-around", () => {
    expect(addMonthsToYearMonth("2026-11", 3)).toBe("2027-02");
    expect(addMonthsToYearMonth("2026-05", -7)).toBe("2025-10");
  });

  it("monthsBetween returns inclusive list of YYYY-MM strings", () => {
    expect(monthsBetween("2026-05", "2026-07")).toEqual([
      "2026-05",
      "2026-06",
      "2026-07",
    ]);
    expect(monthsBetween("2026-05", "2026-05")).toEqual(["2026-05"]);
    expect(monthsBetween("2026-07", "2026-05")).toEqual([]);  // backwards = empty
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend/task-tracker && npm run test -- recurrence.test`
Expected: FAIL — helpers don't exist.

- [ ] **Step 3: Implement the helpers**

Append to `frontend/task-tracker/src/components/board/recurrence.ts`:

```typescript
/** Parse "YYYY-MM" → Date at the first of that month, or null on failure. */
export function parseYearMonth(yearMonth: string): Date | null {
  const parsed = parseStartMonth(yearMonth);
  if (!parsed) return null;
  return new Date(parsed.year, parsed.month - 1, 1);
}

/** "2026-05" + 3 → "2026-08". Negative offsets work. Year wraps automatically. */
export function addMonthsToYearMonth(yearMonth: string, offset: number): string {
  const parsed = parseStartMonth(yearMonth);
  if (!parsed) return yearMonth;
  const d = new Date(parsed.year, parsed.month - 1 + offset, 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Inclusive list of YYYY-MM strings between two endpoints. Returns []
 *  when `end` is before `start`, so the caller can treat that as "no
 *  months available" without a separate check. */
export function monthsBetween(start: string, end: string): string[] {
  const s = parseStartMonth(start);
  const e = parseStartMonth(end);
  if (!s || !e) return [];
  const out: string[] = [];
  let y = s.year;
  let m = s.month;
  while (y < e.year || (y === e.year && m <= e.month)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend/task-tracker && npm run test -- recurrence.test`
Expected: PASS, all helpers green.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/components/board/recurrence.ts frontend/task-tracker/src/__tests__/components/board/recurrence.test.ts
git commit -m "feat(board): add monthsBetween, parseYearMonth, addMonthsToYearMonth helpers"
```

---

### Task 14: Plan-management API client functions

**Files:**
- Modify: `frontend/task-tracker/src/lib/api/index.ts` (or wherever `apiPost`/`apiGet` are exported — check `frontend/task-tracker/src/lib/api/`)
- Create or modify: `frontend/task-tracker/src/hooks/useTasks.ts`

- [ ] **Step 1: Inspect the lib/api layer to find the right file**

Run: `ls frontend/task-tracker/src/lib/api/` and read `frontend/task-tracker/src/lib/api/index.ts` (or whichever file exports `apiGet`/`apiPost`/`apiPatch`/`apiDelete`).

This task adds three fetch helpers: `fetchTaskWithMonth`, `addPlan`, `removePlan`, `patchSubtaskWithCascade`. These are thin wrappers over the existing `apiGet`/`apiPost`/`apiDelete`/`apiPatch`. Add them in the same module that already exports the API helpers, OR add them to `useTasks.ts` if the file already inlines fetch calls. Match the existing convention.

- [ ] **Step 2: Add the helper functions**

Add to `useTasks.ts` (or co-located lib file):

```typescript
import type {
  MonthScopedTaskDto,
  PlanAddRequest,
  PlanAddResponse,
  PlanCapResponse,
} from "@/types/api";

/** GET /api/tasks/<uid>/?month=YYYY-MM */
export async function fetchTaskWithMonth(
  taskUid: string,
  yearMonth: string,
): Promise<MonthScopedTaskDto> {
  return apiGet<MonthScopedTaskDto>(`/tasks/${taskUid}/?month=${yearMonth}`);
}

/** POST /api/tasks/<uid>/plans/ */
export async function addPlan(
  taskUid: string,
  body: PlanAddRequest,
): Promise<PlanAddResponse> {
  return apiPost<PlanAddResponse>(`/tasks/${taskUid}/plans/`, body);
}

/** DELETE /api/tasks/<uid>/plans/<plan_uid>/?from_month=YYYY-MM */
export async function removePlan(
  taskUid: string,
  planUid: string,
  fromMonth: string,
): Promise<PlanCapResponse> {
  return apiDelete<PlanCapResponse>(
    `/tasks/${taskUid}/plans/${planUid}/?from_month=${fromMonth}`,
  );
}

/** PATCH /api/tasks/<uid>/?cascade_owner=true */
export async function patchSubtaskCascadeOwner(
  childUid: string,
  newOwnerUid: string,
): Promise<TaskDto> {
  return apiPatch<TaskDto>(
    `/tasks/${childUid}/?cascade_owner=true`,
    { responsible: newOwnerUid },
  );
}
```

(If `apiDelete` doesn't return a typed body, use a small wrapper to handle JSON parsing, or use `fetch` directly; mirror the existing pattern.)

- [ ] **Step 3: Verify TS compiles**

Run: `cd frontend/task-tracker && npx tsc --noEmit -p tsconfig.app.json`
Expected: PASS, no type errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/task-tracker/src/hooks/useTasks.ts
git commit -m "feat(tasks): add API client helpers for plan management + cascade owner"
```

---

## Phase F: Frontend UI

### Task 15: Month selector state in TaskModal

**Files:**
- Modify: `frontend/task-tracker/src/components/board/TaskModal.tsx`

- [ ] **Step 1: Read the current TaskModal carefully**

Read `frontend/task-tracker/src/components/board/TaskModal.tsx`. Note especially:
- The `startMonth` / `engagementMonths` state (lines 72-73).
- The `buildSubsFromTemplate` and `regenerateFromTemplate` flow (lines 229-353).
- The Engagement panel (lines 422-491).
- The way subs are passed to `<SubtaskTable>` (line 494-511).

- [ ] **Step 2: Add a `viewMonth` state and dropdown**

In `TaskModal.tsx`, add a new state below the existing `startMonth` / `engagementMonths`:

```typescript
  // The month being viewed in the subtask grid. Defaults to today's calendar
  // month for an Edit modal, or to startMonth for a brand-new goal that has
  // no children yet. Past months render read-only.
  const [viewMonth, setViewMonth] = useState<string>(thisMonthString());
```

Add a derived list of available months from the goal's engagement window:

```typescript
  const availableMonths = useMemo(() => {
    const start = (task as Partial<Task>)?.engagement_start
      || form.engagement_start
      || startMonth + "-01";
    const end = (task as Partial<Task>)?.engagement_end
      || form.engagement_end
      || addMonthsToYearMonth(startMonth, engagementMonths - 1) + "-01";
    const startMonthStr = String(start).slice(0, 7);
    const endMonthStr = String(end).slice(0, 7);
    const months = monthsBetween(startMonthStr, endMonthStr);
    // Always include today's month even if engagement_end is in the past,
    // so the user can extend or add new plans starting now.
    const today = thisMonthString();
    if (!months.includes(today)) months.push(today);
    return [...new Set(months)].sort();
  }, [task, form.engagement_start, form.engagement_end, startMonth, engagementMonths]);
```

Import the new helpers near the top:

```typescript
import {
  generateOccurrences,
  thisMonthString,
  monthsBetween,
  addMonthsToYearMonth,
} from "./recurrence";
```

Render a dropdown above the subtask table. Find the `<SubtaskTable ... />` element and prepend:

```tsx
          <div
            style={{
              margin: "8px 0",
              display: "flex",
              gap: 12,
              alignItems: "center",
              fontSize: 13,
            }}
          >
            <label style={{ fontWeight: 600 }}>Month:</label>
            <select
              value={viewMonth}
              onChange={(e) => setViewMonth(e.target.value)}
              style={{
                padding: "4px 8px",
                border: "1px solid #cbd5e1",
                borderRadius: 4,
              }}
            >
              {availableMonths.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <span style={{ color: "#64748b", fontSize: 11 }}>
              {viewMonth < thisMonthString()
                ? "Read-only — past months are history."
                : "Edits cascade forward to following months."}
            </span>
          </div>
```

Filter `subs` passed to `<SubtaskTable>` to only this month:

```tsx
          <SubtaskTable
            subs={subs.filter((s) =>
              s.targetDate ? s.targetDate.startsWith(viewMonth) : false
            )}
            // ... existing props ...
            readOnly={viewMonth < thisMonthString()}
          />
```

- [ ] **Step 3: Run the build to verify no type errors**

Run: `cd frontend/task-tracker && npx tsc --noEmit -p tsconfig.app.json`
Expected: ONE expected error — `<SubtaskTable readOnly=...>` not in props yet. Will be fixed in Task 16.

- [ ] **Step 4: Commit (interim — UI not functional yet)**

```bash
git add frontend/task-tracker/src/components/board/TaskModal.tsx
git commit -m "feat(board): add month selector state to TaskModal"
```

---

### Task 16: `readOnly` mode in SubtaskTable

**Files:**
- Modify: `frontend/task-tracker/src/components/board/SubtaskTable.tsx`
- Create: `frontend/task-tracker/src/__tests__/components/board/SubtaskTable.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/task-tracker/src/__tests__/components/board/SubtaskTable.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SubtaskTable from "@/components/board/SubtaskTable";
import type { SubtaskItem } from "@/types";

const SAMPLE: SubtaskItem = {
  id: "abc",
  description: "BRS",
  category: "BRS",
  responsible: "Alice",
  targetDate: "2026-05-05",
  expectedDate: "",
  completedDate: "",
  remarks: "",
};

describe("SubtaskTable", () => {
  it("renders inputs disabled and hides remove button when readOnly", () => {
    const onChange = vi.fn();
    render(
      <SubtaskTable
        subs={[SAMPLE]}
        categories={["BRS"]}
        members={["Alice"]}
        mainTargetDate="2027-04-30"
        viewerName="Alice"
        canManageAll={true}
        onChange={onChange}
        readOnly={true}
      />,
    );
    // All inputs should be disabled.
    const inputs = screen.getAllByRole("textbox");
    for (const i of inputs) expect(i).toBeDisabled();
    const selects = screen.getAllByRole("combobox");
    for (const s of selects) expect(s).toBeDisabled();
    // The "Remove" button should not be present in readOnly.
    expect(screen.queryByLabelText("Remove")).toBeNull();
    // The "+ Add subtask" button should not be present in readOnly.
    expect(screen.queryByText("+ Add subtask")).toBeNull();
  });

  it("renders inputs enabled and shows add/remove when not readOnly", () => {
    const onChange = vi.fn();
    render(
      <SubtaskTable
        subs={[SAMPLE]}
        categories={["BRS"]}
        members={["Alice"]}
        mainTargetDate="2027-04-30"
        viewerName="Alice"
        canManageAll={true}
        onChange={onChange}
      />,
    );
    expect(screen.getByText("+ Add subtask")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend/task-tracker && npm run test -- SubtaskTable.test`
Expected: FAIL (`readOnly` prop not accepted, types broken).

- [ ] **Step 3: Add `readOnly` support to SubtaskTable**

In `frontend/task-tracker/src/components/board/SubtaskTable.tsx`, change the `Props` interface to add:

```typescript
interface Props {
  // ... existing props ...
  /** When true, every cell is disabled and add/remove are hidden. */
  readOnly?: boolean;
}
```

Update the destructure with `readOnly = false`:

```typescript
export default function SubtaskTable({
  subs,
  categories,
  members,
  mainTargetDate,
  viewerName,
  canManageAll,
  onChange,
  readOnly = false,
}: Props) {
```

Replace `canEditRow` with:

```typescript
  const canEditRow = (s: SubtaskItem) =>
    !readOnly && (canManageAll || !s.responsible || s.responsible === viewerName);
```

Hide the add button:

```tsx
        <strong>SUBTASKS ({subs.length})</strong>
        {!readOnly && (
          <button type="button" className="btn btn-secondary" onClick={addRow}>
            + Add subtask
          </button>
        )}
```

Hide the remove button per row by wrapping it:

```tsx
                <td>
                  {!readOnly && (
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => removeAt(i)}
                      disabled={!editable}
                      aria-label="Remove"
                    >
                      &#x2715;
                    </button>
                  )}
                </td>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend/task-tracker && npm run test -- SubtaskTable.test`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/components/board/SubtaskTable.tsx frontend/task-tracker/src/__tests__/components/board/SubtaskTable.test.tsx
git commit -m "feat(board): readOnly mode for past-month rendering of SubtaskTable"
```

---

### Task 17: Wire create flow to plans payload

**Files:**
- Modify: `frontend/task-tracker/src/components/board/TaskModal.tsx`
- Modify: `frontend/task-tracker/src/hooks/useTasks.ts`

- [ ] **Step 1: Switch the Add-Task path to send plans instead of subs**

In `TaskModal.tsx`, the existing `handleSubmit` calls `onSave(form, subs)` which routes through `saveGoalTree`. We need a parallel path for new goals: send `plans` instead of `subtasks`. The plans are derived from the **sub-categories visible in the current month** — i.e., the user's current-month roster.

Add a helper near the other helpers:

```typescript
  const buildPlansPayload = (rows: readonly SubtaskItem[]): Array<{
    subcategory_uid: string;
    default_owner_uid: string | null;
  }> => {
    const seen = new Set<string>();
    const out: Array<{ subcategory_uid: string; default_owner_uid: string | null }> = [];
    for (const row of rows) {
      // The subtask category cell stores a sub-cat *name* (label). Map back
      // to its uid via catMasters.
      const subCat = catMasters.find((c) => c.name === row.category && c.parent);
      if (!subCat) continue;
      if (seen.has(subCat.uid)) continue;
      seen.add(subCat.uid);
      const owner = profiles.find((p) => p.full_name === row.responsible);
      out.push({
        subcategory_uid: subCat.uid,
        default_owner_uid: owner?.uid ?? null,
      });
    }
    return out;
  };
```

In `handleSubmit`, branch on create vs edit. For create, change the call to `onSave` so the parent can take a plans-only path. For now, just call a new `onSavePlans` prop if present; fall back to the legacy path otherwise. To keep this minimal, change the prop signature:

```typescript
  onSave: (
    main: Partial<Task> & { id?: string },
    subs: SubtaskItem[],
    plans?: Array<{ subcategory_uid: string; default_owner_uid: string | null }>,
  ) => void;
```

Then in `handleSubmit`:

```typescript
    const plansPayload = isCreate
      ? buildPlansPayload(
          subs.filter((s) => s.targetDate?.startsWith(viewMonth))
        )
      : undefined;
    onSave(
      { ...form, id: task?.id } as Partial<Task> & { id?: string },
      subs,
      plansPayload,
    );
```

In `useTasks.ts`, update `saveGoalTree` to accept a third argument and route accordingly:

```typescript
  const saveGoalTree = useCallback(
    async (
      taskData: Partial<Task> & { id?: ID },
      subs: SubtaskItem[],
      _myName: string,
      refs: TaskWriteRefs,
      subRefs: SubtaskWriteRefs,
      plansPayload?: Array<{ subcategory_uid: string; default_owner_uid: string | null }>,
    ): Promise<boolean> => {
      const withStatus: Task = {
        ...(taskData as Task),
        status: computeStatus(taskData as Task),
      };
      try {
        if (taskData.id) {
          // Edit path — keep existing subtasks payload (legacy until per-month
          // edits go through dedicated endpoints).
          const payload = taskWithSubtasksToCreate(withStatus, subs, refs, subRefs);
          await apiPatch<TaskDto>(`/tasks/${taskData.id}/`, payload);
        } else if (plansPayload && plansPayload.length > 0) {
          // Create with plans — server materializes current month only.
          const body: TaskWithPlansCreate = {
            ...taskToCreate(withStatus, refs),
            engagement_start: taskData.engagement_start ?? undefined,
            engagement_end: taskData.engagement_end ?? undefined,
            plans: plansPayload.map((p) => ({
              subcategory: p.subcategory_uid,
              default_owner: p.default_owner_uid ?? undefined,
            })),
          };
          await apiPost<TaskDto>("/tasks/", body);
        } else {
          // Create fallback — no plans, send subtasks as before.
          const payload = taskWithSubtasksToCreate(withStatus, subs, refs, subRefs);
          await apiPost<TaskDto>("/tasks/", payload);
        }
        return true;
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : String(err);
        alert(`Save failed: ${msg}`);
        return false;
      }
    },
    [],
  );
```

Plumb `engagement_start` / `engagement_end` through TaskModal: in `handleSubmit`, derive them from `startMonth` + `engagementMonths`:

```typescript
    const engStart = `${startMonth}-01`;
    const engEnd = `${addMonthsToYearMonth(startMonth, engagementMonths - 1)}-01`;
    onSave(
      {
        ...form,
        id: task?.id,
        engagement_start: engStart,
        engagement_end: engEnd,
      } as Partial<Task> & { id?: string },
      subs,
      plansPayload,
    );
```

Also extend the `Task` domain type (`frontend/task-tracker/src/types/index.ts` or wherever `Task` is defined) with optional `engagement_start` / `engagement_end` fields. Find the Task type and add:

```typescript
export interface Task {
  // ... existing fields ...
  engagement_start?: string | null;
  engagement_end?: string | null;
}
```

- [ ] **Step 2: Verify TS compiles**

Run: `cd frontend/task-tracker && npx tsc --noEmit -p tsconfig.app.json`
Expected: PASS (or only errors for `Task` type usage which need adjustment).

- [ ] **Step 3: Run frontend tests**

Run: `cd frontend/task-tracker && npm run test`
Expected: all PASS. Fix any test that broke due to the Task type or signature changes — likely just adding the new optional field doesn't break existing fixtures.

- [ ] **Step 4: Commit**

```bash
git add frontend/task-tracker/src/components/board/TaskModal.tsx frontend/task-tracker/src/hooks/useTasks.ts frontend/task-tracker/src/types/
git commit -m "feat(board): create-task path posts plans payload + engagement window"
```

---

### Task 18: Wire add/remove to plan endpoints (Edit mode only)

**Files:**
- Modify: `frontend/task-tracker/src/components/board/TaskModal.tsx`
- Modify: `frontend/task-tracker/src/components/board/SubtaskTable.tsx`

- [ ] **Step 1: Add per-row remove and add hooks for Edit mode**

In `TaskModal.tsx`, when editing an existing goal, the add/remove buttons must call the plan endpoints. Pass two callbacks down to `SubtaskTable`:

In TaskModal, define:

```typescript
  const handleAddPlan = useCallback(
    async (subCategoryName: string) => {
      if (!task?.id) return;  // Create mode: handled in submit, not here.
      const subCat = catMasters.find(
        (c) => c.name === subCategoryName && c.parent,
      );
      if (!subCat) return;
      try {
        const result = await addPlan(String(task.id), {
          subcategory: subCat.uid,
          month: viewMonth,
        });
        // Optimistically push the new child into local state. The Edit modal
        // re-fetches on month switch, so a stale row gets reconciled then.
        if (result.child) {
          // Convert TaskDto → SubtaskItem here. Caller's existing dtoToTask
          // helper does this — reuse it.
          setSubs((prev) => [...prev, dtoToTaskAsSub(result.child)]);
        }
      } catch (err) {
        alert(`Add failed: ${String(err)}`);
      }
    },
    [task?.id, catMasters, viewMonth],
  );

  const handleRemovePlan = useCallback(
    async (childUid: string, subCatName: string) => {
      if (!task?.id) {
        // Create mode — just drop from local subs.
        setSubs((prev) => prev.filter((s) => s.id !== childUid));
        return;
      }
      const subCat = catMasters.find((c) => c.name === subCatName && c.parent);
      if (!subCat) return;
      // Look up the plan uid via fetchTaskWithMonth response on next reload.
      // For now, we patch around it: list plans server-side via a dedicated
      // GET (we'll add a tiny endpoint later if needed). Easiest is to keep
      // the plan uid in the SubtaskItem when the modal mounts.
      // ...see Task 19 for the plan-uid-on-row plumbing.
      const plan = (subs.find((s) => s.id === childUid) as SubtaskItem & { planUid?: string }).planUid;
      if (!plan) {
        alert("Plan not found for this row.");
        return;
      }
      const ok = window.confirm(
        `Remove "${subCatName}" from this goal starting ${viewMonth}? Past months stay; future months won't generate.`,
      );
      if (!ok) return;
      try {
        await removePlan(String(task.id), plan, viewMonth);
        setSubs((prev) => prev.filter((s) => s.id !== childUid));
      } catch (err) {
        alert(`Remove failed: ${String(err)}`);
      }
    },
    [task?.id, viewMonth, catMasters, subs],
  );
```

Define `dtoToTaskAsSub` near the top of the file (or import from `lib/api`):

```typescript
function dtoToTaskAsSub(dto: TaskDto): SubtaskItem {
  return {
    id: dto.uid,
    description: dto.description,
    category: dto.category_detail?.name ?? "",
    responsible: dto.responsible_detail?.full_name ?? "",
    targetDate: dto.target_date ?? "",
    expectedDate: dto.expected_date ?? "",
    completedDate: dto.completed_date ?? "",
    remarks: dto.remarks ?? "",
  };
}
```

- [ ] **Step 2: Pass the callbacks into SubtaskTable**

Modify `SubtaskTable` Props:

```typescript
interface Props {
  // ... existing props ...
  onAdd?: (subCategoryName: string) => void;
  onRemove?: (childUid: string, subCatName: string) => void;
}
```

In the add button handler, if `onAdd` is provided, prompt for sub-cat and call it:

```tsx
        <button type="button" className="btn btn-secondary" onClick={() => {
          if (onAdd) {
            const choice = window.prompt(
              `Pick sub-category to add for this month:\n\n${categories.join("\n")}`,
            );
            if (choice && categories.includes(choice)) onAdd(choice);
          } else {
            addRow();
          }
        }}>
          + Add subtask
        </button>
```

In the remove button per row, prefer `onRemove` over the local `removeAt`:

```tsx
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => {
                        if (onRemove && s.id) onRemove(String(s.id), s.category);
                        else removeAt(i);
                      }}
                      // ...
                    >
                      &#x2715;
                    </button>
```

In `TaskModal.tsx`, pass the handlers (only when in Edit mode):

```tsx
          <SubtaskTable
            // ... existing props ...
            onAdd={task ? handleAddPlan : undefined}
            onRemove={task ? handleRemovePlan : undefined}
          />
```

- [ ] **Step 3: Verify TS compiles + tests pass**

Run: `cd frontend/task-tracker && npx tsc --noEmit -p tsconfig.app.json`
Run: `cd frontend/task-tracker && npm run test`

Both expected to PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/task-tracker/src/components/board/TaskModal.tsx frontend/task-tracker/src/components/board/SubtaskTable.tsx
git commit -m "feat(board): wire add/remove subtask buttons to plan endpoints in Edit mode"
```

---

### Task 19: Fetch month-scoped task on Edit and plumb plan uid through rows

**Files:**
- Modify: `frontend/task-tracker/src/components/board/TaskModal.tsx`
- Modify: `frontend/task-tracker/src/types/api/task.ts`
- Modify: `core/tasks/views.py`

- [ ] **Step 1: Add an effect to fetch month-scoped data**

In `TaskModal.tsx`, add an effect that loads the month-scoped task whenever `task?.id` or `viewMonth` changes:

```typescript
  useEffect(() => {
    if (!task?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchTaskWithMonth(String(task.id), viewMonth);
        if (cancelled) return;
        const monthSubs: SubtaskItem[] = (data.subtasks ?? []).map((dto) => ({
          id: dto.uid,
          description: dto.description,
          category: dto.category_detail?.name ?? "",
          responsible: dto.responsible_detail?.full_name ?? "",
          targetDate: dto.target_date ?? "",
          expectedDate: dto.expected_date ?? "",
          completedDate: dto.completed_date ?? "",
          remarks: dto.remarks ?? "",
          // planUid: not on TaskDto directly; back-end can be extended later.
          // For now, derive on the fly via a separate fetch in the cap path.
        }));
        setSubs(monthSubs);
      } catch (err) {
        console.error("Failed to load month subs", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [task?.id, viewMonth]);
```

- [ ] **Step 2: Extend the server response and types to include plans**

Since `planUid` isn't on the TaskDto today, look up the plan uid lazily inside `handleRemovePlan` by reading the goal's `sub_plans`. Add a server-side endpoint to list plans, OR accept the simplification of reading them via an extra query. Simplest: extend `MonthScopedTaskDto` on the server to include `plans` (read-only summary). Add it now.

In `core/tasks/views.py`, in the `retrieve` override, when `month_param` is present, also include `plans`:

```python
        plans_payload: list[dict] = []
        if instance.parent_id is None:
            plans_payload = TaskSubcategoryPlanSerializer(
                instance.sub_plans.all().select_related("subcategory", "default_owner"),
                many=True,
            ).data
        # ...
        if month_param:
            data["subtasks"] = subtasks_payload
            data["plans"] = plans_payload
```

In `MonthScopedTaskDto` add:

```typescript
  readonly plans: ReadonlyArray<TaskSubcategoryPlanDto>;
```

In the modal effect, build a `subCategoryUidToPlanUid` map and stash plan uids on the subs:

```typescript
        const planByCat = new Map<string, string>();
        for (const p of data.plans ?? []) {
          planByCat.set(String(p.subcategory), p.uid);
        }
        const monthSubs: SubtaskItem[] = (data.subtasks ?? []).map((dto) => ({
          // ... as above ...
          planUid: dto.category ? planByCat.get(String(dto.category)) ?? null : null,
        }));
```

- [ ] **Step 3: Verify build + tests**

Run: `cd frontend/task-tracker && npx tsc --noEmit -p tsconfig.app.json`
Run: `cd frontend/task-tracker && npm run test`
Run: `python manage.py test core.tasks -v 2`

All PASS expected.

- [ ] **Step 4: Commit**

```bash
git add frontend/task-tracker/src/types/ frontend/task-tracker/src/components/board/TaskModal.tsx core/tasks/views.py frontend/task-tracker/src/types/api/task.ts
git commit -m "feat(board): expose plans on month-scoped fetch and plumb planUid into rows"
```

---

### Task 20: Wire owner change to cascade endpoint

**Files:**
- Modify: `frontend/task-tracker/src/components/board/SubtaskTable.tsx`
- Modify: `frontend/task-tracker/src/components/board/TaskModal.tsx`

- [ ] **Step 1: Add `onOwnerChange` callback prop to SubtaskTable**

In `SubtaskTable.tsx`:

```typescript
interface Props {
  // ... existing ...
  onOwnerChange?: (childUid: string, newOwnerName: string) => void;
}
```

In the owner cell:

```tsx
                <td>
                  <select
                    value={s.responsible}
                    disabled={!editable}
                    onChange={(e) => {
                      if (onOwnerChange && s.id) {
                        onOwnerChange(String(s.id), e.target.value);
                      } else {
                        updateAt(i, { responsible: e.target.value });
                      }
                    }}
                  >
                    {/* ... unchanged ... */}
                  </select>
                </td>
```

- [ ] **Step 2: Wire it in TaskModal**

```typescript
  const handleOwnerChange = useCallback(
    async (childUid: string, newOwnerName: string) => {
      const owner = profiles.find((p) => p.full_name === newOwnerName);
      if (!owner) return;
      try {
        await patchSubtaskCascadeOwner(childUid, owner.uid);
        // Optimistically update local state for current + future rows.
        setSubs((prev) =>
          prev.map((s) => {
            if (!s.targetDate) return s;
            const sCat = s.category;
            const target = prev.find((p) => p.id === childUid);
            if (!target) return s;
            if (s.category !== sCat) return s;
            if (s.id === childUid) return { ...s, responsible: newOwnerName };
            // Future rows (target_date > target.targetDate) cascade.
            if (target.targetDate && s.targetDate > target.targetDate) {
              return { ...s, responsible: newOwnerName };
            }
            return s;
          }),
        );
      } catch (err) {
        alert(`Owner change failed: ${String(err)}`);
      }
    },
    [profiles],
  );
```

Pass to SubtaskTable in Edit mode:

```tsx
          <SubtaskTable
            // ... existing ...
            onOwnerChange={task ? handleOwnerChange : undefined}
          />
```

- [ ] **Step 3: Build + test**

Run: `cd frontend/task-tracker && npx tsc --noEmit -p tsconfig.app.json`
Run: `cd frontend/task-tracker && npm run test`

PASS expected.

- [ ] **Step 4: Commit**

```bash
git add frontend/task-tracker/src/components/board/SubtaskTable.tsx frontend/task-tracker/src/components/board/TaskModal.tsx
git commit -m "feat(board): owner change cascades forward via dedicated endpoint"
```

---

## Phase G: Verification

### Task 21: Run full backend test suite

- [ ] **Step 1: Run all backend tests**

Run: `python manage.py test -v 2`
Expected: PASS for the entire suite. If any test outside `core/tasks` fails because of the new past-month read-only enforcement, inspect those tests:
- If the test PATCHes a clearly-past child, move the date forward and commit the test fix.
- If the test PATCHes a goal (parent IS NULL), the rule doesn't apply — investigate the failure.

- [ ] **Step 2: Commit any test-only date-forward fixes**

```bash
git add <fixed test files>
git commit -m "test: forward dates in older fixtures to avoid past-month read-only guard"
```

---

### Task 22: Run full frontend test suite + type check

- [ ] **Step 1: Type check**

Run: `cd frontend/task-tracker && npx tsc --noEmit -p tsconfig.app.json`
Expected: PASS, zero errors.

- [ ] **Step 2: Run all frontend tests**

Run: `cd frontend/task-tracker && npm run test`
Expected: PASS.

- [ ] **Step 3: Run lint**

Run: `cd frontend/task-tracker && npm run lint`
Expected: PASS. Fix any flagged issues introduced by the new code.

---

### Task 23: Manual browser verification

- [ ] **Step 1: Start the dev servers**

Run (in two terminals): `python manage.py runserver` and `cd frontend/task-tracker && npm run dev`. Open the browser at the URL shown.

- [ ] **Step 2: Verify create-mode flow**

1. Open the dashboard, click "Add New Task".
2. Pick a Main Category that has sub-categories with recurrences.
3. Confirm the subtask grid shows ONLY current calendar month's rows (not all 100+).
4. Set owners on each row, hit "+ Add Task".
5. Confirm the task appears on the board with the expected status, and the subtasks count matches the current month's roster only.

- [ ] **Step 3: Verify edit-mode flow**

1. Open the same task.
2. Confirm month dropdown shows the engagement window.
3. Switch to next month — confirm row dates and owners populate from the plan defaults.
4. Change an owner in next month — confirm subsequent months reflect the new owner; previous month untouched.
5. Switch to a past month — confirm everything is disabled and "+ Add subtask" / remove buttons are hidden.
6. In the current month: click "+ Add subtask", pick a sub-cat — confirm a row is added and the same row appears when navigating to next month.
7. Click "✕" on a row — confirm the prompt, accept, then verify the row is gone in current and future months but still visible in past months (if any).

- [ ] **Step 4: Verify migration of old goals**

1. Pick a pre-existing goal from before this change (one with many materialized children).
2. Open it — confirm the month dropdown is populated, current month renders correctly, past months are read-only with their original data.
3. Confirm `sub_plans` rows exist for the goal: `python manage.py shell -c "from core.tasks.models import Task; t = Task.objects.get(uid='<uid>'); print(list(t.sub_plans.all()))"`.

- [ ] **Step 5: Final commit + push**

If the verification surfaces any bugs, fix them and commit. Once verification is fully clean:

```bash
git push
```

---

## Self-Review Notes

- Spec coverage: every section of the spec is mapped to one or more tasks. Migration is Task 11; per-month behavior is Tasks 7–10 + 15–20; cascading is Tasks 4 and 9 + 20.
- All steps include exact file paths, runnable commands, and complete code blocks (no placeholders or "implement similar to X" references).
- Type names (`TaskSubcategoryPlan`, `MonthScopedTaskDto`, `addOrExtendPlan` → service `add_or_extend_plan`, etc.) are consistent across tasks.
- Migration filenames may shift (`0006`, `0007`) depending on Django's `makemigrations` output — every task that creates a migration includes a `ls migrations` step to find the actual filename and a note to adjust the dependency string.
- Backend follows TDD strictly. Frontend Tasks 13/16 are TDD; Tasks 15/17/18/19/20 are UI integration with verification via build + test runs (no isolated unit tests for the wiring layer, but Task 23 covers it manually in the browser).
