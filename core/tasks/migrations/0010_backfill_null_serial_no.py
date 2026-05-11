"""Backfill: assign sequential ``serial_no`` to any Task left with NULL.

Migration 0009 (eager-materialize existing engagements) creates child Task
rows via ``apps.get_model("tasks", "Task").objects.create(...)``. The
historical model returned by ``apps.get_model`` doesn't carry the custom
``Task.save()`` override that auto-assigns ``serial_no`` — so every row
that migration produced ended up with ``serial_no=NULL``.

That latent gap stayed silent on SQLite (local + CI) because SQLite sorts
NULLs as the *smallest* value, so ``ORDER BY serial_no DESC`` happily
returned the highest non-NULL row. On Postgres (production) the same
``ORDER BY ... DESC`` puts NULLs first, so the next live save read NULL,
fell through ``(None or 0) + 1`` to ``serial_no=1``, and collided with the
existing serial_no=1 — yielding the AddTask 500 the user hit.

The runtime ``Task.save`` was patched in the same change to use ``Max()``
aggregation (which skips NULLs everywhere). This migration backfills the
rows already in the DB so they pick up real, unique serial_nos and stop
shadowing the next allocation.

Forward-only: we never had a reason to nullify a previously-assigned
serial_no, so reversing would be ambiguous.
"""

from __future__ import annotations

from django.db import migrations
from django.db.models import Max


def forward(apps, schema_editor):
    Task = apps.get_model("tasks", "Task")
    null_rows = list(
        Task.objects.filter(serial_no__isnull=True).order_by("created_at", "pk").values_list("pk", flat=True)
    )
    if not null_rows:
        return

    # Anchor the new serial_nos above the current high-water mark so we
    # don't collide with the rows that already have one assigned.
    cursor = (Task.objects.aggregate(Max("serial_no"))["serial_no__max"] or 0) + 1

    # Update one row at a time so the unique constraint stays satisfied
    # even mid-loop (a single UPDATE ... SET serial_no = sequence would
    # need a deferred constraint, which Postgres' UniqueConstraint here
    # doesn't carry).
    for pk in null_rows:
        Task.objects.filter(pk=pk).update(serial_no=cursor)
        cursor += 1


def backward(apps, schema_editor):
    """No-op: nullifying serial_nos would be destructive and we can't
    distinguish migration-assigned values from user-visible ones."""


class Migration(migrations.Migration):
    dependencies = [
        ("tasks", "0009_materialize_existing_engagements"),
    ]
    operations = [
        migrations.RunPython(forward, backward),
    ]
