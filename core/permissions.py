"""Shared DRF permission classes — multi-org aware.

Role now lives on ``users.OrgMembership.role`` (per-org). A user can be admin
in one org and employee in another.

Two levels of permission class:

  ``Is<Role>InAny``    — list-level gate: "can this user touch things at all"
                         (they're admin/manager in at least one org they belong to).
  ``PerOrg<Role>``     — object-level gate: "can this user touch THIS row"
                         (they are admin/manager in ``obj.org``).

Viewsets that already filter their queryset down to orgs the caller belongs
to can use the list-level gate; viewsets that need finer-grained control
combine the list-level gate with the object-level gate.

The legacy names ``IsAdmin`` / ``IsAdminOrManager`` / ``IsAdminOrReadOnly`` are
kept as aliases of their ``*InAny`` counterparts so existing decorators
(``@permission_classes([IsAdmin])``) keep working unchanged.
"""

from typing import cast

from rest_framework import permissions

from users.models import User


def _as_user(request) -> User | None:
    """Narrow ``request.user`` to our concrete User (not AnonymousUser).

    DRF types ``request.user`` as ``AbstractBaseUser | AnonymousUser``; our
    multi-org helpers live on the subclass, so pyright can't see them
    without an explicit cast. Returns ``None`` for anonymous callers so
    every permission class uniformly short-circuits to ``False``.
    """
    u = request.user
    if not u.is_authenticated:
        return None
    return cast(User, u)


# ─── List-level gates ────────────────────────────────────────────────────────


class IsAdminInAny(permissions.BasePermission):
    """User is admin in at least one org they belong to."""

    def has_permission(self, request, view):
        u = _as_user(request)
        return bool(u and u.is_admin_in_any())


class IsAdminOrManagerInAny(permissions.BasePermission):
    """User is admin or manager in at least one org."""

    def has_permission(self, request, view):
        u = _as_user(request)
        return bool(u and u.is_manager_in_any())


class IsAdminOrReadOnlyInAny(permissions.BasePermission):
    def has_permission(self, request, view):
        if request.method in permissions.SAFE_METHODS:
            return request.user.is_authenticated
        u = _as_user(request)
        return bool(u and u.is_admin_in_any())


class IsAdminOrManagerOrReadOnlyInAny(permissions.BasePermission):
    """Reads allowed for any authenticated user; writes need admin/manager in at
    least one org."""

    def has_permission(self, request, view):
        if request.method in permissions.SAFE_METHODS:
            return request.user.is_authenticated
        u = _as_user(request)
        return bool(u and u.is_manager_in_any())


# ─── Object-level gates (per-row org) ────────────────────────────────────────


def _obj_org(obj):
    """Fetch the Org FK from ``obj`` regardless of whether the field holds an
    Org instance or just an id. Returns None if the object carries no org."""
    org = getattr(obj, "org", None)
    if org is None:
        return getattr(obj, "org_id", None)
    return org


class PerOrgAdmin(permissions.BasePermission):
    """Caller must be admin in ``obj.org`` for write methods."""

    def has_permission(self, request, view):
        return request.user.is_authenticated

    def has_object_permission(self, request, view, obj):
        if request.method in permissions.SAFE_METHODS:
            return True
        u = _as_user(request)
        return bool(u and u.is_admin_in(_obj_org(obj)))


class PerOrgManager(permissions.BasePermission):
    """Caller must be admin or manager in ``obj.org`` for write methods."""

    def has_permission(self, request, view):
        return request.user.is_authenticated

    def has_object_permission(self, request, view, obj):
        if request.method in permissions.SAFE_METHODS:
            return True
        u = _as_user(request)
        return bool(u and u.is_manager_in(_obj_org(obj)))


# ─── Legacy aliases — existing decorators keep working ───────────────────────

IsAdmin = IsAdminInAny
IsAdminOrManager = IsAdminOrManagerInAny
IsAdminOrReadOnly = IsAdminOrReadOnlyInAny
