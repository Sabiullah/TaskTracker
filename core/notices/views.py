from typing import cast

from rest_framework import permissions
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.org_utils import resolve_create_org, scoped
from core.realtime import broadcast
from users.models import User

from .models import Notice
from .serializers import NoticeSerializer


def _raise_from_response(err):
    exc_cls = PermissionDenied if err.status_code == 403 else ValidationError
    raise exc_cls(err.data)


class NoticeViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = NoticeSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = scoped(Notice.objects.select_related("client", "org", "created_by"), user)
        status = self.request.query_params.get("status")
        client_uid = self.request.query_params.get("client_uid")
        if status:
            qs = qs.filter(status=status)
        if client_uid:
            qs = qs.filter(client__uid=client_uid)
        return qs

    def perform_create(self, serializer):
        org, err = resolve_create_org(self.request)
        if err is not None:
            _raise_from_response(err)
        obj = serializer.save(created_by=self.request.user, org=org)
        broadcast("notices", "INSERT", NoticeSerializer(obj).data)

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast("notices", "UPDATE", NoticeSerializer(obj).data)

    def perform_destroy(self, instance):
        broadcast("notices", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()
