from typing import cast

from rest_framework import permissions
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.org_utils import resolve_create_org, visibility_q
from core.realtime import broadcast
from users.models import User

from .models import GrowthPlan
from .serializers import GrowthPlanSerializer


def _raise_from_response(err):
    exc_cls = PermissionDenied if err.status_code == 403 else ValidationError
    raise exc_cls(err.data)


class GrowthPlanViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = GrowthPlanSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = GrowthPlan.objects.select_related("assigned_to", "org", "created_by").filter(
            visibility_q(user, "assigned_to")
        )

        status = self.request.query_params.get("status")
        priority = self.request.query_params.get("priority")
        if status:
            qs = qs.filter(status=status)
        if priority:
            qs = qs.filter(priority=priority)
        return qs

    def perform_create(self, serializer):
        org, err = resolve_create_org(self.request)
        if err is not None:
            _raise_from_response(err)
        obj = serializer.save(created_by=self.request.user, org=org)
        broadcast("growth-plans", "INSERT", GrowthPlanSerializer(obj).data)

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast("growth-plans", "UPDATE", GrowthPlanSerializer(obj).data)

    def perform_destroy(self, instance):
        broadcast("growth-plans", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()
