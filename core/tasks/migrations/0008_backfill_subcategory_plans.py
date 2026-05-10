from django.db import migrations


def forward(apps, schema_editor):
    Task = apps.get_model("tasks", "Task")
    TaskSubcategoryPlan = apps.get_model("tasks", "TaskSubcategoryPlan")
    Master = apps.get_model("masters", "Master")
    from core.tasks.migrations._helpers_backfill import backfill_plans_for_task

    for goal in Task.objects.filter(parent__isnull=True).iterator():
        backfill_plans_for_task(goal, Task, TaskSubcategoryPlan, Master)


def backward(apps, schema_editor):
    TaskSubcategoryPlan = apps.get_model("tasks", "TaskSubcategoryPlan")
    TaskSubcategoryPlan.objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [
        ("tasks", "0007_plan_uid"),
        ("masters", "0015_master_recurrence_target_day"),
    ]
    operations = [
        migrations.RunPython(forward, backward),
    ]
