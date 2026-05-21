from django.db import migrations


def forwards(apps, schema_editor):
    OperationalStandup = apps.get_model("pace", "OperationalStandup")
    OperationalStandupApproval = apps.get_model("pace", "OperationalStandupApproval")

    # Walk the existing table grouped by (profile, date). For each group:
    # 1. pick a canonical row (prefer Approved, then most-recent updated_at)
    # 2. emit one Approval per row carrying its status/approved_by/etc.
    # 3. delete the non-canonical rows.
    rows = list(OperationalStandup.objects.all().order_by("profile_id", "standup_date", "id"))
    if not rows:
        return

    groups: dict[tuple[int, object], list] = {}
    for r in rows:
        groups.setdefault((r.profile_id, r.standup_date), []).append(r)

    approvals_to_create = []
    rows_to_delete = []

    for group in groups.values():
        group.sort(
            key=lambda r: (
                0 if r.status == "Approved" else 1,
                -(r.updated_at.timestamp() if r.updated_at else 0),
            )
        )
        canonical = group[0]
        # Every row in the group (including canonical) becomes one Approval
        # carrying its original org + status.
        for r in group:
            approvals_to_create.append(
                OperationalStandupApproval(
                    standup_id=canonical.id,
                    org_id=r.org_id,
                    status=r.status or "Pending",
                    approved_by_id=r.approved_by_id,
                    approved_at=r.approved_at,
                    reviewed_by_id=r.reviewed_by_id,
                    reviewed_at=r.reviewed_at,
                )
            )
            if r.id != canonical.id:
                rows_to_delete.append(r.id)

    OperationalStandupApproval.objects.bulk_create(approvals_to_create, batch_size=1000)
    if rows_to_delete:
        OperationalStandup.objects.filter(id__in=rows_to_delete).delete()


def backwards(apps, schema_editor):
    # We have already lost which OperationalStandup row each Approval came
    # from — the dedupe collapsed siblings. A faithful reverse is impossible,
    # so the safest thing is to clear the new table and leave the canonical
    # rows in place; an operator can re-import historic data from a backup if
    # needed.
    OperationalStandupApproval = apps.get_model("pace", "OperationalStandupApproval")
    OperationalStandupApproval.objects.all().delete()


class Migration(migrations.Migration):
    dependencies = [("pace", "0005_operationalstandupapproval")]

    operations = [
        migrations.RunPython(forwards, backwards, atomic=True),
    ]
