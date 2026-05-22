from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("leave", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="leaverequest",
            name="request_type",
            field=models.CharField(
                choices=[("Leave", "Leave"), ("WFH", "WFH")],
                db_index=True,
                default="Leave",
                max_length=8,
            ),
        ),
    ]
