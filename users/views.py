from typing import cast

from django.contrib.auth import authenticate
from django.db import transaction
from django.utils import timezone
from rest_framework import permissions, serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet
from rest_framework_simplejwt.tokens import RefreshToken

from core.permissions import IsAdmin

from .models import ACCESS_FEATURES, Org, OrgMembership, User

# ─────────────────────────────────────────────────────────────────────────────
# Serializers
# ─────────────────────────────────────────────────────────────────────────────


class OrgSerializer(serializers.ModelSerializer):
    class Meta:
        model = Org
        fields = ["id", "uid", "name", "created_at", "updated_at"]
        read_only_fields = ["id", "uid", "created_at", "updated_at"]


def _membership_to_dict(m: OrgMembership) -> dict:
    """Flatten an OrgMembership into the Shape-A per-org object.

    One dict carries both org identity and everything scoped to that membership
    (role, is_default, all five access flags + their audit fields). The
    frontend maps over ``user.orgs`` and renders one row or card per org.
    """
    out: dict = {
        "id": m.org_id,
        "uid": str(m.org.uid),
        "name": m.org.name,
        "role": m.role,
        "is_default": m.is_default,
        "exclude_from_operational_standup": m.exclude_from_operational_standup,
    }
    for feat in ACCESS_FEATURES:
        out[feat] = getattr(m, feat)
        granted_by = getattr(m, f"{feat}_granted_by", None)
        out[f"{feat}_granted_by"] = str(granted_by.uid) if granted_by else None
        out[f"{feat}_granted_at"] = getattr(m, f"{feat}_granted_at", None)
    out["menu_rights"] = {r.menu_code: {"view": r.can_view, "edit": r.can_edit} for r in m.menu_rights.all()}
    return out


class UserSerializer(serializers.ModelSerializer):
    manager_ids = serializers.SerializerMethodField()
    manager_id = serializers.SerializerMethodField()
    orgs = serializers.SerializerMethodField()
    highest_role = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "uid",
            "username",
            "email",
            "full_name",
            "avatar_color",
            "is_active",
            "manager_id",
            "manager_ids",
            "orgs",
            "highest_role",
        ]
        read_only_fields = ["id", "uid"]

    def get_manager_ids(self, obj):
        return list(obj.managers.values_list("uid", flat=True))

    def get_manager_id(self, obj):
        first = obj.managers.first()
        return str(first.uid) if first else None

    def get_orgs(self, obj):
        qs = (
            obj.memberships.select_related("org")
            .prefetch_related("menu_rights")
            .order_by("-is_default", "org__name")
        )
        return [_membership_to_dict(m) for m in qs]

    def get_highest_role(self, obj):
        return obj.highest_role


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────


def _get_user_by_uid(uid: str) -> User:
    return User.objects.get(uid=uid)


def _resolve_org(org_ident) -> Org | None:
    """Accept an org id (int) or org uid (str/UUID); return the Org or None."""
    if org_ident in (None, ""):
        return None
    try:
        if isinstance(org_ident, int) or str(org_ident).isdigit():
            return Org.objects.filter(pk=int(org_ident)).first()
        return Org.objects.filter(uid=str(org_ident)).first()
    except (ValueError, Org.DoesNotExist):
        return None


def _caller_admin_orgs(user: User):
    """Org IDs where the calling user is admin — used to scope what they can edit."""
    return user.memberships.filter(role="admin").values_list("org_id", flat=True)


def _caller_can_see(caller: User, target: User) -> bool:
    """Caller can see `target` only if they share at least one org."""
    caller_orgs = set(caller.org_ids())
    target_orgs = set(target.org_ids())
    return bool(caller_orgs & target_orgs)


# ─────────────────────────────────────────────────────────────────────────────
# Auth
# ─────────────────────────────────────────────────────────────────────────────


