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
from users.models import User

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


def _add_months(d: dt.date, months: int) -> dt.date:
    """Shift a first-of-month date forward by ``months``. Months may be 0+.

    Plain Python lacks month arithmetic; this avoids a ``dateutil`` dep for
    a one-line need.
    """
    total = (d.year * 12 + (d.month - 1)) + months
    year, month0 = divmod(total, 12)
    return dt.date(year, month0 + 1, 1)


@transaction.atomic
def materialize_engagement(main: Task) -> list[Task]:
    """Materialize every month the goal's plans cover, in one pass.

    Walks ``[engagement_start, engagement_end]`` (extended outward to cover
    any plan whose own window pokes outside the main goal's) and calls
    :func:`materialize_month` for each first-of-month. Idempotent: re-running
    is a no-op for months that already have their child rows.

    Returns the combined list of newly-created children across all months.
    """
    plans = list(main.sub_plans.all())
    if not plans:
        return []

    starts: list[dt.date] = [p.active_from_month for p in plans]
    if main.engagement_start is not None:
        starts.append(_first_of_month(main.engagement_start))
    ends: list[dt.date] = [p.active_until_month for p in plans if p.active_until_month is not None]
    if main.engagement_end is not None:
        ends.append(_first_of_month(main.engagement_end))

    if not starts or not ends:
        # Open-ended engagement (no end date) or no anchor at all — fall
        # back to lazy single-month materialization on view; nothing to do
        # eagerly.
        return []

    window_start = min(starts)
    window_end = max(ends)

    created: list[Task] = []
    cursor = window_start
    while cursor <= window_end:
        created.extend(materialize_month(main, cursor))
        cursor = _add_months(cursor, 1)
    return created


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
    # skip plans whose row already exists. We also dedupe by the
    # sub-category's normalised name — without this, a goal whose plans table
    # holds two rows pointing at different sub-cat masters that share a name
    # (legacy/duplicate masters) would materialise twice every month and
    # show as duplicates in the modal.
    month_end = month_start + dt.timedelta(days=31)
    month_end = month_end.replace(day=1)  # First of next month.
    existing_in_month = list(
        Task.objects.filter(
            parent=main,
            target_date__gte=month_start,
            target_date__lt=month_end,
        ).select_related("category")
    )
    existing_categories: set = {s.category_id for s in existing_in_month}
    existing_names: set[str] = {
        (s.category.name or "").strip().casefold()
        for s in existing_in_month
        if s.category is not None and (s.category.name or "").strip()
    }

    # If the goal carries an explicit ``target_date`` we must not create a
    # child past it — ``Task.clean()`` rejects that, and bubbling the
    # resulting ``django.core.exceptions.ValidationError`` out of an atomic
    # block becomes an opaque 500 for the caller. Mirrors the same skip the
    # backfill migration (0009) applies to historical rows.
    ceiling = main.target_date

    for plan in plans:
        if not _is_within_window(plan, month_start):
            continue
        if not _is_on_step(plan, month_start):
            continue
        if plan.subcategory_id in existing_categories:
            continue
        plan_name_key = (plan.subcategory.name or "").strip().casefold()
        if plan_name_key and plan_name_key in existing_names:
            continue

        target_date = _target_date_for(plan, month_start)
        if ceiling and target_date > ceiling:
            continue
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
        existing_categories.add(plan.subcategory_id)
        if plan_name_key:
            existing_names.add(plan_name_key)

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
def cascade_owner_forward(child: Task, new_owner: User | None) -> list[str]:
    """Set ``child.responsible = new_owner`` and propagate forward.

    Updates every Task that:
      - shares the same plan (same parent + same category), AND
      - has ``target_date > child.target_date``.

    Also updates the plan's ``default_owner`` so future on-demand
    materializations pick up the new owner.

    Past child rows (target_date < child.target_date) are not touched.

    Returns the list of cascaded child uids (the directly-edited ``child`` is
    not included — caller broadcasts it themselves if needed).
    """
    if child.parent_id is None or child.target_date is None:
        return []

    child.responsible = new_owner
    child.save(update_fields=["responsible", "updated_at"])

    plan = _plan_for_child(child)
    if plan is None:
        return []

    plan.default_owner = new_owner
    plan.save(update_fields=["default_owner", "updated_at"])

    # ``.update()`` bypasses ``save()`` and skips ``auto_now`` — bump
    # ``updated_at`` explicitly so cascaded rows show as recently changed.
    affected_qs = Task.objects.filter(
        parent_id=child.parent_id,
        category_id=child.category_id,
        target_date__gt=child.target_date,
    )
    cascaded_uids = [str(u) for u in affected_qs.values_list("uid", flat=True)]
    affected_qs.update(responsible=new_owner, updated_at=timezone.now())

    return cascaded_uids


