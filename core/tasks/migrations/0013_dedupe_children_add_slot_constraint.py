"""Collapse duplicate plan children, then enforce one child per plan slot.

Production goals accumulated duplicate children — every recurring sub-task
showing twice (or more) on the dashboard — because ``materialize_month``
deduped in Python with no DB constraint behind it, so concurrent loads of
the same goal+month both inserted the full set.

Forward:
  1. For each (parent, category, target_date) group with >1 child, keep the
     single most-meaningful row and delete the rest. "Most meaningful" keeps
     any human-entered progress (completion, remarks, expected date, a
     non-default status) over a bare auto-generated row; ties break to the
     oldest id so the result is deterministic.
  2. Add the partial unique constraint ``uniq_child_per_plan_slot``.

The collapse must precede the AddConstraint or the constraint creation would
fail on the very duplicates it exists to prevent.
"""

from django.db import migrations, models


def _score(row) -> tuple:
    """Higher tuple = more worth keeping. Final tie-break (oldest id) is
    applied by the caller via ``-id`` so we keep the lowest id on a tie."""
    return (
        row.completed_date is not None,
        bool((row.remarks or "").strip()),
        row.expected_date is not None,
        row.status not in ("", "pending"),
    )


def collapse_duplicate_children(apps, schema_editor):
    Task = apps.get_model("tasks", "Task")

    groups = (
        Task.objects.filter(
            parent_id__isnull=False,
            category_id__isnull=False,
            target_date__isnull=False,
        )
        .values("parent_id", "category_id", "target_date")
        .annotate(c=models.Count("id"))
        .filter(c__gt=1)
    )

    to_delete: list[int] = []
    for g in groups:
        rows = list(
            Task.objects.filter(
                parent_id=g["parent_id"],
                category_id=g["category_id"],
                target_date=g["target_date"],
            )
        )
        # Keep the highest-scoring row; lowest id wins a score tie.
        keeper = max(rows, key=lambda r: (_score(r), -r.id))
        to_delete.extend(r.id for r in rows if r.id != keeper.id)

    if to_delete:
        # Chunk to keep the IN clause sane on large backlogs.
        for i in range(0, len(to_delete), 500):
            Task.objects.filter(id__in=to_delete[i : i + 500]).delete()


def noop_reverse(apps, schema_editor):
    # Deleted duplicates are not restorable; reversing only drops the
    # constraint (handled by the migration framework for AddConstraint).
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("tasks", "0012_normalize_legacy_status_labels"),
    ]

    operations = [
        migrations.RunPython(collapse_duplicate_children, noop_reverse),
        migrations.AddConstraint(
            model_name="task",
            constraint=models.UniqueConstraint(
                fields=["parent", "category", "target_date"],
                condition=models.Q(
                    parent__isnull=False,
                    category__isnull=False,
                    target_date__isnull=False,
                ),
                name="uniq_child_per_plan_slot",
            ),
        ),
    ]
