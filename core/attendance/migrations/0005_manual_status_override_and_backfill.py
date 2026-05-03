from django.db import migrations, models

# Threshold constants (kept here so the migration is self-contained — the
# model module isn't imported in migrations).
HALF_DAY_HOURS = 4
FULL_DAY_HOURS = 6


def _derived_status(login_time, logout_time):
    """Mirror Attendance._derive_status using historical model values."""
    if not login_time or not logout_time:
        return None
    login_m = login_time.hour * 60 + login_time.minute
    logout_m = logout_time.hour * 60 + logout_time.minute
    minutes = max(0, logout_m - login_m)
    h = minutes / 60
    if h < HALF_DAY_HOURS:
        return "Absent"
    if h <= FULL_DAY_HOURS:
        return "Half Day"
    return "Present"


def backfill_status_from_hours(apps, schema_editor):
    """Re-derive ``status`` for existing rows under the new 3-way rule.

    Skips Leave rows (treated as explicit) and rows without complete punch
    timing (cannot derive). Uses historical-model save() so no app-level
    ``_derive_status`` runs — we set the field directly.
    """
    Attendance = apps.get_model("attendance", "Attendance")
    qs = Attendance.objects.exclude(status="Leave").exclude(login_time=None).exclude(logout_time=None)
    for row in qs.iterator():
        new_status = _derived_status(row.login_time, row.logout_time)
        if new_status is not None and row.status != new_status:
            row.status = new_status
            row.save(update_fields=["status"])


def reverse_backfill(apps, schema_editor):
    # Backfill is informational and no perfect inverse exists (the old rule
    # only flipped Present↔Absent at 4h and never produced Half Day). Leave
    # the data as-is on reverse so we don't destroy admin corrections.
    return


class Migration(migrations.Migration):

    dependencies = [
        ("attendance", "0004_backfill_wfh_approved"),
    ]

    operations = [
        migrations.AddField(
            model_name="attendance",
            name="manual_status_override",
            field=models.BooleanField(default=False),
        ),
        migrations.RunPython(backfill_status_from_hours, reverse_backfill),
    ]
