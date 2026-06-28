"""Service layer for the per-goal sub-category plan + per-month materialization.

Each function is pure-ish: it accepts a ``Task`` (the main goal) plus the bare
arguments it needs and either creates/updates child rows or plan rows. Keeping
these out of views/serializers makes them unit-testable in isolation and
reusable from data migrations or admin actions.
"""

from __future__ import annotations

import calendar
import datetime as dt

from django.db import IntegrityError, transaction
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


def _is_within_window(plan: TaskSubcategoryPlan, month_start: dt.date) -> bool:
    if month_start < plan.active_from_month:
        return False
    if plan.active_until_month and month_start > plan.active_until_month:
        return False
    return True


def _target_dates_in_month(plan: TaskSubcategoryPlan, month_start: dt.date) -> list[dt.date]:
    """Every target date this plan should emit in the given month.

    Cadenced recurrences (monthly/quarterly/halfyearly/yearly/onetime):
      Returns ``[target_date]`` when ``month_start`` is on-step and inside
      the plan's active window, else ``[]``. ``target_date`` is the day-of-
      month clamped to the month's last day when needed.

    Weekly:
      Returns every date in ``[month_start, next_month_start)`` whose ISO
      weekday matches ``plan.target_day`` (1=Mon ... 7=Sun). When
      ``target_day`` is null, falls back to whatever weekday
      ``month_start`` itself is — same null-fallback shape the cadenced
      recurrences already use.
    """
    if not _is_within_window(plan, month_start):
        return []

    next_month_start = _add_months(month_start, 1)

    if plan.recurrence == "weekly":
        # ISO weekday: Mon=1 ... Sun=7. ``date.isoweekday()`` returns this directly.
        want = plan.target_day if plan.target_day else month_start.isoweekday()
        want = max(1, min(7, want))
        out: list[dt.date] = []
        cursor = month_start
        while cursor < next_month_start:
            if cursor.isoweekday() == want:
                out.append(cursor)
            cursor = cursor + dt.timedelta(days=1)
        return out

    # Cadenced (monthly / quarterly / halfyearly / yearly / onetime).
    step = _STEP_MONTHS.get(plan.recurrence, 1)
    if step <= 0:
        if month_start != plan.active_from_month:
            return []
    else:
        delta = _months_between(plan.active_from_month, month_start)
        if delta < 0 or delta % step != 0:
            return []

    day = plan.target_day or 1
    last_day = calendar.monthrange(month_start.year, month_start.month)[1]
    return [month_start.replace(day=min(day, last_day))]


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
    # A completed goal's recurrence is stopped — never generate more children
    # (``cap_completed_goal`` also caps the window, but this guards re-renders
    # that could otherwise resurrect a discarded occurrence).
    if main.status in Task.COMPLETED_STATUSES:
        return []
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


def _save_child_guarded(child: Task) -> bool:
    """Validate and save a materialised child, tolerating the duplicate-slot
    race. Returns True when the row was written, False when an equal child
    already existed (the ``uniq_child_per_plan_slot`` constraint fired
    because a concurrent materialise won the insert first).

    The inner ``atomic()`` is a savepoint: on Postgres an IntegrityError
    aborts the surrounding transaction unless the failing statement is
    isolated in its own savepoint, so without this the whole materialise
    pass — and the request that triggered it — would 500.
    """
    # Skip constraint validation here: ``full_clean`` would re-query and raise
    # a ValidationError for the duplicate slot, but that read is itself subject
    # to the same race. Let the DB constraint be the single source of truth and
    # catch its IntegrityError below.
    child.full_clean(validate_constraints=False)
    try:
        with transaction.atomic():
            child.save()
        return True
    except IntegrityError:
        return False