@api_view(["POST"])
@permission_classes([permissions.AllowAny])
def login(request):
    credential = request.data.get("username", "").strip()
    password = request.data.get("password", "")

    if not credential or not password:
        return Response(
            {"error": "Credential and password are required"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    authed = authenticate(request, username=credential, password=password)

    if authed is None:
        return Response({"error": "Invalid credentials"}, status=status.HTTP_401_UNAUTHORIZED)

    # django-stubs narrows this cast as redundant (AUTH_USER_MODEL=User, so
    # `authenticate` already returns User|None); pyright does NOT have that
    # knowledge and treats the value as `AbstractBaseUser`. The `type: ignore`
    # lets us keep the cast so our multi-org helpers are visible to both.
    user = cast(User, authed)  # type: ignore[redundant-cast]
    refresh = RefreshToken.for_user(user)
    # Embed org_ids in the token so Channels / any other token-only auth path
    # doesn't need a DB round-trip to know which orgs the user belongs to.
    refresh["org_ids"] = list(user.org_ids())

    return Response(
        {
            "access": str(refresh.access_token),
            "refresh": str(refresh),
            "user": UserSerializer(user).data,
        }
    )


@api_view(["POST"])
@permission_classes([permissions.IsAuthenticated])
def logout(request):
    refresh_token = request.data.get("refresh")
    if refresh_token:
        try:
            token = RefreshToken(refresh_token)
            token.blacklist()
        except Exception:
            pass
    return Response({"ok": True})


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def me(request):
    return Response(UserSerializer(request.user).data)


# ─────────────────────────────────────────────────────────────────────────────
# Organisations
# ─────────────────────────────────────────────────────────────────────────────


class OrgViewSet(ModelViewSet):
    """CRUD for organisations. Reads are scoped to orgs the caller belongs to.

    Writes require admin in any org (admins can create new orgs; membership
    can be added later). This is an internal app so we don't need strict
    tenant isolation — callers just see the orgs they actually belong to.
    """

    serializer_class = OrgSerializer
    lookup_field = "uid"

    def get_permissions(self):
        if self.request.method in ("GET", "HEAD", "OPTIONS"):
            return [permissions.IsAuthenticated()]
        return [IsAdmin()]

    def get_queryset(self):
        user = cast(User, self.request.user)
        if self.request.method in ("GET", "HEAD", "OPTIONS"):
            return Org.objects.filter(id__in=user.org_ids())
        return Org.objects.all()


# ─────────────────────────────────────────────────────────────────────────────
# User list / CRUD
# ─────────────────────────────────────────────────────────────────────────────


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def profiles(request):
    """List users the caller can see: anyone sharing at least one org.

    Optional ``?active=true|false`` filter, ``?org=<id|uid>`` to narrow to
    a specific org.
    """
    caller_orgs = set(request.user.org_ids())
    qs = User.objects.filter(memberships__org_id__in=caller_orgs).distinct()

    active_param = request.query_params.get("active")
    if active_param is not None:
        qs = qs.filter(is_active=active_param.lower() == "true")

    org_ident = request.query_params.get("org")
    if org_ident:
        org = _resolve_org(org_ident)
        if org and org.id in caller_orgs:
            qs = qs.filter(memberships__org=org)

    return Response(UserSerializer(qs, many=True).data)


@api_view(["GET"])
@permission_classes([IsAdmin])
def existing_user_names(request):
    """Lightweight global list of every existing user's login identifiers.

    Returns ``[{username, full_name, email}]`` for ALL users regardless of
    org membership — the Create User dialog uses this to hide team-master
    members who already have an account in any org (every person has at
    most one login in this internal app). Admin-only.
    """
    rows = User.objects.values("username", "full_name", "email")
    return Response(list(rows))


@api_view(["POST"])
@permission_classes([IsAdmin])
def create_user(request):
    """Create a new user + their initial OrgMembership.

    Required: ``org_uid`` / ``org`` / ``org_id`` (the membership's org).
    The caller must be an admin of that org. Role/access flags in the payload
    are applied to the new membership. Manager assignment is optional.
    """
    username = request.data.get("username", "").strip()
    email = request.data.get("email", "").strip()
    password = request.data.get("password") or None
    role = request.data.get("role", "employee")
    full_name = request.data.get("full_name", "").strip()
    avatar_color = request.data.get("avatar_color", "")
    org_ident = request.data.get("org_uid") or request.data.get("org_id") or request.data.get("org")
    manager_uid = request.data.get("manager_uid") or request.data.get("manager_id")

    if not username and not email:
        return Response({"error": "Either username or email is required"}, status=400)

    # Internal multi-org app: a person may already have an account from a
    # different org the caller can't see. Treat "user already exists" as
    # "add membership to my org" rather than erroring out — the admin's
    # intent is the same either way. Caller still has to be admin of the
    # target org, and we still 400 if they're already a member there.
    existing = None
    if username:
        existing = User.objects.filter(username__iexact=username).first()
    if existing is None and email:
        existing = User.objects.filter(email__iexact=email).first()

    # Which org does the new user belong to?
    org = _resolve_org(org_ident)
    caller_admin_orgs = set(_caller_admin_orgs(request.user))
    if org is None:
        # Fall back to caller's sole admin org if they only manage one.
        if len(caller_admin_orgs) == 1:
            org = Org.objects.get(pk=next(iter(caller_admin_orgs)))
        else:
            return Response(
                {"error": "org is required (caller belongs to multiple orgs)"},
                status=400,
            )

    if org.id not in caller_admin_orgs:
        return Response({"error": "Not an admin of that organisation"}, status=403)

    membership_defaults: dict = {
        "role": role,
    }
    for feat in ACCESS_FEATURES:
        if feat in request.data:
            membership_defaults[feat] = bool(request.data[feat])
            if bool(request.data[feat]):
                membership_defaults[f"{feat}_granted_by"] = request.user
                membership_defaults[f"{feat}_granted_at"] = timezone.now()

    with transaction.atomic():
        if existing is not None:
            if OrgMembership.objects.filter(user=existing, org=org).exists():
                return Response(
                    {"error": f'"{existing}" is already a member of {org.name}'},
                    status=400,
                )
            # Don't auto-flag as default for an existing user — they probably
            # already have one elsewhere. Caller can re-default explicitly.
            OrgMembership.objects.create(user=existing, org=org, **membership_defaults)
            user = existing
        else:
            user = User.objects.create_user(
                username=username,
                email=email,
                password=password,
                full_name=full_name or username or email.split("@")[0],
                avatar_color=avatar_color,
            )
            membership_defaults["is_default"] = True
            OrgMembership.objects.create(user=user, org=org, **membership_defaults)

        if manager_uid:
            try:
                mgr = _get_user_by_uid(str(manager_uid))
                user.managers.add(mgr)
            except User.DoesNotExist:
                pass

    return Response(UserSerializer(user).data, status=201)


@api_view(["PATCH"])
@permission_classes([IsAdmin])
def update_user(request, user_uid):
    """Update a user's global profile fields and/or a specific membership.

    Payload fields:
      Global (all optional, require caller be admin in SOME shared org):
        full_name, username, email, is_active, avatar_color, manager_ids

      Per-org (require ``org``/``org_id``/``org_uid`` to pick the membership,
      caller must be admin of that org):
        role, invoice_access, notice_access, masters_access,
        attendance_access, employee_access, leads_access, conveyance_access

      is_default=True on the payload re-flags the specified membership as
      default (clears the flag on any other membership of this user).
    """
    try:
        user = _get_user_by_uid(user_uid)
    except User.DoesNotExist:
        return Response({"error": "Not found"}, status=404)

    # Caller must share an org with the target.
    if not _caller_can_see(request.user, user):
        return Response({"error": "Not found"}, status=404)

    caller_admin_orgs = set(_caller_admin_orgs(request.user))
    target_orgs = set(user.org_ids())
    shared_admin = caller_admin_orgs & target_orgs
    if not shared_admin:
        return Response({"error": "Not an admin in any shared organisation"}, status=403)

    with transaction.atomic():
        # ── Global fields ───────────────────────────────────────────────────
        for field in ("full_name", "username", "email", "is_active", "avatar_color"):
            if field in request.data:
                setattr(user, field, request.data[field])

        if "manager_ids" in request.data:
            user.managers.set(User.objects.filter(uid__in=request.data["manager_ids"]))

        user.save()

        # ── Per-org fields (role, access flags, is_default) ────────────────
        per_org_keys = {"role", "is_default", "exclude_from_operational_standup", *ACCESS_FEATURES}
        if any(k in request.data for k in per_org_keys):
            org_ident = request.data.get("org_uid") or request.data.get("org_id") or request.data.get("org")
            org = _resolve_org(org_ident)
            if org is None:
                return Response(
                    {"error": "org is required for role/access changes"},
                    status=400,
                )
            if org.id not in caller_admin_orgs:
                return Response({"error": "Not an admin of that organisation"}, status=403)

            membership, _ = OrgMembership.objects.get_or_create(user=user, org=org)

            if "role" in request.data:
                membership.role = request.data["role"]

            if "is_default" in request.data and request.data["is_default"]:
                # Clear default flag on the user's other memberships first
                OrgMembership.objects.filter(user=user).exclude(pk=membership.pk).update(is_default=False)
                membership.is_default = True

            # Access flags + audit
            for feat in ACCESS_FEATURES:
                if feat not in request.data:
                    continue
                new_val = bool(request.data[feat])
                old_val = getattr(membership, feat)
                setattr(membership, feat, new_val)
                if new_val and not old_val:
                    setattr(membership, f"{feat}_granted_by", request.user)
                    setattr(membership, f"{feat}_granted_at", timezone.now())
                elif not new_val:
                    setattr(membership, f"{feat}_granted_by", None)
                    setattr(membership, f"{feat}_granted_at", None)

            if "exclude_from_operational_standup" in request.data:
                membership.exclude_from_operational_standup = bool(request.data["exclude_from_operational_standup"])

            membership.save()

    return Response(UserSerializer(user).data)


@api_view(["PATCH"])
@permission_classes([permissions.IsAuthenticated])
def set_avatar_color(request, user_uid):
    """Set a user's avatar colour.

    Intentionally lighter-weight than ``update_user``: the caller only needs
    to share an org with the target user. This powers the Masters → Team
    Members tab, which is accessible to anyone with ``masters_access`` and
    shouldn't require full admin privileges just to recolour an avatar.
    """
    try:
        user = _get_user_by_uid(user_uid)
    except User.DoesNotExist:
        return Response({"error": "Not found"}, status=404)

    if not _caller_can_see(request.user, user):
        return Response({"error": "Not found"}, status=404)

    color = (request.data.get("avatar_color") or "").strip()
    user.avatar_color = color
    user.save(update_fields=["avatar_color"])
    return Response(UserSerializer(user).data)


@api_view(["DELETE"])
@permission_classes([IsAdmin])
def remove_membership(request, user_uid, org_uid):
    """Remove a user's membership in ``org_uid``.

    Caller must be admin of the target org. Refuses if this is the user's
    only membership (would leave them with no org to work in — delete the
    user via ``/users/delete/`` instead). If the removed membership was the
    user's default, promotes the first remaining membership as default.
    """
    try:
        user = _get_user_by_uid(str(user_uid))
    except User.DoesNotExist:
        return Response({"error": "User not found"}, status=404)

    if not _caller_can_see(request.user, user):
        return Response({"error": "User not found"}, status=404)

    org = _resolve_org(org_uid)
    if org is None:
        return Response({"error": f"Unknown organisation: {org_uid!r}"}, status=404)

    caller_admin_orgs = set(_caller_admin_orgs(request.user))
    if org.id not in caller_admin_orgs:
        return Response({"error": "Not an admin of that organisation"}, status=403)

    try:
        membership = OrgMembership.objects.get(user=user, org=org)
    except OrgMembership.DoesNotExist:
        return Response({"error": f"{user} is not a member of {org.name}"}, status=404)

    if OrgMembership.objects.filter(user=user).count() <= 1:
        return Response(
            {
                "error": (
                    "Cannot remove the user's only org membership. Delete the user instead if they no longer work here."
                )
            },
            status=400,
        )

    was_default = membership.is_default

    with transaction.atomic():
        membership.delete()
        if was_default:
            next_default = OrgMembership.objects.filter(user=user).order_by("id").first()
            if next_default is not None:
                next_default.is_default = True
                next_default.save(update_fields=["is_default"])

    return Response({"ok": True})


@api_view(["POST"])
@permission_classes([IsAdmin])
def reset_password(request):
    user_uid = request.data.get("user_uid") or request.data.get("user_id")
    new_password = request.data.get("new_password", "")
    if len(new_password) < 6:
        return Response({"error": "Password must be at least 6 characters"}, status=400)
    try:
        user = _get_user_by_uid(str(user_uid))
    except User.DoesNotExist:
        return Response({"error": "User not found"}, status=404)

    caller_admin_orgs = set(_caller_admin_orgs(request.user))
    target_orgs = set(user.org_ids())
    if not (caller_admin_orgs & target_orgs):
        return Response({"error": "User not found"}, status=404)

    user.set_password(new_password)
    user.save()
    return Response({"ok": True})


@api_view(["POST"])
@permission_classes([IsAdmin])
def delete_user(request):
    user_uid = request.data.get("user_uid") or request.data.get("user_id")
    try:
        user = _get_user_by_uid(str(user_uid))
    except User.DoesNotExist:
        return Response({"error": "User not found"}, status=404)

    caller_admin_orgs = set(_caller_admin_orgs(request.user))
    target_orgs = set(user.org_ids())
    if not (caller_admin_orgs & target_orgs):
        return Response({"error": "User not found"}, status=404)

    # Refuse if deleting them would leave any org with zero admins.
    for m in user.memberships.filter(role="admin").select_related("org"):
        other_admins = OrgMembership.objects.filter(org=m.org, role="admin").exclude(user=user).count()
        if other_admins == 0:
            return Response(
                {"error": f"Cannot delete: user is the only admin in '{m.org.name}'"},
                status=400,
            )

    user.delete()
    return Response({"ok": True})


# ─────────────────────────────────────────────────────────────────────────────
# Access-list endpoints (option i: one row per user-org pair, includes org_id)
# ─────────────────────────────────────────────────────────────────────────────


def _access_list(request, feature: str):
    """Shared implementation for the five per-feature access-list endpoints.

    Returns memberships where the given feature is enabled, scoped to orgs the
    caller belongs to. Each row contains user + org identifiers plus the
    granted-by / granted-at audit pair.
    """
    caller_orgs = set(request.user.org_ids())
    qs = OrgMembership.objects.filter(**{feature: True}, org_id__in=caller_orgs).select_related(
        "user", "org", f"{feature}_granted_by"
    )
    return Response(
        [
            {
                "user_id": str(m.user.uid),
                "user_uid": str(m.user.uid),
                "org_id": m.org_id,
                "org_uid": str(m.org.uid),
                "org_name": m.org.name,
                "enabled": True,
                "granted_by": (
                    str(getattr(m, f"{feature}_granted_by").uid) if getattr(m, f"{feature}_granted_by") else None
                ),
                "granted_at": getattr(m, f"{feature}_granted_at"),
            }
            for m in qs
        ]
    )


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def invoice_access_list(request):
    return _access_list(request, "invoice_access")


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def notice_access_list(request):
    return _access_list(request, "notice_access")


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def masters_access_list(request):
    return _access_list(request, "masters_access")


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def attendance_access_list(request):
    return _access_list(request, "attendance_access")


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def employee_access_list(request):
    return _access_list(request, "employee_access")


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def leads_access_list(request):
    return _access_list(request, "leads_access")


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def conveyance_access_list(request):
    return _access_list(request, "conveyance_access")
