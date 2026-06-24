"""Collapse legacy name-duplicate plan children.

A second class of duplicate survived 0013/0014. Those collapse/constrain
children that share ``(parent, category, target_date)`` — i.e. the same
category *pk*. But the org has several sub-category masters that share a
display *name* under different main categories (a legitimate, constraint-
allowed shape: ``master_unique_sub`` is keyed on
``(type, name, org, parent)``). Before ``materialize_month`` grew its
name-based dedupe guard (``names_touched_this_month``), a goal could end up
with two children for the "same" subtask — identical name and target_date,
but pointing at two different category masters. The board de-dupes by name
(shows one); the dashboard shows both raw rows.

The runtime guard now prevents *new* occurrences. This migration cleans the
*legacy* rows: for each (parent, target_date, normalised category name) group
with more than one child, keep the single most-meaningful row and delete the
rest. "Most meaningful" preserves human-entered progress first (completion,
remarks, expected date, a non-default status), then prefers the child whose
category is still referenced by one of the goal's current plans (so the
survivor matches what the board shows), then the oldest id for a deterministic
tie-break.

DML only (no constraint/index creation), so it is safe as a single atomic
migration on PostgreSQL — unlike the dedupe+constraint that had to be split
across 0013/0014.
"""

from collections import defaultdict

from django.db import migrations


def _norm(name: str | None) -> str:
    return (name or "").strip().casefold()


def collapse_name_duplicate_children(apps, schema_editor):
    Task = apps.get_model("tasks", "Task")
    TaskSubcategoryPlan = apps.get_model("tasks", "TaskSubcategoryPlan")

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
        "target_date",
        "category_id",
        "completed_date",
        "remarks",
        "expected_date",
        "status",
        "category__name",
        "description",
    )

    groups: dict[tuple, list[dict]] = defaultdict(list)
    for c in children:
        name = _norm(c["category__name"]) or _norm(c["description"])
        if not name:
            continue
        groups[(c["parent_id"], c["target_date"], name)].append(c)

    to_delete: list[int] = []
    for (parent_id, _date, _name), rows in groups.items():
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
        ("tasks", "0014_add_slot_constraint"),
    ]

    operations = [
        migrations.RunPython(collapse_name_duplicate_children, noop_reverse),
    ]
