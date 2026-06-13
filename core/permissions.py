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


def _access_org(obj):
    """Resolve the Org an access check should run against.

    Most rows carry ``org`` directly; ``EmployeeSalary`` inherits its org
    from the parent ``employee`` FK, so fall back to that when the row has no
    org of its own.
    """
    org = _obj_org(obj)
    if org is not None:
        return org
    parent = getattr(obj, "employee", None)
    return _obj_org(parent) if parent is not None else None


class IsAdminOrEmployeeAccess(permissions.BasePermission):
    """Employee Management gate.

    Reads are open to any authenticated caller — the viewset's queryset
    (``_employee_visibility_q``) already narrows rows to what the caller may
    see. Writes require the caller to be **admin OR hold the per-org
    ``employee_access`` flag** in the row's org. This makes an
    ``employee_access`` holder admin-equivalent inside the Employee module
    without granting Leave/WFH approval (that stays in ``can_approve``).

    On create there's no object yet, so ``has_permission`` only checks the
    caller has admin/employee_access in *some* org; ``resolve_create_org``
    then pins the actual org and rejects creates outside the caller's orgs.
    """

    def has_permission(self, request, view):
        if request.method in permissions.SAFE_METHODS:
            return request.user.is_authenticated
        u = _as_user(request)
        return bool(u and (u.is_admin_in_any() or u.has_employee_in_any()))

    def has_object_permission(self, request, view, obj):
        if request.method in permissions.SAFE_METHODS:
            return True
        u = _as_user(request)
        org = _access_org(obj)
        return bool(u and (u.is_admin_in(org) or u.has_employee_in(org)))


# ─── Menu-rights gate (per-user view/edit on a catalog menu code) ────────────


class HasMenuRight(permissions.BasePermission):
    """Generic menu-rights gate.

    The view must expose ``menu_code`` (str) and ``get_menu_org(request)``
    returning the Org the right is checked against. SAFE_METHODS require
    ``can_view``; writes require ``can_edit``. Admins override.
    """

    def has_permission(self, request, view):
        u = _as_user(request)
        if u is None:
            return False
        code = getattr(view, "menu_code", "")
        get_org = getattr(view, "get_menu_org", None)
        org = get_org(request) if get_org else None
        if request.method in permissions.SAFE_METHODS:
            return u.menu_view_in(org, code)
        return u.menu_edit_in(org, code)


class MenuGatedViewSet:
    """Mixin: set ``menu_code`` and implement ``get_menu_org`` (or rely on the
    default below) to gate a viewset on menu rights."""

    menu_code: str = ""
    permission_classes = [HasMenuRight]

    def get_menu_org(self, request):
        """Default: the org from the ``?org=`` query param, else the caller's
        default org. Override for viewsets that resolve org differently."""
        from users.views import _resolve_org

        ident = request.query_params.get("org") or request.data.get("org")
        org = _resolve_org(ident)
        if org is not None:
            return org
        u = _as_user(request)
        return u.default_org if u else None


# ─── Legacy aliases — existing decorators keep working ───────────────────────

IsAdmin = IsAdminInAny
IsAdminOrManager = IsAdminOrManagerInAny
IsAdminOrReadOnly = IsAdminOrReadOnlyInAny
