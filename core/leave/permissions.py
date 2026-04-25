"""Approver-pool resolution shared by Leave + WFH approval flows.

Keeps the rule single-sourced: employee → managers; manager → admins;
admin → auto-approved.
"""

from __future__ import annotations

from users.models import User


def approver_pool(requester: User, org) -> list[int]:
    """User IDs who may approve a request from `requester` in `org`.

    Empty list means "auto-approve" (only happens when requester is admin).
    """
    role = requester.role_in(org)
    if role == "admin":
        return []  # auto-approve

    if role == "manager":
        return list(
            User.objects.filter(memberships__org=org, memberships__role="admin")
            .exclude(pk=requester.pk)
            .values_list("pk", flat=True)
        )

    # Employee
    manager_ids = list(requester.managers.values_list("pk", flat=True))
    if manager_ids:
        return manager_ids
    # Fallback: admins of the request's org
    return list(
        User.objects.filter(memberships__org=org, memberships__role="admin")
        .values_list("pk", flat=True)
    )


def can_approve(actor: User, requester: User, org) -> bool:
    if actor.pk == requester.pk:
        return False
    pool = approver_pool(requester, org)
    if not pool:
        # Auto-approve case: only the requester themselves "approves" — any
        # other user calling Approve is rejected.
        return False
    return actor.pk in pool
