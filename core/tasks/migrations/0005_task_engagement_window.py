from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("tasks", "0004_task_parent"),
    ]

    operations = [
        migrations.AddField(
            model_name="task",
            name="engagement_end",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="task",
            name="engagement_start",
            field=models.DateField(blank=True, null=True),
        ),
    ]
