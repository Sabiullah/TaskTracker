"""Backfill: rewrite Task rows whose ``status`` was stored as a display
label ("Overdue") to the corresponding choice key ("overdue").

Some legacy rows in production carry the human-readable label rather than
the lowercase choice key. Commit aa070f3 added ``instance.full_clean()``
to the serializer's save path so every PATCH on those rows now fails with
``{"status": ["Value 'Overdue' is not a valid choice."]}`` — the
``clean_fields`` pass validates the existing value even when the request
never touches ``status``.

The serializer also normalizes on save, but only when the row is being
PATCHed. This migration fixes every existing row in one pass so the
broadcast/list endpoints (which don't run the serializer's repair path)
stop returning the label-shaped value to the client.

Forward-only: we don't write the label back. The map is intentionally
written long-hand rather than reading ``Task.STATUS_CHOICES`` so that a
future rename of the choices doesn't silently shift this backfill.
"""

from __future__ import annotations

from django.db import migrations

LABEL_TO_KEY = {
    "Pending": "pending",
    "Today Task": "today_task",
    "TodayTask": "today_task",
    "Tomorrow": "tomorrow",
    "In Progress": "in_progress",
    "Completed": "completed",
    "Completed Delay": "completed_delay",
    "Overdue": "overdue",
    "Future Task/Goals": "future_goal",
    "TBC": "tbc",
    "Archived": "archived",
    # Frontend domain alias — ``computeStatus`` historically emitted
    # "Ontime" for on-time completions; ``TASK_STATUS_DOMAIN_TO_DTO``
    # maps it to "completed" when writing back.
    "Ontime": "completed",
}


def forward(apps, schema_editor):
    Task = apps.get_model("tasks", "Task")
    for label, key in LABEL_TO_KEY.items():
        Task.objects.filter(status=label).update(status=key)


def backward(apps, schema_editor):
    """No-op: re-corrupting the column would be silly."""


class Migration(migrations.Migration):
    dependencies = [
        ("tasks", "0011_rebackfill_orphan_subcategory_plans"),
    ]
    operations = [
        migrations.RunPython(forward, backward),
    ]
