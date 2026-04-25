from typing import cast

from rest_framework import permissions
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.org_utils import resolve_admin_org, scoped
from core.pagination import StandardPagination
from users.models import User

from .models import WorkingDayOverride
from .serializers import WorkingDayOverrideSerializer


def _raise(err):
    exc_cls = PermissionDenied if err.status_code == 403 else ValidationError
    raise exc_cls(err.data)


class WorkingDayOverrideViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = WorkingDayOverrideSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardPagination

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = scoped(WorkingDayOverride.objects.select_related("org"), user)
        year = self.request.query_params.get("year")
        if year and year.isdigit():
            qs = qs.filter(date__year=int(year))
        return qs.order_by("-date")

    def perform_create(self, serializer):
        org, err = resolve_admin_org(self.request)
        if err is not None:
            _raise(err)
        serializer.save(created_by=self.request.user, org=org)

    def perform_update(self, serializer):
        # Admin-only edits, AND only for an override the caller administers.
        org, err = resolve_admin_org(self.request)
        if err is not None:
            _raise(err)
        if org != serializer.instance.org:
            raise PermissionDenied({"detail": "You are not an admin of this override's organisation"})
        serializer.save()

    def perform_destroy(self, instance):
        org, err = resolve_admin_org(self.request)
        if err is not None:
            _raise(err)
        if org != instance.org:
            raise PermissionDenied({"detail": "You are not an admin of this override's organisation"})
        instance.delete()
