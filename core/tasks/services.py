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
from django.utils import timezone

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
    """Number of whole months from ``a`` to ``b``. Zero when both are the
    same month-start. Negative when ``b`` precedes ``a``. Both inputs must
    already be first-of-month dates.
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
        child = Task(
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
        child.full_clean()
        child.save()
        created.append(child)

    return created


def _plan_for_child(child: Task) -> TaskSubcategoryPlan | None:
    """Find the plan that produced this child Task — by (main_task, sub-cat)."""
    if child.parent_id is None or child.category_id is None:
        return None
    return TaskSubcategoryPlan.objects.filter(
        main_task_id=child.parent_id,
        subcategory_id=child.category_id,
    ).first()


@transaction.atomic
def cascade_owner_forward(child: Task, new_owner: "User | None") -> int:
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

    # ``.update()`` bypasses ``save()`` and skips ``auto_now`` — bump
    # ``updated_at`` explicitly so cascaded rows show as recently changed.
    updated = Task.objects.filter(
        parent_id=child.parent_id,
        category_id=child.category_id,
        target_date__gt=child.target_date,
    ).update(responsible=new_owner, updated_at=timezone.now())

    return 1 + updated


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
