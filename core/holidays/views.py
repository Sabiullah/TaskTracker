from typing import cast

from rest_framework import permissions
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.org_utils import resolve_create_org, scoped
from core.realtime import broadcast
from users.models import User

from .models import Holiday
from .serializers import HolidaySerializer


def _raise_from_response(err):
    exc_cls = PermissionDenied if err.status_code == 403 else ValidationError
    raise exc_cls(err.data)


class HolidayViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = HolidaySerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = scoped(Holiday.objects.all(), user)
        year = self.request.query_params.get("year")
        if year:
            qs = qs.filter(date__year=year)
        return qs

    def perform_create(self, serializer):
        org, err = resolve_create_org(self.request)
        if err is not None:
            _raise_from_response(err)
        obj = serializer.save(created_by=self.request.user, org=org)
        broadcast("holidays", "INSERT", HolidaySerializer(obj).data)

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast("holidays", "UPDATE", HolidaySerializer(obj).data)

    def perform_destroy(self, instance):
        broadcast("holidays", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()
