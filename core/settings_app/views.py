from rest_framework import permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from core.permissions import IsAdminOrManager
from core.realtime import broadcast

from .models import AppSetting
from .serializers import AppSettingSerializer


class AppSettingViewSet(ModelViewSet):
    """Tenant app settings — readable by any authenticated user, writable by admin/manager.

    Employees need read access (e.g. the WorkLog page reads
    ``worklog_backdate_days`` to enable/disable past-date entries), but
    only admin/manager can change them.
    """

    serializer_class = AppSettingSerializer
    lookup_field = "key"

    def get_permissions(self):
        if self.request.method in permissions.SAFE_METHODS:
            return [permissions.IsAuthenticated()]
        return [IsAdminOrManager()]

    def get_queryset(self):
        return AppSetting.objects.filter(org=getattr(self.request.user, "org", None))

    def perform_create(self, serializer):
        user = self.request.user
        obj = serializer.save(org=getattr(user, "org", None), updated_by=user)
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
        org = getattr(request.user, "org", None)
        obj, _ = AppSetting.objects.update_or_create(
            org=org,
            key=key,
            defaults={"value": value, "updated_by": request.user},
        )
        broadcast("app-settings", "UPDATE", AppSettingSerializer(obj).data)
        return Response(AppSettingSerializer(obj).data)
