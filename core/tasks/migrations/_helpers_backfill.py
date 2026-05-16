"""Backfill helper used by the data migration. Pulled out into its own
module so unit tests can call it directly with model classes from
``apps.get_model`` (migration-style) or with the live ORM models.

The leading underscore in the filename keeps Django's migration loader
from treating this as a migration (see
``django.db.migrations.loader.MigrationLoader.load_disk``: files whose
names start with ``_`` or ``~`` are skipped).
"""

from __future__ import annotations

import datetime as dt

_RECURRENCE_NORMALIZE = {
    "": "monthly",
    "Onetime": "onetime",
    "Weekly": "weekly",
    "Monthly": "monthly",
    "Quarterly": "quarterly",
    "Halfyearly": "halfyearly",
    "Yearly": "yearly",
}


def _first_of_month(d: dt.date) -> dt.date:
    return d.replace(day=1)


def backfill_plans_for_task(main, Task, TaskSubcategoryPlan, Master) -> int:
    """For one main goal, derive plans from its child rows for any
    subcategory that does not yet have a plan, and set the engagement
    window from the combined min/max. Returns the number of plans
    created.

    Idempotent + per-category: re-running over a goal that already has
    plans for some categories still backfills any orphaned ones. This is
    the recovery path for goals that landed in a mixed state — e.g. one
    plan added via the new ``/plans/`` endpoint before the original
    migration ran, leaving every other category in the same goal
    permanently planless (and the modal alerting "Plan not found for
    this row" on every recurrence edit).
    """
    if main.parent_id is not None:
        return 0

    children = list(Task.objects.filter(parent=main).exclude(category__isnull=True).order_by("target_date", "id"))
    if not children:
        return 0

    existing_cat_ids: set[int] = set(
        TaskSubcategoryPlan.objects.filter(main_task=main).values_list("subcategory_id", flat=True)
    )

    by_cat: dict[int, list] = {}
    for c in children:
        by_cat.setdefault(c.category_id, []).append(c)

    plans_created = 0
    earliest = None
    latest = None
    for cat_id, group in by_cat.items():
        if cat_id in existing_cat_ids:
            continue
        group_dates = [c.target_date for c in group if c.target_date]
        if not group_dates:
            continue
        first_month = _first_of_month(min(group_dates))
        last_month = _first_of_month(max(group_dates))
        sorted_group = sorted(group, key=lambda c: c.target_date or dt.date.min)
        last_row = sorted_group[-1]
        sub_cat = Master.objects.filter(pk=cat_id).first()
        if sub_cat is None:
            continue
        recurrence = _RECURRENCE_NORMALIZE.get(getattr(sub_cat, "recurrence", "") or "", "monthly")
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

    # Only widen the engagement window — never shrink it past plans that
    # were already on the goal (they may extend beyond the child rows
    # we just walked).
    if plans_created and (earliest is not None or latest is not None):
        cur_start = main.engagement_start
        cur_end = main.engagement_end
        new_start = earliest if cur_start is None else min(cur_start, earliest) if earliest else cur_start
        new_end = latest if cur_end is None else max(cur_end, latest) if latest else cur_end
        if new_start != cur_start or new_end != cur_end:
            main.engagement_start = new_start
            main.engagement_end = new_end
            main.save(update_fields=["engagement_start", "engagement_end", "updated_at"])

    return plans_created
