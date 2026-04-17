from rest_framework import permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.permissions import IsAdmin
from core.realtime import broadcast

from .models import Master
from .serializers import MasterSerializer


class MasterViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = MasterSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user_org = getattr(self.request.user, "org", None)
        qs = Master.objects.filter(org=user_org)
        type_filter = self.request.query_params.get("type")
        if type_filter:
            qs = qs.filter(type=type_filter)
        return qs

    def perform_create(self, serializer):
        user = self.request.user
        obj = serializer.save(created_by=user, org=getattr(user, "org", None))
        broadcast("masters", "INSERT", MasterSerializer(obj).data)

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast("masters", "UPDATE", MasterSerializer(obj).data)

    def perform_destroy(self, instance):
        broadcast("masters", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()

    @action(detail=False, methods=["delete"], url_path="delete_all", permission_classes=[IsAdmin])
    def delete_all(self, request):
        user_org = getattr(request.user, "org", None)
        deleted, _ = Master.objects.filter(org=user_org).delete()
        return Response({"deleted": deleted})

    @action(detail=False, methods=["post"], url_path="bulk_upsert")
    def bulk_upsert(self, request):
        rows = request.data if isinstance(request.data, list) else request.data.get("rows", [])
        if not isinstance(rows, list):
            return Response({"error": "Expected a list of records"}, status=400)
        user_org = getattr(request.user, "org", None)
        results = []
        for row in rows:
            row_id = row.get("id")
            if row_id:
                try:
                    instance = Master.objects.get(pk=row_id, org=user_org)
                    s = MasterSerializer(instance, data=row, partial=True, context={"request": request})
                    s.is_valid(raise_exception=True)
                    obj = s.save()
                    broadcast("masters", "UPDATE", MasterSerializer(obj).data)
                    results.append(s.data)
                    continue
                except Master.DoesNotExist:
                    pass
            row.pop("id", None)
            s = MasterSerializer(data=row, context={"request": request})
            s.is_valid(raise_exception=True)
            obj = s.save(created_by=request.user, org=user_org)
            broadcast("masters", "INSERT", MasterSerializer(obj).data)
            results.append(s.data)
        return Response(results)