# Map sub-cat master's RECURRENCE_CHOICES values (e.g. "Monthly") to the
# Task model's lowercase values (e.g. "monthly"). Master uses Title-case
# choices for legacy reasons; Task uses lowercase. Always normalize to
# Task's space when reading from the master.
_MASTER_TO_TASK_RECURRENCE = {
    "": "monthly",
    "Onetime": "onetime",
    "Weekly": "weekly",
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
) -> tuple[TaskSubcategoryPlan, Task | None, list[Task]]:
    """Add a new sub-cat plan starting at ``month_start``, or extend an
    existing one for the same (main, subcategory) so it covers ``month_start``.

    Materializes every month the goal's engagement covers so the Board sees
    the new sub-cat in every month at once — no lazy gap until the user
    opens each month's modal.

    Returns ``(plan, child_for_month_start_or_None, list_of_all_created_children)``
    so callers can broadcast each newly-created row to live clients.
    """
    month_start = _first_of_month(month_start)

    plan = TaskSubcategoryPlan.objects.filter(main_task=main, subcategory=subcategory).first()

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
        if plan.active_until_month is not None and plan.active_until_month < month_start:
            plan.active_until_month = main.engagement_end
            changed = True
        if owner is not None and plan.default_owner_id != getattr(owner, "pk", None):
            plan.default_owner = owner
            changed = True
        if changed:
            plan.save()

    all_created = materialize_engagement(main)
    if not all_created:
        # Open-ended (no engagement_end) — fall back to single-month so the
        # caller still gets the row they asked for.
        all_created = materialize_month(main, month_start)

    child = next(
        (
            c
            for c in all_created
            if c.category_id == subcategory.pk and c.target_date and c.target_date.replace(day=1) == month_start
        ),
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
    return plan, child, all_created


@transaction.atomic
def update_plan_recurrence(
    plan: TaskSubcategoryPlan,
    new_recurrence: str,
    from_month: dt.date,
) -> dict:
    """Change ``plan.recurrence`` and reshape future months.

    - Normalises ``new_recurrence`` to the Task model's lowercase choices.
    - Deletes every uncompleted child of this plan whose ``target_date``
      is on or after ``from_month`` — these rows came from the old cadence
      and would otherwise leave stale occurrences in the grid.
    - Re-runs :func:`materialize_engagement` so the new cadence materialises
      forward across the goal's engagement window.

    Completed children (``completed_date`` set) are preserved as history.

    Returns ``{"children_deleted": N, "deleted_child_uids": [...],
    "children_created": M, "created_child_uids": [...]}``.
    """
    from_month = _first_of_month(from_month)
    normalized = _normalize_recurrence(new_recurrence)

    plan.recurrence = normalized
    plan.save(update_fields=["recurrence", "updated_at"])

    to_delete_qs = Task.objects.filter(
        parent_id=plan.main_task_id,
        category_id=plan.subcategory_id,
        target_date__gte=from_month,
        completed_date__isnull=True,
    )
    deleted_uids = [str(u) for u in to_delete_qs.values_list("uid", flat=True)]
    children_deleted, _ = to_delete_qs.delete()

    created = materialize_engagement(plan.main_task)
    if not created:
        created = materialize_month(plan.main_task, from_month)

    return {
        "children_deleted": children_deleted,
        "deleted_child_uids": deleted_uids,
        "children_created": len(created),
        "created_child_uids": [str(c.uid) for c in created],
    }


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
        to_delete_qs = Task.objects.filter(
            parent_id=plan.main_task_id,
            category_id=plan.subcategory_id,
            target_date__gte=from_month,
            completed_date__isnull=True,
        )
        deleted_uids = [str(u) for u in to_delete_qs.values_list("uid", flat=True)]
        children_deleted, _ = to_delete_qs.delete()
        plan.delete()
        return {
            "plan_capped": False,
            "plan_deleted": True,
            "children_deleted": children_deleted,
            "deleted_child_uids": deleted_uids,
        }

    if from_month.month == 1:
        prev_month_start = dt.date(from_month.year - 1, 12, 1)
    else:
        prev_month_start = dt.date(from_month.year, from_month.month - 1, 1)

    # Capping must never extend the window forward — clamp to the existing
    # cap if there already is one earlier than ``prev_month_start``.
    if plan.active_until_month is not None and plan.active_until_month < prev_month_start:
        prev_month_start = plan.active_until_month

    plan.active_until_month = prev_month_start
    plan.save(update_fields=["active_until_month", "updated_at"])

    to_delete_qs = Task.objects.filter(
        parent_id=plan.main_task_id,
        category_id=plan.subcategory_id,
        target_date__gte=from_month,
        completed_date__isnull=True,
    )
    deleted_uids = [str(u) for u in to_delete_qs.values_list("uid", flat=True)]
    children_deleted, _ = to_delete_qs.delete()
    return {
        "plan_capped": True,
        "plan_deleted": False,
        "children_deleted": children_deleted,
        "deleted_child_uids": deleted_uids,
    }
