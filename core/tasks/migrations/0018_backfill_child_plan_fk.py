from django.db import migrations


def backfill(apps, schema_editor):
    Task = apps.get_model("tasks", "Task")
    Plan = apps.get_model("tasks", "TaskSubcategoryPlan")

    # Map (main_task_id, subcategory_id) -> plan_id for master-backed plans.
    plan_by_key = {
        (p.main_task_id, p.subcategory_id): p.pk
        for p in Plan.objects.filter(subcategory__isnull=False).iterator()
    }
    # Children link to their plan via (parent_id, category_id). Rows whose
    # pair has no plan (manual/legacy one-offs) stay plan=NULL.
    for child in Task.objects.filter(
        parent__isnull=False, category__isnull=False, plan__isnull=True
    ).iterator():
        plan_id = plan_by_key.get((child.parent_id, child.category_id))
        if plan_id is not None:
            Task.objects.filter(pk=child.pk).update(plan_id=plan_id)


def noop_reverse(apps, schema_editor):
    Task = apps.get_model("tasks", "Task")
    Task.objects.filter(plan__isnull=False).update(plan=None)


class Migration(migrations.Migration):
    dependencies = [("tasks", "0017_add_child_plan_fk")]
    operations = [migrations.RunPython(backfill, noop_reverse)]