@transaction.atomic
def materialize_month(main: Task, month_start: dt.date) -> list[Task]:
    """Ensure every active plan for ``main`` has a child Task row for every
    target date its cadence emits inside ``month_start``'s month. Idempotent:
    returns only newly-created rows.

    ``month_start`` must be the first day of a month.
    """
    # A completed goal's recurrence is stopped — see ``materialize_engagement``.
    if main.status in Task.COMPLETED_STATUSES:
        return []
    if month_start.day != 1:
        month_start = _first_of_month(month_start)

    created: list[Task] = []
    plans = list(main.sub_plans.select_related("subcategory", "default_owner").all())
    if not plans:
        return created

    # Look up children already materialised for this (goal, month). The
    # key dedupe rule is "plan-already-touched-this-month": if a plan has
    # ANY child in this month, the user has bootstrapped the month and is
    # managing it manually — don't re-emit fresh cadenced rows on top of
    # it. Without this, the user editing a child's date (e.g. from 02/05
    # to 03/05) leaves the cadence's original date "unused", which then
    # made materialise_month spawn a duplicate at the original date on
    # the very next view load.
    #
    # This in-Python check is necessary but NOT sufficient: it is a
    # check-then-insert with no isolation, so two concurrent calls (two
    # browser tabs, a websocket-triggered refetch on several open clients)
    # both read the month as empty and both insert the full set — every
    # recurring task then appears twice on the board/dashboard. The
    # ``uniq_child_per_plan_slot`` DB constraint is the real backstop;
    # ``_save_child_guarded`` below turns the loser's duplicate INSERT into
    # a no-op instead of an IntegrityError 500.
    month_end = _add_months(month_start, 1)
    existing_in_month = _existing_children_in_month(main, month_start, month_end)
    # Primary dedupe key: the plan FK. Free-entry plans (category=NULL) are
    # tracked the same as master-backed ones. A plan with ANY child this
    # month is user-managed — leave the month alone. Applies to every cadence
    # including weekly: the initial materialisation (engagement create) emits
    # all expected dates from an empty starting set, so the subsequent "no
    # existing → emit all" path still bootstraps weekly plans correctly; only
    # re-runs over an already-populated month are no-ops.
    plans_touched_this_month: set[int] = {s.plan_id for s in existing_in_month if s.plan_id is not None}
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
        plan_name_key = (plan.subcategory.name or "").strip().casefold() if plan.subcategory else ""
        if plan_name_key and plan_name_key in names_touched_this_month:
            continue
        description = plan.subcategory.name if plan.subcategory else plan.description
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
        # Mark the plan / name as touched so subsequent plan iterations
        # in the same call (or a future re-run that races in before the
        # outer queryset rehydrates) don't double-emit.
        plans_touched_this_month.add(plan.pk)
        if plan_name_key:
            names_touched_this_month.add(plan_name_key)

    return created


def _plan_for_child(child: Task) -> TaskSubcategoryPlan | None:
    """Find the plan that produced this child Task. Prefer the direct FK;
    fall back to (main_task, subcategory) for legacy rows that predate it.

    Queries the FK by pk rather than dereferencing ``child.plan`` so a stale
    or dangling ``plan_id`` (e.g. the plan was deleted after the child was
    loaded — SET_NULL has updated the DB row but not this in-memory copy)
    yields ``None`` instead of raising ``DoesNotExist``.
    """
    if child.plan_id is not None:
        plan = TaskSubcategoryPlan.objects.filter(pk=child.plan_id).first()
        if plan is not None:
            return plan
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
        plan_id=plan.pk,
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
    new_target_day: int | None = None,
) -> dict:
    """Change ``plan.recurrence`` (and optionally ``target_day``) and reshape
    future months.

    - Normalises ``new_recurrence`` to the Task model's lowercase choices.
    - Updates ``plan.target_day`` when ``new_target_day`` is provided. The
      caller is responsible for passing the right semantic (1-7 ISO weekday
      for ``"weekly"``, 1-31 day-of-month otherwise); the view layer's range
      validation guards the user-facing path.
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
    update_fields = ["recurrence", "updated_at"]
    if new_target_day is not None:
        plan.target_day = new_target_day
        update_fields.append("target_day")
    plan.save(update_fields=update_fields)

    to_delete_qs = Task.objects.filter(
        plan_id=plan.pk,
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
            plan_id=plan.pk,
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
        plan_id=plan.pk,
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


@transaction.atomic
def cap_completed_goal(main: Task) -> dict:
    """Stop a recurring goal's recurrence when its main is marked complete.

    Run after a main goal is saved with a completed status. Discards the open
    children scheduled *after* the goal's ``completed_date`` and ends the
    recurrence so no further months materialize:

    - Permanently deletes every uncompleted child whose ``target_date`` is
      strictly after ``main.completed_date``. Children due on/before the
      completion date are left alone — the completion gate in ``Task.clean``
      already requires them to be completed first. Children that carry a
      ``completed_date`` are always preserved as history, even if dated after
      the completion date.
    - Caps every plan's ``active_until_month`` and the goal's
      ``engagement_end`` to the completion month (never extending forward).

    No-op for goals that aren't plan-managed or have no ``completed_date``.

    Returns ``{"children_deleted": N, "deleted_child_uids": [...]}``.
    """
    if main.completed_date is None or not main.sub_plans.exists():
        return {"children_deleted": 0, "deleted_child_uids": []}

    cap_month = _first_of_month(main.completed_date)

    to_delete_qs = Task.objects.filter(
        parent_id=main.pk,
        completed_date__isnull=True,
        target_date__gt=main.completed_date,
    )
    deleted_uids = [str(u) for u in to_delete_qs.values_list("uid", flat=True)]
    children_deleted, _ = to_delete_qs.delete()

    for plan in main.sub_plans.all():
        if plan.active_until_month is None or plan.active_until_month > cap_month:
            plan.active_until_month = cap_month
            plan.save(update_fields=["active_until_month", "updated_at"])

    if main.engagement_end is None or main.engagement_end > cap_month:
        main.engagement_end = cap_month
        main.save(update_fields=["engagement_end", "updated_at"])

    return {"children_deleted": children_deleted, "deleted_child_uids": deleted_uids}
