from django.contrib.auth import authenticate
from rest_framework import permissions, serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet
from rest_framework_simplejwt.tokens import RefreshToken

from core.permissions import IsAdmin

from .models import Org, User

# ── Serializers ───────────────────────────────────────────────────────────────


class OrgSerializer(serializers.ModelSerializer):
    class Meta:
        model = Org
        fields = ["id", "uid", "name", "created_at", "updated_at"]
        read_only_fields = ["id", "uid", "created_at", "updated_at"]


class UserSerializer(serializers.ModelSerializer):
    manager_ids = serializers.SerializerMethodField()
    manager_id = serializers.SerializerMethodField()
    org = serializers.SlugRelatedField(slug_field="uid", queryset=Org.objects.all(), required=False, allow_null=True)
    org_detail = OrgSerializer(source="org", read_only=True)

    class Meta:
        model = User
        fields = [
            "id",
            "uid",
            "username",
            "email",
            "full_name",
            "role",
            "avatar_color",
            "org",
            "org_detail",
            "is_active",
            "manager_id",
            "manager_ids",
            "invoice_access",
            "notice_access",
            "masters_access",
            "attendance_access",
            "employee_access",
        ]
        read_only_fields = ["id", "uid", "org_detail"]

    def get_manager_ids(self, obj):
        return list(obj.managers.values_list("uid", flat=True))

    def get_manager_id(self, obj):
        first = obj.managers.first()
        return str(first.uid) if first else None


# ── Helpers ───────────────────────────────────────────────────────────────────


def _get_user_by_uid(uid: str):
    """Return User by uid or raise User.DoesNotExist."""
    return User.objects.get(uid=uid)


# ── Auth endpoints ────────────────────────────────────────────────────────────


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

    user = authenticate(request, username=credential, password=password)

    if user is None:
        return Response({"error": "Invalid credentials"}, status=status.HTTP_401_UNAUTHORIZED)

    refresh = RefreshToken.for_user(user)
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


# ── Organisations ─────────────────────────────────────────────────────────────


class OrgViewSet(ModelViewSet):
    """CRUD for tenant / organisation records. Admin-only writes.

    Reads are scoped to the caller's own org so tenants can't enumerate
    each other. Admins writing new orgs go through the unscoped queryset.
    """

    serializer_class = OrgSerializer
    lookup_field = "uid"

    def get_permissions(self):
        if self.request.method in ("GET", "HEAD", "OPTIONS"):
            return [permissions.IsAuthenticated()]
        return [IsAdmin()]

    def get_queryset(self):
        if self.request.method in ("GET", "HEAD", "OPTIONS"):
            user_org = getattr(self.request.user, "org", None)
            return Org.objects.filter(pk=user_org.pk) if user_org else Org.objects.none()
        return Org.objects.all()


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def profiles(request):
    user_org = getattr(request.user, "org", None)
    qs = User.objects.filter(org=user_org) if user_org else User.objects.none()
    active_param = request.query_params.get("active")
    if active_param is not None:
        qs = qs.filter(is_active=active_param.lower() == "true")
    return Response(UserSerializer(qs, many=True).data)


