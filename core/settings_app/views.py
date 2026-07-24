from typing import cast

from rest_framework import permissions
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet

from core.org_utils import resolve_create_org, scoped
from core.permissions import IsAdminOrManager
from core.realtime import broadcast
from users.models import User

from .models import ApkRelease, AppSetting
from .serializers import AppSettingSerializer


def _raise_from_response(err):
    exc_cls = PermissionDenied if err.status_code == 403 else ValidationError
    raise exc_cls(err.data)


class AppSettingViewSet(ModelViewSet):
    """Per-org app settings — readable by members, writable by admin/manager.

    Each org can carry its own `key/value` pairs (e.g. `worklog_backdate_days`).
    The key field is unique per-org, so the frontend sends a `?org=<id>` along
    with the key (or uses the user's default org) to resolve ambiguity when a
    user belongs to multiple orgs.
    """

    serializer_class = AppSettingSerializer
    lookup_field = "key"

    def get_permissions(self):
        if self.request.method in permissions.SAFE_METHODS:
            return [permissions.IsAuthenticated()]
        return [IsAdminOrManager()]

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = scoped(AppSetting.objects.all(), user)
        # Optional narrowing when the caller belongs to multiple orgs and
        # wants just one org's settings.
        org_ident = self.request.query_params.get("org")
        if org_ident:
            from core.org_utils import resolve_org

            org = resolve_org(org_ident)
            if org:
                qs = qs.filter(org=org)
        return qs

    def perform_create(self, serializer):
        org, err = resolve_create_org(self.request)
        if err is not None:
            _raise_from_response(err)
        obj = serializer.save(org=org, updated_by=self.request.user)
        broadcast("app-settings", "INSERT", AppSettingSerializer(obj).data)

    def perform_update(self, serializer):
        obj = serializer.save(updated_by=self.request.user)
        broadcast("app-settings", "UPDATE", AppSettingSerializer(obj).data)

    def perform_destroy(self, instance):
        broadcast("app-settings", "DELETE", {"id": instance.pk, "key": instance.key})
        instance.delete()

    @action(detail=False, methods=["post"], url_path="upsert")
    def upsert(self, request):
        key = request.data.get("key")
        value = request.data.get("value", "")
        if not key:
            return Response({"error": "key is required"}, status=400)

        org, err = resolve_create_org(request)
        if err is not None:
            return err

        obj, _ = AppSetting.objects.update_or_create(
            org=org,
            key=key,
            defaults={"value": value, "updated_by": request.user},
        )
        broadcast("app-settings", "UPDATE", AppSettingSerializer(obj).data)
        return Response(AppSettingSerializer(obj).data)


class ApkVersionView(APIView):
    """Latest released APK version plus the full release history.

    Backed by the ``ApkRelease`` table — the release flow appends a row with
    remarks whenever a new APK is exported (see
    frontend/task-tracker/exportAPK.md). Unauthenticated on purpose: the
    installed APK bakes its own version in at build time, so this is the
    only way the app can find out a newer build exists and what changed.
    """

    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def get(self, request):
        releases = list(
            ApkRelease.objects.order_by("-created_at").values(
                "version", "remarks", "updated_at"
            )
        )
        latest = releases[0] if releases else None
        return Response(
            {
                "version": latest["version"] if latest else None,
                "updated_at": latest["updated_at"] if latest else None,
                "remarks": latest["remarks"] if latest else "",
                "releases": releases,
            }
        )
