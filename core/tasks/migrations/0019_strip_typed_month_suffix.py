"""One-time cleanup: strip hand-typed ' — Mon YYYY' suffixes from task and
plan descriptions.

The month a Monthly row covers is now derived live from ``target_date`` in
the UI. Historically users typed it into the free-text description (e.g.
``BRS — Jun 2026``), which was inconsistent and went stale. Removing the
stored suffix prevents a doubled month (``BRS — Jun 2026 — May 2026``) once
the derived label renders.

Only a trailing separator + month token + 4-digit year is removed, so text
like ``Audit FY 2025`` (no month before the year) is left intact.
"""

import re

from django.db import migrations

# Trailing:  <space?> (— | – | -) <space?> <Jan..Dec + optional rest> <space> <YYYY>
_MONTH_SUFFIX = re.compile(
    r"\s*[—–-]\s*"
    r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?"
    r"\s+\d{4}\s*$",
    re.IGNORECASE,
)


def _strip_month_suffix(text):
    if not text:
        return text
    return _MONTH_SUFFIX.sub("", text).rstrip()


def strip_month_suffix(apps, schema_editor):
    Task = apps.get_model("tasks", "Task")
    Plan = apps.get_model("tasks", "TaskSubcategoryPlan")
    for Model in (Task, Plan):
        to_update = []
        for obj in Model.objects.exclude(description__isnull=True).exclude(description="").iterator():
            cleaned = _strip_month_suffix(obj.description)
            if cleaned != obj.description:
                obj.description = cleaned
                to_update.append(obj)
        if to_update:
            Model.objects.bulk_update(to_update, ["description"], batch_size=500)


class Migration(migrations.Migration):

    dependencies = [
        ("tasks", "0018_backfill_child_plan_fk"),
    ]

    operations = [
        migrations.RunPython(strip_month_suffix, migrations.RunPython.noop),
    ]
