from typing import cast

from rest_framework import permissions
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.org_utils import resolve_admin_org, resolve_create_org
from core.permissions import IsAdmin
from core.realtime import broadcast
from users.models import User

from .models import Master
from .serializers import MasterSerializer


def _raise_from_response(err):
    exc_cls = PermissionDenied if err.status_code == 403 else ValidationError
    raise exc_cls(err.data)


class MasterViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = MasterSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = cast(User, self.request.user)
        # Master uses a Many-to-Many on ``orgs`` (so one client can live
        # in multiple orgs) plus a legacy single-FK ``org``. Match on
        # either and ``.distinct()`` to avoid duplicates when a row is
        # shared with 2+ orgs the caller belongs to.
        org_ids = list(user.org_ids())
        from django.db.models import Q

        qs = Master.objects.filter(Q(orgs__id__in=org_ids) | Q(org_id__in=org_ids)).distinct()
        type_filter = self.request.query_params.get("type")
        if type_filter:
            qs = qs.filter(type=type_filter)
        return qs

    def perform_create(self, serializer):
        org, err = resolve_create_org(self.request)
        if err is not None:
            _raise_from_response(err)
        obj = serializer.save(created_by=self.request.user, org=org)
        broadcast("masters", "INSERT", MasterSerializer(obj).data)

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast("masters", "UPDATE", MasterSerializer(obj).data)

    def perform_destroy(self, instance):
        broadcast("masters", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()

    @action(detail=False, methods=["delete"], url_path="delete_all", permission_classes=[IsAdmin])
    def delete_all(self, request):
        """Wipe masters in a single org. Target via ``?org=<id|uid>``.

        Caller must be admin of that specific org — not merely admin
        somewhere else.
        """
        org, err = resolve_admin_org(request)
        if err is not None:
            return err
        assert org is not None
        deleted, _ = Master.objects.filter(org=org).delete()
        return Response({"deleted": deleted, "org": str(org.uid)})

    @action(detail=False, methods=["post"], url_path="bulk_upsert")
    def bulk_upsert(self, request):
        rows = request.data if isinstance(request.data, list) else request.data.get("rows", [])
        if not isinstance(rows, list):
            return Response({"error": "Expected a list of records"}, status=400)

        org, err = resolve_create_org(request)
        if err is not None:
            return err

        assert org is not None
        results = []
        for row in rows:
            row_id = row.get("id")
            if row_id:
                try:
                    instance = Master.objects.get(pk=row_id, org=org)
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
            obj = s.save(created_by=request.user, org=org)
            broadcast("masters", "INSERT", MasterSerializer(obj).data)
            results.append(s.data)
        return Response(results)
