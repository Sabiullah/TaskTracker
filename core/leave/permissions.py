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

    # Employee — only managers who are actually members of `org` can approve.
    # The `managers` M2M is org-agnostic, so a global lookup could return a
    # manager from a different org as a "valid" approver here.
    manager_ids = list(
        requester.managers.filter(memberships__org=org).values_list("pk", flat=True).distinct()
    )
    if manager_ids:
        return manager_ids
    # Fallback: admins of the request's org
    return list(
        User.objects.filter(memberships__org=org, memberships__role="admin")
        .values_list("pk", flat=True)
    )


def can_approve(actor: User, requester: User, org) -> bool:
    """Return True iff `actor` may approve a request from `requester` in `org`.

    Self-approve is always blocked.  An empty approver pool means either:
      - the requester is admin (auto-approve handled at the call site), or
      - the org is misconfigured (no admins at all to fall back to).
    Both produce False here so that no peer ever silently approves on the
    requester's behalf; callers must treat empty-pool admin requests as
    auto-approved before calling this function.
    """
    if actor.pk == requester.pk:
        return False
    pool = approver_pool(requester, org)
    if not pool:
        if requester.role_in(org) != "admin":
            import logging
            logging.getLogger(__name__).warning(
                "approver_pool empty for non-admin user %s in org %s — org may have no admins",
                requester.pk, org,
            )
        return False
    return actor.pk in pool
