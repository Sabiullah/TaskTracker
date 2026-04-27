import datetime
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
    ClientActionPointAttachment,
    ClientMeeting,
    ClientMeetingAttachment,
    ClientRoadmap,
    ClientVisit,
    Master,
    VisitReport,
    VisitReportAuditEvent,
    is_visit_overdue,
)
from .serializers import (
    ClientActionPointAttachmentSerializer,
    ClientActionPointSerializer,
    ClientMeetingAttachmentSerializer,
    ClientMeetingSerializer,
    ClientRoadmapSerializer,
    ClientVisitSerializer,
    MasterSerializer,
    VisitReportAuditEventSerializer,
    VisitReportSerializer,
)


def _stream_attachment(file_field, filename: str, request):
    """Open ``file_field`` as a FileResponse with proper Content-Disposition.

    Reused by both meeting and action-point attachment download actions —
    they're auth-gated by the viewset queryset, so by the time we get here
    the caller already has access.
    """
    import mimetypes

    from django.http import FileResponse

    name = filename or file_field.name.split("/")[-1]
    content_type = mimetypes.guess_type(name)[0] or "application/octet-stream"
    force_download = request.query_params.get("download") in ("1", "true")
    response = FileResponse(file_field.open("rb"), filename=name, content_type=content_type)
    disposition = "attachment" if force_download else "inline"
    response["Content-Disposition"] = f'{disposition}; filename="{name}"'
    return response


def _notify_user(to_user, kind: str, title: str, body: str, link: dict | None = None) -> None:
    """Push a directed in-app toast via the realtime ``notifications`` channel.

    Best-effort — broadcast failures are swallowed inside ``broadcast()``.
    Skipped silently when ``to_user`` is None (e.g. assigned_manager nulled out).
    """
    if to_user is None:
        return
    broadcast(
        "notifications",
        "INSERT",
        {
            "to_user_uid": str(to_user.uid),
            "kind": kind,
            "title": title,
            "body": body,
            "link": link or {},
        },
    )


def _raise_from_response(err):
    exc_cls = PermissionDenied if err.status_code == 403 else ValidationError
    raise exc_cls(err.data)


class IsVisitParticipant(permissions.BasePermission):
    """Object-level visibility for ClientVisit / VisitReport / audit events.

    Caller may access the row if any of:
      - they are the visit's ``prepared_by``
      - they are the visit's ``assigned_manager``
      - they are admin in the visit's org
    """

    def has_permission(self, request, view):
        return request.user.is_authenticated

    def has_object_permission(self, request, view, obj):
        user = cast(User, request.user)
        # Resolve the parent visit regardless of which model `obj` is on.
        if hasattr(obj, "visit") and obj.visit is not None:
            visit = obj.visit
        else:
            visit = obj
        return (
            (visit.prepared_by_id == user.id)
            or (visit.assigned_manager_id == user.id)
            or user.is_admin_in(visit.org)
        )


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
            from django.db.models import F, Q
            from django.utils import timezone

            today = timezone.localdate()
            qs = qs.exclude(status__in=["Achieved", "Cancelled"]).filter(
                Q(target_date__lt=today) | Q(expected_date__gt=F("target_date"))
            )
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
        broadcast(
            "client-action-points",
            "INSERT",
            ClientActionPointSerializer(obj, context={"request": request}).data,
        )
        return Response(ClientActionPointSerializer(obj, context={"request": request}).data, status=201)

    @action(detail=True, methods=["get", "post"], url_path="attachments")
    def attachments(self, request, uid=None):
        meeting = self.get_object()
        if request.method == "GET":
            qs = meeting.attachments.all()
            return Response(ClientMeetingAttachmentSerializer(qs, many=True, context={"request": request}).data)
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
        broadcast(
            "client-meetings",
            "UPDATE",
            ClientMeetingSerializer(meeting, context={"request": request}).data,
        )
        return Response(
            ClientMeetingAttachmentSerializer(obj, context={"request": request}).data,
            status=201,
        )


class ClientActionPointViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = ClientActionPointSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrManagerOrReadOnlyInAny]
    parser_classes = [JSONParser, FormParser, MultiPartParser]
    http_method_names = ["get", "patch", "delete", "head", "options", "post"]

    def get_queryset(self):
        user = cast(User, self.request.user)
        return (
            ClientActionPoint.objects.select_related("meeting", "responsibility", "roadmap_link")
            .prefetch_related("attachments")
            .filter(meeting__org_id__in=user.org_ids())
        )

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "request": self.request}

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
        broadcast(
            "client-action-points",
            "UPDATE",
            ClientActionPointSerializer(obj, context={"request": self.request}).data,
        )

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
        return Response(ClientActionPointSerializer(qs, many=True, context={"request": request}).data)

    @action(detail=True, methods=["get", "post"], url_path="attachments")
    def attachments(self, request, uid=None):
        # Untyped on purpose — `ap.attachments` is the FK reverse manager, but
        # pyright + django-stubs don't surface reverse managers when the
        # local var is annotated `ClientActionPoint`. Mirrors the meeting
        # attachments action above.
        ap = self.get_object()
        if request.method == "GET":
            qs = ap.attachments.all()
            return Response(ClientActionPointAttachmentSerializer(qs, many=True, context={"request": request}).data)
        # POST — gated by the same admin/manager check as PATCH/DELETE above.
        user = cast(User, request.user)
        target_org = getattr(ap.meeting, "org", None)
        if not (user.is_admin_in(target_org) or user.is_manager_in(target_org)):
            raise PermissionDenied("Only admins/managers of this org can upload attachments.")
        upload = request.FILES.get("file")
        if not upload:
            raise ValidationError({"file": "File is required."})
        obj = ClientActionPointAttachment.objects.create(
            action_point=ap,
            file=upload,
            filename=upload.name,
            size_bytes=upload.size or 0,
            uploaded_by=request.user,
        )
        broadcast(
            "client-action-points",
            "UPDATE",
            ClientActionPointSerializer(ap, context={"request": request}).data,
        )
        return Response(
            ClientActionPointAttachmentSerializer(obj, context={"request": request}).data,
            status=201,
        )


class ClientMeetingAttachmentViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = ClientMeetingAttachmentSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrManagerOrReadOnlyInAny]
    http_method_names = ["get", "delete", "head", "options"]

    def get_queryset(self):
        user = cast(User, self.request.user)
        return ClientMeetingAttachment.objects.select_related("meeting").filter(meeting__org_id__in=user.org_ids())

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "request": self.request}

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
            ClientMeetingSerializer(meeting, context={"request": self.request}).data,
        )
        instance.file.delete(save=False)
        instance.delete()

    @action(detail=True, methods=["get"], url_path="download")
    def download(self, request, uid=None):
        from django.http import Http404

        att = self.get_object()
        if not att.file:
            raise Http404("No file attached")
        return _stream_attachment(att.file, att.filename, request)


class ClientActionPointAttachmentViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = ClientActionPointAttachmentSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrManagerOrReadOnlyInAny]
    http_method_names = ["get", "delete", "head", "options"]

    def get_queryset(self):
        user = cast(User, self.request.user)
        return ClientActionPointAttachment.objects.select_related("action_point", "action_point__meeting").filter(
            action_point__meeting__org_id__in=user.org_ids()
        )

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "request": self.request}

    def check_object_permissions(self, request, obj):
        super().check_object_permissions(request, obj)
        if request.method in permissions.SAFE_METHODS:
            return
        user = cast(User, request.user)
        target_org = getattr(obj.action_point.meeting, "org", None)
        if not (user.is_admin_in(target_org) or user.is_manager_in(target_org)):
            raise PermissionDenied("Only admins/managers of this org can delete attachments.")

    def perform_destroy(self, instance):
        ap = instance.action_point
        broadcast(
            "client-action-points",
            "UPDATE",
            ClientActionPointSerializer(ap, context={"request": self.request}).data,
        )
        instance.file.delete(save=False)
        instance.delete()

    @action(detail=True, methods=["get"], url_path="download")
    def download(self, request, uid=None):
        from django.http import Http404

        att: ClientActionPointAttachment = self.get_object()
        if not att.file:
            raise Http404("No file attached")
        return _stream_attachment(att.file, att.filename, request)


class ClientVisitViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = ClientVisitSerializer
    permission_classes = [permissions.IsAuthenticated, IsVisitParticipant]
    parser_classes = [JSONParser, FormParser, MultiPartParser]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        from django.db.models import Q
        from django.utils import timezone

        user = cast(User, self.request.user)
        org_ids = list(user.org_ids())
        # Visibility: author OR assigned_manager OR admin-in-org. Admins see
        # everything in their orgs. Managers and employees see their own
        # involvement (assigned + authored).
        admin_org_ids = list(
            user.memberships.filter(role="admin").values_list("org_id", flat=True)
        )
        qs = (
            ClientVisit.objects.select_related("client", "prepared_by", "assigned_manager", "org", "created_by")
            .prefetch_related("reports__reviewed_by", "reports__created_by", "audit_events__actor")
            .filter(org_id__in=org_ids)
        )
        qs = qs.filter(
            Q(org_id__in=admin_org_ids)
            | Q(prepared_by_id=user.id)
            | Q(assigned_manager_id=user.id)
        ).distinct()

        params = self.request.query_params
        client_uid = params.get("client_uid")
        prepared_by_uids = params.getlist("prepared_by_uid")
        assigned_manager_uids = params.getlist("assigned_manager_uid")
        statuses = params.getlist("status")
        visit_month = params.get("visit_month")
        date_from = params.get("date_from")
        date_to = params.get("date_to")
        overdue = params.get("overdue")

        if client_uid:
            qs = qs.filter(client__uid=client_uid)
        if prepared_by_uids:
            qs = qs.filter(prepared_by__uid__in=prepared_by_uids)
        if assigned_manager_uids:
            qs = qs.filter(assigned_manager__uid__in=assigned_manager_uids)
        if statuses:
            qs = qs.filter(current_status__in=statuses)
        if visit_month:
            try:
                year, month = visit_month.split("-")
                qs = qs.filter(visit_date__year=int(year), visit_date__month=int(month))
            except (ValueError, AttributeError):
                pass
        if date_from:
            qs = qs.filter(visit_date__gte=date_from)
        if date_to:
            qs = qs.filter(visit_date__lte=date_to)
        if overdue == "true":
            today = timezone.localdate()
            cutoff = today - datetime.timedelta(days=1)
            qs = qs.filter(report_sent_date__isnull=True, visit_date__lt=cutoff)

        return qs.order_by("client_id", "-visit_date")

    def perform_create(self, serializer):
        from django.db import transaction
        from django.utils import timezone

        org, err = resolve_create_org(self.request)
        if err is not None:
            _raise_from_response(err)

        # Multipart payloads put non-file fields here too — pop the report bits
        # off the serializer's validated_data so they don't slip into the visit.
        validated = serializer.validated_data
        key_points = self.request.data.get("key_points", "")
        upload = self.request.FILES.get("observation_attachment")

        with transaction.atomic():
            visit = serializer.save(
                created_by=self.request.user,
                prepared_by=self.request.user,
                org=org,
                current_status="Draft",
            )
            report = VisitReport.objects.create(
                visit=visit,
                revision_number=1,
                key_points=key_points,
                observation_attachment=upload,
                attachment_filename=upload.name if upload else "",
                attachment_size_bytes=(upload.size or 0) if upload else 0,
                status="Draft",
                created_by=self.request.user,
            )
            VisitReportAuditEvent.objects.create(
                visit=visit,
                report=report,
                event_type="created",
                actor=self.request.user,
            )
        broadcast(
            "client-visits",
            "INSERT",
            ClientVisitSerializer(visit, context={"request": self.request}).data,
        )

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast(
            "client-visits",
            "UPDATE",
            ClientVisitSerializer(obj, context={"request": self.request}).data,
        )

    def perform_destroy(self, instance):
        # Authors may delete only while the entire visit is still in Draft;
        # admins of the org may delete at any time. Managers cannot delete.
        user = cast(User, self.request.user)
        is_admin = user.is_admin_in(instance.org)
        is_author_draft = (
            instance.prepared_by_id == user.id and instance.current_status == "Draft"
        )
        if not (is_admin or is_author_draft):
            raise PermissionDenied("Only admins, or the author while still Draft, may delete.")
        broadcast("client-visits", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()

    @action(detail=True, methods=["patch"], url_path="sent-info")
    def sent_info(self, request, uid=None):
        from django.db import transaction
        from django.utils import timezone

        visit = self.get_object()
        user = cast(User, request.user)
        if not (user.is_admin_in(visit.org) or visit.assigned_manager_id == user.id):
            raise PermissionDenied("Only the assigned manager or an org admin may edit sent-info.")
        # Must have an Approved report.
        if not visit.reports.filter(status="Approved").exists():
            raise ValidationError({"detail": "Visit has no Approved report yet."})

        previous_sent = visit.report_sent_date
        previous_voice = visit.voice_note_sent

        with transaction.atomic():
            for field in ("report_sent_date", "voice_note_sent", "voice_note_summary"):
                if field in request.data:
                    setattr(visit, field, request.data.get(field))
            visit.save(update_fields=[
                "report_sent_date",
                "voice_note_sent",
                "voice_note_summary",
                "updated_at",
            ])
            if previous_sent is None and visit.report_sent_date is not None:
                VisitReportAuditEvent.objects.create(
                    visit=visit, event_type="sent_to_client", actor=user
                )
            if not previous_voice and visit.voice_note_sent:
                VisitReportAuditEvent.objects.create(
                    visit=visit, event_type="voice_note_marked", actor=user
                )

        broadcast(
            "client-visits",
            "UPDATE",
            ClientVisitSerializer(visit, context={"request": request}).data,
        )
        return Response(ClientVisitSerializer(visit, context={"request": request}).data)
