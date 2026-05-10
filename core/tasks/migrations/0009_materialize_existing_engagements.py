"""Backfill: eagerly materialize every month inside each goal's engagement
window. Goals created before the per-month materializer existed (or under
the older lazy path that only created the current month at save time) end
up with future-month columns blank on the Board until the user opens each
month's modal. This migration walks every existing main goal with plans
and fills the gap so the Board reflects every month immediately.

Idempotent: running again is a no-op for months that already have rows.
"""

from __future__ import annotations

import calendar
import datetime as dt

from django.db import migrations


def _first_of_month(d: dt.date) -> dt.date:
    return d.replace(day=1)


def _add_months(d: dt.date, months: int) -> dt.date:
    total = (d.year * 12 + (d.month - 1)) + months
    year, month0 = divmod(total, 12)
    return dt.date(year, month0 + 1, 1)


_STEP_MONTHS = {
    "onetime": 0,
    "monthly": 1,
    "quarterly": 3,
    "halfyearly": 6,
    "yearly": 12,
}


def _months_between(a: dt.date, b: dt.date) -> int:
    return (b.year - a.year) * 12 + (b.month - a.month)


def _is_on_step(plan, month_start: dt.date) -> bool:
    step = _STEP_MONTHS.get(plan.recurrence, 1)
    if step <= 0:
        return month_start == plan.active_from_month
    delta = _months_between(plan.active_from_month, month_start)
    return delta >= 0 and delta % step == 0


def _is_within_window(plan, month_start: dt.date) -> bool:
    if month_start < plan.active_from_month:
        return False
    if plan.active_until_month and month_start > plan.active_until_month:
        return False
    return True


def _target_date_for(plan, month_start: dt.date) -> dt.date:
    day = plan.target_day or 1
    last_day = calendar.monthrange(month_start.year, month_start.month)[1]
    return month_start.replace(day=min(day, last_day))


def forward(apps, schema_editor):
    """Reproduces ``services.materialize_engagement`` against historical
    apps-registry models so the migration stays self-contained and survives
    later code refactors.
    """
    Task = apps.get_model("tasks", "Task")
    TaskSubcategoryPlan = apps.get_model("tasks", "TaskSubcategoryPlan")

    goals = Task.objects.filter(parent__isnull=True)
    for goal in goals.iterator(chunk_size=200):
        plans = list(TaskSubcategoryPlan.objects.filter(main_task=goal))
        if not plans:
            continue

        starts: list[dt.date] = [p.active_from_month for p in plans]
        if goal.engagement_start is not None:
            starts.append(_first_of_month(goal.engagement_start))
        ends: list[dt.date] = [p.active_until_month for p in plans if p.active_until_month is not None]
        if goal.engagement_end is not None:
            ends.append(_first_of_month(goal.engagement_end))
        if not starts or not ends:
            continue

        # If the goal carries an explicit ``target_date`` we must not create
        # a child past it — the model invariant rejects that, and the
        # historical save path here can't run model.clean() the same way.
        # Drop any plan-window months that would overshoot.
        ceiling = goal.target_date

        cursor = min(starts)
        window_end = max(ends)
        while cursor <= window_end:
            existing_categories = set(
                Task.objects.filter(
                    parent=goal,
                    target_date__gte=cursor,
                    target_date__lt=_add_months(cursor, 1),
                ).values_list("category_id", flat=True)
            )
            for plan in plans:
                if not _is_within_window(plan, cursor):
                    continue
                if not _is_on_step(plan, cursor):
                    continue
                if plan.subcategory_id in existing_categories:
                    continue
                target_date = _target_date_for(plan, cursor)
                if ceiling and target_date > ceiling:
                    continue
                Task.objects.create(
                    parent=goal,
                    org=goal.org,
                    client=goal.client,
                    reporting_manager=goal.reporting_manager,
                    recurrence=goal.recurrence,
                    description=plan.subcategory.name,
                    category_id=plan.subcategory_id,
                    responsible_id=plan.default_owner_id,
                    target_date=target_date,
                    status="pending",
                )
            cursor = _add_months(cursor, 1)


def backward(apps, schema_editor):
    """No-op: we cannot tell which child rows were created by this backfill
    versus pre-existing manual rows. Forward-only.
    """
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("tasks", "0008_backfill_subcategory_plans"),
    ]
    operations = [
        migrations.RunPython(forward, backward),
    ]
