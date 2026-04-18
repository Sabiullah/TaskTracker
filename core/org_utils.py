"""Shared org-resolution helpers used by every viewset.

When a viewset reads or writes rows, it needs two things:

  1. Which orgs the caller can see — used to filter the queryset.
     Every list endpoint returns a merged view of every org the user belongs
     to; the caller decides per-row which org the row came from using the
     `org` FK.

  2. Which org a newly-created row should land in.
     If the user belongs to exactly one org, that's the default. If they
     belong to 2+, the payload must specify one (``org_id`` / ``org_uid`` /
     ``org``). If the user tries to create a row in an org they don't belong
     to, the helper returns a 403.

These helpers centralise the policy so every viewset stays consistent.
"""

from __future__ import annotations

import uuid as _uuid

from rest_framework.response import Response

from users.models import Org


def caller_org_ids(user):
    """Org IDs the caller belongs to, usable directly in
    ``Model.objects.filter(org_id__in=caller_org_ids(user))``.
    """
    return user.org_ids()


def scoped(qs, user):
    """Narrow any queryset on a model with an ``org`` FK to the caller's orgs."""
    return qs.filter(org_id__in=user.org_ids())


def resolve_org(ident) -> Org | None:
    """Look up an Org from a heterogeneous identifier.

    Accepts:
      - int or digit string  → primary-key lookup
      - 36-char UUID string  → uid lookup
      - Org instance         → returned as-is
    """
    if ident is None or ident == "":
        return None
    if isinstance(ident, Org):
        return ident
    if isinstance(ident, int) or (isinstance(ident, str) and ident.isdigit()):
        return Org.objects.filter(pk=int(ident)).first()
    try:
        parsed = _uuid.UUID(str(ident))
    except (ValueError, AttributeError):
        return None
    return Org.objects.filter(uid=parsed).first()


def visibility_q(user, owner_field: str):
    """Build a per-org-role visibility filter for list querysets.

    The legacy single-org pattern was ``if role == admin: return all; elif
    manager: subordinates; else: own``. In multi-org, a single user can hold
    different roles in different orgs — so the filter must apply the rule
    PER org, not globally.

    Given a user who is admin in org 4D and employee in org YBV:
      - rows in 4D  → admin → every row is visible
      - rows in YBV → employee → only rows they own are visible
      - rows in any org they don't belong to → hidden

    ``owner_field`` is the FK on the model that names "who owns this row"
    (``responsible`` on Task, ``user`` on WorkLog/Attendance, ``assigned_to``
    on Lead/GrowthPlan/WorkPlan, ``profile`` on PaceGoal). Pass the attname
    without the ``_id`` suffix.

    Returns a ``Q`` object. Use like::

        qs.filter(visibility_q(user, "responsible")).order_by(...)
    """
    from django.db.models import Q

    admin_ids = list(user.memberships.filter(role="admin").values_list("org_id", flat=True))
    manager_ids = list(user.memberships.filter(role="manager").values_list("org_id", flat=True))
    employee_ids = list(user.memberships.filter(role="employee").values_list("org_id", flat=True))

    subordinate_ids = list(user.subordinates.values_list("id", flat=True)) + [user.id]
    owner_fk = f"{owner_field}_id"

    # Build the OR union only from non-empty branches; an empty Q() evaluates
    # to "match everything" which is exactly what we don't want.
    q = Q(pk__in=[])
    if admin_ids:
        q |= Q(org_id__in=admin_ids)
    if manager_ids:
        q |= Q(org_id__in=manager_ids, **{f"{owner_fk}__in": subordinate_ids})
    if employee_ids:
        q |= Q(org_id__in=employee_ids, **{owner_fk: user.id})
    return q


def resolve_admin_org(request) -> tuple[Org | None, Response | None]:
    """Like ``resolve_create_org`` but the caller must be *admin* of the org.

    Used by destructive bulk actions (``*.bulk_create``, ``*.delete_all``)
    and admin-only endpoints (backup, restore, invoice approve/reject) so
    that admin-in-one-org can't run admin actions in an org where they are
    just an employee.
    """
    user = request.user
    admin_ids = set(user.memberships.filter(role="admin").values_list("org_id", flat=True))
    if not admin_ids:
        return None, Response(
            {"error": "Admin role required in at least one organisation"},
            status=403,
        )

    data = getattr(request, "data", None) or {}
    ident = data.get("org_id") or data.get("org_uid") or data.get("org") or request.query_params.get("org")
    if ident:
        org = resolve_org(ident)
        if org is None:
            return None, Response({"error": f"Unknown organisation: {ident!r}"}, status=400)
        if org.id not in admin_ids:
            return None, Response({"error": "You are not an admin of that organisation"}, status=403)
        return org, None

    if len(admin_ids) == 1:
        return Org.objects.filter(pk=next(iter(admin_ids))).first(), None

    return None, Response({"error": "`org` is required (you are admin in multiple orgs)"}, status=400)


def resolve_create_org(request) -> tuple[Org | None, Response | None]:
    """Pick the org a newly-created row should belong to.

    Returns a tuple ``(org, error_response)`` — exactly one of the two will be
    non-None. Viewsets use it like::

        org, err = resolve_create_org(self.request)
        if err is not None:
            return err   # or raise drf-style; see PermissionDenied below
        serializer.save(created_by=self.request.user, org=org, ...)
    """
    user = request.user
    member_ids = set(user.org_ids())

    if not member_ids:
        return None, Response({"error": "User is not a member of any organisation"}, status=400)

    data = getattr(request, "data", None) or {}
    ident = data.get("org_id") or data.get("org_uid") or data.get("org")

    if ident:
        org = resolve_org(ident)
        if org is None:
            return None, Response({"error": f"Unknown organisation: {ident!r}"}, status=400)
        if org.id not in member_ids:
            return None, Response({"error": "You are not a member of that organisation"}, status=403)
        return org, None

    # No explicit org in payload — only allowed when user has exactly one org.
    if len(member_ids) == 1:
        return Org.objects.filter(pk=next(iter(member_ids))).first(), None

    return None, Response(
        {"error": "`org` is required (you belong to multiple organisations)"},
        status=400,
    )
