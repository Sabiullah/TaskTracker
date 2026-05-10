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
