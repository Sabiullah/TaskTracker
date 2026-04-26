from django.db import migrations


def forward(apps, schema_editor):
    Attendance = apps.get_model("attendance", "Attendance")
    Attendance.objects.filter(work_location="WFH", approval_state__isnull=True).update(approval_state="Approved")


def backward(apps, schema_editor):
    # Non-reversible in spirit — but we restore null to be technically reversible.
    Attendance = apps.get_model("attendance", "Attendance")
    Attendance.objects.filter(work_location="WFH").update(approval_state=None)


class Migration(migrations.Migration):
    dependencies = [
        ("attendance", "0003_attendance_wfh_approval"),
    ]
    operations = [migrations.RunPython(forward, backward)]