@api_view(["POST"])
@permission_classes([IsAdmin])
def create_user(request):
    username = request.data.get("username", "").strip()
    email = request.data.get("email", "").strip()
    password = request.data.get("password") or None
    role = request.data.get("role", "employee")
    full_name = request.data.get("full_name", "").strip()
    avatar_color = request.data.get("avatar_color", "")
    org_uid = request.data.get("org_uid") or request.data.get("org")
    manager_uid = request.data.get("manager_uid") or request.data.get("manager_id")

    if not username and not email:
        return Response({"error": "Either username or email is required"}, status=400)
    if username and User.objects.filter(username__iexact=username).exists():
        return Response({"error": f'Username "{username}" already exists'}, status=400)
    if email and User.objects.filter(email__iexact=email).exists():
        return Response({"error": f'Email "{email}" already exists'}, status=400)

    # Admins can only place new users in their own tenant; ignore any
    # other org_uid the client sends.
    caller_org = getattr(request.user, "org", None)
    if org_uid and caller_org and str(caller_org.uid) != str(org_uid):
        return Response({"error": "Cannot create user in a different organisation"}, status=403)
    org = caller_org

    user = User.objects.create_user(
        username=username,
        email=email,
        password=password,
        full_name=full_name or username or email.split("@")[0],
        role=role,
        avatar_color=avatar_color,
        org=org,
    )

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
    try:
        user = _get_user_by_uid(user_uid)
    except User.DoesNotExist:
        return Response({"error": "Not found"}, status=404)

    caller_org = getattr(request.user, "org", None)
    if caller_org and user.org != caller_org:
        return Response({"error": "Not found"}, status=404)

    simple_fields = ["role", "full_name", "username", "email", "is_active", "avatar_color"]
    for field in simple_fields:
        if field in request.data:
            setattr(user, field, request.data[field])

    # Access flags — record audit trail when toggled on
    from django.utils import timezone

    access_flags = [
        "invoice_access",
        "notice_access",
        "masters_access",
        "attendance_access",
        "employee_access",
    ]
    for flag in access_flags:
        if flag in request.data:
            new_val = bool(request.data[flag])
            old_val = getattr(user, flag)
            setattr(user, flag, new_val)
            if new_val and not old_val:
                # Being granted — record who and when
                setattr(user, f"{flag}_granted_by", request.user)
                setattr(user, f"{flag}_granted_at", timezone.now())
            elif not new_val:
                # Being revoked — clear audit fields
                setattr(user, f"{flag}_granted_by", None)
                setattr(user, f"{flag}_granted_at", None)

    if "manager_ids" in request.data:
        mgr_uids = request.data["manager_ids"]
        user.managers.set(User.objects.filter(uid__in=mgr_uids))

    user.save()
    return Response(UserSerializer(user).data)


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
    caller_org = getattr(request.user, "org", None)
    if caller_org and user.org != caller_org:
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
    caller_org = getattr(request.user, "org", None)
    if caller_org and user.org != caller_org:
        return Response({"error": "User not found"}, status=404)
    if user.role == "admin":
        return Response({"error": "Cannot delete admin users"}, status=400)
    user.delete()
    return Response({"ok": True})


# ── Access control list endpoints ─────────────────────────────────────────────


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def invoice_access_list(request):
    user_org = getattr(request.user, "org", None)
    users = User.objects.filter(invoice_access=True, org=user_org).select_related("invoice_access_granted_by")
    return Response(
        [
            {
                "user_id": str(u.uid),
                "enabled": True,
                "granted_by": str(u.invoice_access_granted_by.uid) if u.invoice_access_granted_by else None,
                "granted_at": u.invoice_access_granted_at,
            }
            for u in users
        ]
    )


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def notice_access_list(request):
    user_org = getattr(request.user, "org", None)
    users = User.objects.filter(notice_access=True, org=user_org).select_related("notice_access_granted_by")
    return Response(
        [
            {
                "user_id": str(u.uid),
                "enabled": True,
                "granted_by": str(u.notice_access_granted_by.uid) if u.notice_access_granted_by else None,
                "granted_at": u.notice_access_granted_at,
            }
            for u in users
        ]
    )


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def masters_access_list(request):
    user_org = getattr(request.user, "org", None)
    users = User.objects.filter(masters_access=True, org=user_org).select_related("masters_access_granted_by")
    return Response(
        [
            {
                "user_id": str(u.uid),
                "enabled": True,
                "granted_by": str(u.masters_access_granted_by.uid) if u.masters_access_granted_by else None,
                "granted_at": u.masters_access_granted_at,
            }
            for u in users
        ]
    )


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def attendance_access_list(request):
    user_org = getattr(request.user, "org", None)
    users = User.objects.filter(attendance_access=True, org=user_org).select_related("attendance_access_granted_by")
    return Response(
        [
            {
                "user_id": str(u.uid),
                "enabled": True,
                "granted_by": str(u.attendance_access_granted_by.uid) if u.attendance_access_granted_by else None,
                "granted_at": u.attendance_access_granted_at,
            }
            for u in users
        ]
    )


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def employee_access_list(request):
    user_org = getattr(request.user, "org", None)
    users = User.objects.filter(employee_access=True, org=user_org).select_related("employee_access_granted_by")
    return Response(
        [
            {
                "user_id": str(u.uid),
                "enabled": True,
                "granted_by": str(u.employee_access_granted_by.uid) if u.employee_access_granted_by else None,
                "granted_at": u.employee_access_granted_at,
            }
            for u in users
        ]
    )
