"""Collapse cadenced month-duplicate plan children.

A third class of duplicate survived 0013/0014/0015. Those all key on the exact
``target_date``: 0013/0014 constrain ``(parent, category, target_date)`` and
0015 collapses ``(parent, target_date, name)``. Adding **Weekly** recurrence
deliberately widened the dedupe slot from *per-month* to *per-date* so a weekly
plan can emit many rows in one month — but that reopened the monthly hole. A
goal may hold one MASTER plan per sub-category yet unlimited FREE-entry plans
(``uniq_master_plan_per_goal`` exempts ``subcategory IS NULL``), so a master
"Book Review" plan (day 10) could coexist with a hand-typed free-entry
"Book Review" plan (day 15). Each materialised its own monthly child at its own
day; the per-date slot saw two different dates as two different slots. Result:
one Board card (per goal) but two Dashboard rows (per child) every month.

``materialize_month``'s name guard now covers free-entry plans, so *new*
occurrences no longer double up. This migration cleans the *existing* rows: for
each (parent, work-month, normalised name) group of CADENCED children with more
than one row, keep the single most-meaningful row and delete the rest.

Weekly children are excluded — they legitimately repeat within a month. The
child's own ``recurrence`` mirrors the *goal's*, not the plan's, so weekliness
is read from the plan (``plan_id`` → ``TaskSubcategoryPlan.recurrence``), with a
fall back to the child's ``recurrence`` for legacy rows whose ``plan_id`` is
null.

"Most meaningful" preserves human-entered progress first (completion, remarks,
expected date, a non-default status), then prefers the plan-aligned child (its
category is still referenced by one of the goal's plans — the row the Board
shows), then the oldest id for a deterministic tie-break.

DML only (no constraint/index creation), so it is safe as a single atomic
migration on PostgreSQL.
"""

from collections import defaultdict

from django.db import migrations


def _norm(name: str | None) -> str:
    return (name or "").strip().casefold()


def collapse_month_duplicate_children(apps, schema_editor):
    Task = apps.get_model("tasks", "Task")
    TaskSubcategoryPlan = apps.get_model("tasks", "TaskSubcategoryPlan")

    plan_recurrence: dict[int, str] = dict(TaskSubcategoryPlan.objects.values_list("id", "recurrence"))
    # category pks still referenced by each goal's current plans → used to
    # prefer the plan-aligned survivor when no row carries human progress.
    plan_aligned: dict[int, set[int]] = defaultdict(set)
    for main_id, sub_id in TaskSubcategoryPlan.objects.values_list("main_task_id", "subcategory_id"):
        plan_aligned[main_id].add(sub_id)

    children = Task.objects.filter(
        parent_id__isnull=False,
        target_date__isnull=False,
    ).values(
        "id",
        "parent_id",
        "plan_id",
        "target_date",
        "category_id",
        "completed_date",
        "remarks",
        "expected_date",
        "status",
        "recurrence",
        "category__name",
        "description",
    )

    groups: dict[tuple, list[dict]] = defaultdict(list)
    for c in children:
        # Weekly plans legitimately emit several rows per month — never collapse
        # them. Read weekliness from the plan; fall back to the child's own
        # recurrence for legacy rows with a null plan_id.
        recurrence = plan_recurrence.get(c["plan_id"]) or c["recurrence"]
        if recurrence == "weekly":
            continue
        name = _norm(c["category__name"]) or _norm(c["description"])
        if not name:
            continue
        month = (c["target_date"].year, c["target_date"].month)
        groups[(c["parent_id"], month, name)].append(c)

    to_delete: list[int] = []
    for (parent_id, _month, _name), rows in groups.items():
        if len(rows) < 2:
            continue
        aligned = plan_aligned.get(parent_id, set())

        def score(r: dict, aligned: set[int] = aligned) -> tuple:
            # Higher tuple wins. Human progress first so no entered data is
            # lost; then plan-aligned; then lowest id (via -id). ``aligned`` is
            # bound as a default arg so the closure captures this group's set
            # (avoids B023 loop-variable capture).
            return (
                r["completed_date"] is not None,
                bool((r["remarks"] or "").strip()),
                r["expected_date"] is not None,
                r["status"] not in ("", "pending"),
                r["category_id"] in aligned,
                -r["id"],
            )

        keeper = max(rows, key=score)
        to_delete.extend(r["id"] for r in rows if r["id"] != keeper["id"])

    if to_delete:
        for i in range(0, len(to_delete), 500):
            Task.objects.filter(id__in=to_delete[i : i + 500]).delete()


def noop_reverse(apps, schema_editor):
    # Deleted duplicates are not restorable; nothing to undo.
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("tasks", "0019_strip_typed_month_suffix"),
    ]

    operations = [
        migrations.RunPython(collapse_month_duplicate_children, noop_reverse),
    ]
