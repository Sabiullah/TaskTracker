# Persist the "report required" flag across months.
#
# Drops MonthlyReportRequirement.year_month so the toggle becomes a
# per-(org, client) setting. Pre-deduplicates by keeping the most-recent
# row per (org, client) — its ``required`` value wins.

from django.db import migrations, models


def dedupe_then_drop(apps, schema_editor):
    Requirement = apps.get_model("masters", "MonthlyReportRequirement")
    seen: dict[tuple[int, int], int] = {}
    # Newest first — first one we see for each (org, client) is the keeper.
    for row in Requirement.objects.order_by("-updated_at", "-id"):
        key = (row.org_id, row.client_id)
        if key in seen:
            row.delete()
        else:
            seen[key] = row.id


class Migration(migrations.Migration):
    dependencies = [
        ("masters", "0012_client_monthly_report"),
    ]

    operations = [
        migrations.RunPython(dedupe_then_drop, reverse_code=migrations.RunPython.noop),
        migrations.AlterUniqueTogether(
            name="monthlyreportrequirement",
            unique_together={("org", "client")},
        ),
        migrations.RemoveIndex(
            model_name="monthlyreportrequirement",
            name="mrr_org_month_idx",
        ),
        migrations.RemoveField(
            model_name="monthlyreportrequirement",
            name="year_month",
        ),
        migrations.AlterModelOptions(
            name="monthlyreportrequirement",
            options={
                "ordering": ["client__name"],
                "verbose_name": "monthly report requirement",
                "verbose_name_plural": "monthly report requirements",
            },
        ),
        migrations.AddIndex(
            model_name="monthlyreportrequirement",
            index=models.Index(fields=["org", "required"], name="mrr_org_required_idx"),
        ),
    ]
