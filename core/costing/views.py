from typing import cast

from rest_framework import permissions
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.org_utils import resolve_admin_org, resolve_create_org, scoped
from core.permissions import IsAdminInAny, IsAdminOrCostingAccess
from core.realtime import broadcast
from users.models import User

from .models import CostingEntry, SeatCostSetting
from .serializers import CostingEntrySerializer, SeatCostSettingSerializer


def _raise_from_response(err):
    exc_cls = PermissionDenied if err.status_code == 403 else ValidationError
    raise exc_cls(err.data)


class CostingEntryViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = CostingEntrySerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrCostingAccess]

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = scoped(
            CostingEntry.objects.select_related("client", "designation", "created_by"),
            user,
        )
        client_uid = self.request.query_params.get("client")
        if client_uid:
            qs = qs.filter(client__uid=client_uid)
        return qs

    def perform_create(self, serializer):
        org, err = resolve_create_org(self.request)
        if err is not None:
            _raise_from_response(err)
        obj = serializer.save(created_by=self.request.user, org=org)
        broadcast("costing-entries", "INSERT", CostingEntrySerializer(obj).data)

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast("costing-entries", "UPDATE", CostingEntrySerializer(obj).data)

    def perform_destroy(self, instance):
        broadcast("costing-entries", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()


class SeatCostSettingViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = SeatCostSettingSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminInAny]

    def get_queryset(self):
        user = cast(User, self.request.user)
        admin_org_ids = user.memberships.filter(role="admin").values_list("org_id", flat=True)
        return SeatCostSetting.objects.filter(org_id__in=admin_org_ids).select_related("org")

    def perform_create(self, serializer):
        org, err = resolve_admin_org(self.request)
        if err is not None:
            _raise_from_response(err)
        obj = serializer.save(org=org)
        broadcast("seat-cost-settings", "INSERT", SeatCostSettingSerializer(obj).data)

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast("seat-cost-settings", "UPDATE", SeatCostSettingSerializer(obj).data)
