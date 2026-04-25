from typing import cast

from rest_framework import permissions
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.org_utils import resolve_admin_org, scoped
from users.models import User

from .models import WorkingDayOverride
from .serializers import WorkingDayOverrideSerializer


def _raise(err):
    exc_cls = PermissionDenied if err.status_code == 403 else ValidationError
    raise exc_cls(err.data)


class WorkingDayOverrideViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = WorkingDayOverrideSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = scoped(WorkingDayOverride.objects.select_related("org"), user)
        year = self.request.query_params.get("year")
        if year:
            qs = qs.filter(date__year=year)
        return qs.order_by("-date")

    def perform_create(self, serializer):
        org, err = resolve_admin_org(self.request)
        if err is not None:
            _raise(err)
        serializer.save(created_by=self.request.user, org=org)

    def perform_update(self, serializer):
        # Admin-only edits.
        org, err = resolve_admin_org(self.request)
        if err is not None:
            _raise(err)
        serializer.save()

    def perform_destroy(self, instance):
        org, err = resolve_admin_org(self.request)
        if err is not None:
            _raise(err)
        instance.delete()
