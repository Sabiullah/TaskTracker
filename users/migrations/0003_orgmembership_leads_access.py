import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0002_remove_user_attendance_access_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="orgmembership",
            name="leads_access",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="orgmembership",
            name="leads_access_granted_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="orgmembership",
            name="leads_access_granted_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
