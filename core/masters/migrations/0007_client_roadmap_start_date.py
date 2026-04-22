# Generated for start_date field on ClientRoadmap

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("masters", "0006_client_roadmap_expected_date"),
    ]

    operations = [
        migrations.AddField(
            model_name="clientroadmap",
            name="start_date",
            field=models.DateField(blank=True, null=True),
        ),
    ]
