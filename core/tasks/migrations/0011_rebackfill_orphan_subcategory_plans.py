"""Re-run the per-subcategory backfill on every existing main goal.

Migration 0008 used an all-or-nothing short-circuit: it bailed out for a
goal the moment any ``TaskSubcategoryPlan`` row existed, even if the
goal had child Tasks with categories that did not yet have a plan. Goals
that already had one plan (e.g. created via the new ``/plans/`` endpoint
before 0008 ran, or whose first plan was added in some intermediate
state) ended up with every other sub-category permanently planless — and
the modal alerts "Plan not found for this row" the moment the user tries
to change recurrence on those rows.

The backfill helper is now per-category and idempotent, so re-running it
here picks up the orphans without disturbing plans that already exist.
"""

from django.db import migrations


def forward(apps, schema_editor):
    Task = apps.get_model("tasks", "Task")
    TaskSubcategoryPlan = apps.get_model("tasks", "TaskSubcategoryPlan")
    Master = apps.get_model("masters", "Master")
    from core.tasks.migrations._helpers_backfill import backfill_plans_for_task

    for goal in Task.objects.filter(parent__isnull=True).iterator(chunk_size=200):
        backfill_plans_for_task(goal, Task, TaskSubcategoryPlan, Master)


def backward(apps, schema_editor):
    # No-op: we can't tell which plans this migration created vs. the
    # ones already present. Forward-only — same stance as 0008's
    # ``backward``.
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("tasks", "0010_backfill_null_serial_no"),
    ]
    operations = [
        migrations.RunPython(forward, backward),
    ]
