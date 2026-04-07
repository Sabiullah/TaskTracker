from django.contrib.auth import authenticate
from rest_framework import permissions, serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework_simplejwt.tokens import RefreshToken

from .models import User

# ── Serializers ───────────────────────────────────────────────────────────────


class UserSerializer(serializers.ModelSerializer):
    manager_ids = serializers.SerializerMethodField()
    manager_id = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "full_name",
            "role",
            "manager_id",
            "manager_ids",
            "invoice_access",
            "notice_access",
        ]

    def get_manager_ids(self, obj):
        return list(obj.managers.values_list("id", flat=True))

    def get_manager_id(self, obj):
        first = obj.managers.first()
        return first.id if first else None


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

    # authenticate() calls our EmailOrUsernameBackend
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
            pass  # already blacklisted or invalid — still return ok
    return Response({"ok": True})


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def me(request):
    return Response(UserSerializer(request.user).data)


# ── User management (admin only) ──────────────────────────────────────────────


class IsAdmin(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and request.user.role == "admin"


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def profiles(request):
    users = User.objects.all()
    return Response(UserSerializer(users, many=True).data)


@api_view(["POST"])
@permission_classes([IsAdmin])
def create_user(request):
    username = request.data.get("username", "").strip()
    email = request.data.get("email", "").strip()
    password = request.data.get("password", "123456")
    role = request.data.get("role", "employee")
    manager_id = request.data.get("manager_id")

    if not username and not email:
        return Response({"error": "Either username or email is required"}, status=400)
    if username and User.objects.filter(username__iexact=username).exists():
        return Response({"error": f'Username "{username}" already exists'}, status=400)
    if email and User.objects.filter(email__iexact=email).exists():
        return Response({"error": f'Email "{email}" already exists'}, status=400)

    user = User.objects.create_user(
        username=username,
        email=email,
        password=password,
        full_name=username or email.split("@")[0],
        role=role,
    )

    if manager_id:
        try:
            mgr = User.objects.get(id=manager_id)
            user.managers.add(mgr)
        except User.DoesNotExist:
            pass

    return Response(UserSerializer(user).data, status=201)


@api_view(["PATCH"])
@permission_classes([IsAdmin])
def update_user(request, user_id):
    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return Response({"error": "Not found"}, status=404)

    if "role" in request.data:
        user.role = request.data["role"]
    if "invoice_access" in request.data:
        user.invoice_access = request.data["invoice_access"]
    if "notice_access" in request.data:
        user.notice_access = request.data["notice_access"]
    if "manager_ids" in request.data:
        mgr_ids = request.data["manager_ids"]
        user.managers.set(User.objects.filter(id__in=mgr_ids))
    user.save()
    return Response(UserSerializer(user).data)


@api_view(["POST"])
@permission_classes([IsAdmin])
def reset_password(request):
    user_id = request.data.get("user_id")
    new_password = request.data.get("new_password", "")
    if len(new_password) < 6:
        return Response({"error": "Password must be at least 6 characters"}, status=400)
    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return Response({"error": "User not found"}, status=404)
    user.set_password(new_password)
    user.save()
    return Response({"ok": True})


@api_view(["POST"])
@permission_classes([IsAdmin])
def delete_user(request):
    user_id = request.data.get("user_id")
    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return Response({"error": "User not found"}, status=404)
    if user.role == "admin":
        return Response({"error": "Cannot delete admin users"}, status=400)
    user.delete()
    return Response({"ok": True})


# ── Invoice / Notice access (compatibility endpoints) ─────────────────────────
# The frontend App.tsx fetches /invoice_access/ and /notice_access/ to check
# per-user access. We return a flat list of {user_id, enabled} objects derived
# from the User model's boolean fields.


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def invoice_access_list(request):
    users = User.objects.filter(invoice_access=True)
    return Response([{"user_id": str(u.id), "enabled": True} for u in users])


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def notice_access_list(request):
    users = User.objects.filter(notice_access=True)
    return Response([{"user_id": str(u.id), "enabled": True} for u in users])
