from typing import cast

from rest_framework import permissions
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.org_utils import resolve_admin_org, resolve_create_org, scoped
from core.permissions import IsAdmin, IsAdminOrManagerOrReadOnlyInAny, PerOrgManager
from core.realtime import broadcast
from users.models import User

from .models import (
    ClientActionPoint,
    ClientMeeting,
    ClientMeetingAttachment,
    ClientRoadmap,
    Master,
)
from .serializers import (
    ClientActionPointSerializer,
    ClientMeetingAttachmentSerializer,
    ClientMeetingSerializer,
    ClientRoadmapSerializer,
    MasterSerializer,
)


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


class ClientRoadmapViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = ClientRoadmapSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrManagerOrReadOnlyInAny, PerOrgManager]

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = scoped(
            ClientRoadmap.objects.select_related("client", "owner", "org", "created_by"),
            user,
        )
        client_uid = self.request.query_params.get("client_uid")
        status = self.request.query_params.get("status")
        owner_uid = self.request.query_params.get("owner_uid")
        overdue = self.request.query_params.get("overdue")
        if client_uid:
            qs = qs.filter(client__uid=client_uid)
        if status:
            qs = qs.filter(status=status)
        if owner_uid:
            qs = qs.filter(owner__uid=owner_uid)
        if overdue == "true":
            from django.utils import timezone

            today = timezone.localdate()
            qs = qs.filter(target_date__lt=today).exclude(status__in=["Achieved", "Cancelled"])
        return qs

    def perform_create(self, serializer):
        org, err = resolve_create_org(self.request)
        if err is not None:
            _raise_from_response(err)
        obj = serializer.save(created_by=self.request.user, org=org)
        broadcast("client-roadmap", "INSERT", ClientRoadmapSerializer(obj).data)

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast("client-roadmap", "UPDATE", ClientRoadmapSerializer(obj).data)

    def perform_destroy(self, instance):
        broadcast("client-roadmap", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()


class ClientMeetingViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = ClientMeetingSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrManagerOrReadOnlyInAny, PerOrgManager]
    parser_classes = [JSONParser, FormParser, MultiPartParser]

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = scoped(
            ClientMeeting.objects.select_related("client", "conducted_by", "org", "created_by").prefetch_related(
                "our_attendees", "action_points", "attachments"
            ),
            user,
        )
        client_uid = self.request.query_params.get("client_uid")
        date_from = self.request.query_params.get("date_from")
        date_to = self.request.query_params.get("date_to")
        if client_uid:
            qs = qs.filter(client__uid=client_uid)
        if date_from:
            qs = qs.filter(meeting_date__gte=date_from)
        if date_to:
            qs = qs.filter(meeting_date__lte=date_to)
        return qs

    def perform_create(self, serializer):
        org, err = resolve_create_org(self.request)
        if err is not None:
            _raise_from_response(err)
        obj = serializer.save(created_by=self.request.user, org=org)
        broadcast("client-meetings", "INSERT", ClientMeetingSerializer(obj).data)

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast("client-meetings", "UPDATE", ClientMeetingSerializer(obj).data)

    def perform_destroy(self, instance):
        broadcast("client-meetings", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()

    @action(detail=True, methods=["post"], url_path="action-points")
    def add_action_point(self, request, uid=None):
        meeting = self.get_object()
        data = dict(request.data or {})
        data["meeting"] = meeting.pk
        ser = ClientActionPointSerializer(data=data, context={"request": request})
        ser.is_valid(raise_exception=True)
        obj = ser.save()
        broadcast("client-action-points", "INSERT", ClientActionPointSerializer(obj).data)
        return Response(ClientActionPointSerializer(obj).data, status=201)

    @action(detail=True, methods=["get", "post"], url_path="attachments")
    def attachments(self, request, uid=None):
        meeting = self.get_object()
        if request.method == "GET":
            qs = meeting.attachments.all()
            return Response(ClientMeetingAttachmentSerializer(qs, many=True).data)
        upload = request.FILES.get("file")
        if not upload:
            raise ValidationError({"file": "File is required."})
        obj = ClientMeetingAttachment.objects.create(
            meeting=meeting,
            file=upload,
            filename=upload.name,
            size_bytes=upload.size or 0,
            uploaded_by=request.user,
        )
        broadcast("client-meetings", "UPDATE", ClientMeetingSerializer(meeting).data)
        return Response(ClientMeetingAttachmentSerializer(obj).data, status=201)


class ClientActionPointViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = ClientActionPointSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrManagerOrReadOnlyInAny]
    http_method_names = ["get", "patch", "delete", "head", "options"]

    def get_queryset(self):
        user = cast(User, self.request.user)
        return ClientActionPoint.objects.select_related("meeting", "responsibility", "roadmap_link").filter(
            meeting__org_id__in=user.org_ids()
        )

    def check_object_permissions(self, request, obj):
        super().check_object_permissions(request, obj)
        if request.method in permissions.SAFE_METHODS:
            return
        user = cast(User, request.user)
        target_org = getattr(obj.meeting, "org", None)
        if not (user.is_admin_in(target_org) or user.is_manager_in(target_org)):
            raise PermissionDenied("Only admins/managers of this org can modify action points.")

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast("client-action-points", "UPDATE", ClientActionPointSerializer(obj).data)

    def perform_destroy(self, instance):
        broadcast(
            "client-action-points",
            "DELETE",
            {"id": instance.pk, "uid": str(instance.uid), "meeting_id": instance.meeting_id},
        )
        instance.delete()

    @action(detail=False, methods=["get"], url_path="overdue")
    def overdue(self, request):
        from django.utils import timezone

        today = timezone.localdate()
        user = cast(User, request.user)
        qs = (
            ClientActionPoint.objects.select_related("meeting", "meeting__client", "responsibility")
            .filter(meeting__org_id__in=user.org_ids())
            .filter(target_date__lt=today)
            .exclude(status__in=["Completed", "Cancelled"])
            .order_by("target_date")
        )
        return Response(ClientActionPointSerializer(qs, many=True).data)


class ClientMeetingAttachmentViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = ClientMeetingAttachmentSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrManagerOrReadOnlyInAny]
    http_method_names = ["get", "delete", "head", "options"]

    def get_queryset(self):
        user = cast(User, self.request.user)
        return ClientMeetingAttachment.objects.select_related("meeting").filter(meeting__org_id__in=user.org_ids())

    def check_object_permissions(self, request, obj):
        super().check_object_permissions(request, obj)
        if request.method in permissions.SAFE_METHODS:
            return
        user = cast(User, request.user)
        target_org = getattr(obj.meeting, "org", None)
        if not (user.is_admin_in(target_org) or user.is_manager_in(target_org)):
            raise PermissionDenied("Only admins/managers of this org can delete attachments.")

    def perform_destroy(self, instance):
        meeting = instance.meeting
        broadcast(
            "client-meetings",
            "UPDATE",
            ClientMeetingSerializer(meeting).data,
        )
        instance.file.delete(save=False)
        instance.delete()
