# Add per-sub-category recurrence + target day so the Add Task modal can
# materialise multiple subtask rows from a single template (one row per
# occurrence) instead of one row per sub-category.

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("masters", "0014_master_parent"),
    ]

    operations = [
        migrations.AddField(
            model_name="master",
            name="recurrence",
            field=models.CharField(
                blank=True,
                choices=[
                    ("Onetime", "One-time"),
                    ("Monthly", "Monthly"),
                    ("Quarterly", "Quarterly"),
                    ("Halfyearly", "Half-yearly"),
                    ("Yearly", "Yearly"),
                ],
                default="",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="master",
            name="target_day",
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
    ]
