from rest_framework import permissions
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.realtime import broadcast

from .models import Notice
from .serializers import NoticeSerializer


class NoticeViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = NoticeSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user_org = getattr(self.request.user, "org", None)
        qs = Notice.objects.select_related("client", "org", "created_by").filter(org=user_org)
        status = self.request.query_params.get("status")
        client_uid = self.request.query_params.get("client_uid")
        if status:
            qs = qs.filter(status=status)
        if client_uid:
            qs = qs.filter(client__uid=client_uid)
        return qs

    def perform_create(self, serializer):
        user = self.request.user
        obj = serializer.save(created_by=user, org=getattr(user, "org", None))
        broadcast("notices", "INSERT", NoticeSerializer(obj).data)

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast("notices", "UPDATE", NoticeSerializer(obj).data)

    def perform_destroy(self, instance):
        broadcast("notices", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()
