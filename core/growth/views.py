from typing import cast

from rest_framework import permissions
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.realtime import broadcast
from users.models import User

from .models import GrowthPlan
from .serializers import GrowthPlanSerializer


class GrowthPlanViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = GrowthPlanSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = cast(User, self.request.user)
        role = user.role
        qs = GrowthPlan.objects.select_related("assigned_to", "org", "created_by").filter(
            org=getattr(user, "org", None)
        )

        status = self.request.query_params.get("status")
        priority = self.request.query_params.get("priority")
        if status:
            qs = qs.filter(status=status)
        if priority:
            qs = qs.filter(priority=priority)

        if role in ("admin", "manager"):
            return qs
        return qs.filter(assigned_to=user)

    def perform_create(self, serializer):
        user = cast(User, self.request.user)
        obj = serializer.save(created_by=user, org=getattr(user, "org", None))
        broadcast("growth-plans", "INSERT", GrowthPlanSerializer(obj).data)

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast("growth-plans", "UPDATE", GrowthPlanSerializer(obj).data)

    def perform_destroy(self, instance):
        broadcast("growth-plans", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()
