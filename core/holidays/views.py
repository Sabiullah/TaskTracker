from rest_framework import permissions
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.realtime import broadcast

from .models import Holiday
from .serializers import HolidaySerializer


class HolidayViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = HolidaySerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user_org = getattr(self.request.user, "org", None)
        qs = Holiday.objects.filter(org=user_org)
        year = self.request.query_params.get("year")
        if year:
            qs = qs.filter(date__year=year)
        return qs

    def perform_create(self, serializer):
        user = self.request.user
        obj = serializer.save(created_by=user, org=getattr(user, "org", None))
        broadcast("holidays", "INSERT", HolidaySerializer(obj).data)

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast("holidays", "UPDATE", HolidaySerializer(obj).data)

    def perform_destroy(self, instance):
        broadcast("holidays", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()
