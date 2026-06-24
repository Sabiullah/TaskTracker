"""Enforce one child per plan slot (step 2 of 2).

Adds the partial unique constraint ``uniq_child_per_plan_slot`` so the
database itself rejects a second child for the same
(parent, category, target_date) slot — the permanent guard against the
duplicate recurring sub-tasks that 0013 cleaned up.

This is split out from 0013 (the dedupe) on purpose. PostgreSQL refuses to
``CREATE INDEX`` in the same transaction that just issued the dedupe DELETEs:
``cannot CREATE INDEX "tasks_task" because it has pending trigger events``.
Running the constraint in its own migration gives it its own transaction,
after 0013's DELETEs have committed and flushed those FK trigger events.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("tasks", "0013_dedupe_children_add_slot_constraint"),
    ]

    operations = [
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
