from typing import TYPE_CHECKING

from django.utils import timezone

from users.models import OrgMembership

if TYPE_CHECKING:
    from users.models import User

    from ..models import OperationalStandup


def ensure_approvals_for_standup(
    standup: "OperationalStandup",
    creator: "User | None" = None,
) -> None:
    """Create one OperationalStandupApproval per profile-membership org.

    Skips memberships flagged exclude_from_operational_standup. If creator
    is admin/manager in any of those orgs, the matching approval rows start
    as Approved with creator recorded; the rest stay Pending. Idempotent.
    """
    from ..models import OperationalStandupApproval

    memberships = OrgMembership.objects.filter(
        user_id=standup.profile_id,
        exclude_from_operational_standup=False,
    ).select_related("org")

    if creator is not None:
        manager_org_ids = set(
            OrgMembership.objects.filter(
                user=creator, role__in=["admin", "manager"]
            ).values_list("org_id", flat=True)
        )
    else:
        manager_org_ids = set()

    now = timezone.now()
    existing_org_ids = set(standup.approvals.values_list("org_id", flat=True))
    to_create = []
    for m in memberships:
        if m.org_id in existing_org_ids:
            continue
        if creator is not None and m.org_id in manager_org_ids:
            to_create.append(
                OperationalStandupApproval(
                    standup=standup,
                    org=m.org,
                    status="Approved",
                    approved_by=creator,
                    approved_at=now,
                )
            )
        else:
            to_create.append(
                OperationalStandupApproval(standup=standup, org=m.org)
            )
    if to_create:
        OperationalStandupApproval.objects.bulk_create(to_create)
