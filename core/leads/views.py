from typing import cast

from django.db.models import Q
from django.http import Http404
from rest_framework import permissions
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.masters.views import _stream_attachment
from core.org_utils import resolve_create_org, visibility_q
from core.pagination import StandardPagination
from core.realtime import broadcast
from users.models import User

from .models import Lead, LeadAttachment, LeadHistory, LeadStatus
from .serializers import (
    LeadAttachmentSerializer,
    LeadHistorySerializer,
    LeadSerializer,
    LeadStatusSerializer,
)


def _raise_from_response(err):
    exc_cls = PermissionDenied if err.status_code == 403 else ValidationError
    raise exc_cls(err.data)


def _user_can_mutate_lead(user: User, lead: Lead) -> bool:
    """Author, assignee, or admin/manager of the lead's org."""
    if lead.created_by_id == user.id:
        return True
    if lead.assigned_to_id == user.id:
        return True
    org = lead.org
    if org is None:
        return False
    return user.is_admin_in(org) or user.is_manager_in(org)


class LeadStatusViewSet(ModelViewSet):
    # LeadStatus is a small lookup table without `uid` — keep integer-pk URLs.
    serializer_class = LeadStatusSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = cast(User, self.request.user)
        return LeadStatus.objects.filter(org_id__in=user.org_ids())

    def perform_create(self, serializer):
        org, err = resolve_create_org(self.request)
        if err is not None:
            _raise_from_response(err)
        obj = serializer.save(org=org)
        broadcast("lead-statuses", "INSERT", LeadStatusSerializer(obj).data)

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast("lead-statuses", "UPDATE", LeadStatusSerializer(obj).data)

    def perform_destroy(self, instance):
        broadcast("lead-statuses", "DELETE", {"id": instance.pk})
        instance.delete()


class LeadViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = LeadSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardPagination
    parser_classes = [JSONParser, FormParser, MultiPartParser]

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = (
            Lead.objects.select_related("client", "status", "assigned_to", "created_by")
            .prefetch_related("history", "attachments", "attachments__uploaded_by")
            .filter(visibility_q(user, "assigned_to"))
            .order_by("-created_at")
        )

        status_id = self.request.query_params.get("status_id")
        priority = self.request.query_params.get("priority")
        if status_id:
            try:
                qs = qs.filter(status_id=int(status_id))
            except ValueError:
                qs = qs.none()
        if priority:
            qs = qs.filter(priority=priority)
        return qs

    def perform_create(self, serializer):
        org, err = resolve_create_org(self.request)
        if err is not None:
            _raise_from_response(err)
        user = cast(User, self.request.user)
        lead = serializer.save(created_by=user, org=org)
        broadcast("leads", "INSERT", LeadSerializer(lead).data)

    def perform_update(self, serializer):
        lead = serializer.save()
        broadcast("leads", "UPDATE", LeadSerializer(lead).data)

    def perform_destroy(self, instance):
        broadcast("leads", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()

    @action(detail=True, methods=["get", "post"], url_path="attachments")
    def attachments(self, request, uid=None):
        lead = self.get_object()
        if request.method == "GET":
            qs = lead.attachments.all()
            return Response(LeadAttachmentSerializer(qs, many=True, context={"request": request}).data)
        # POST — only users who can edit the lead may upload.
        user = cast(User, request.user)
        if not _user_can_mutate_lead(user, lead):
            raise PermissionDenied("You don't have permission to upload attachments to this lead.")
        upload = request.FILES.get("file")
        if not upload:
            raise ValidationError({"file": "File is required."})
        label = (request.data.get("label") or "").strip()
        if not label:
            raise ValidationError({"label": "Display name is required."})
        obj = LeadAttachment.objects.create(
            lead=lead,
            file=upload,
            filename=upload.name,
            label=label,
            size_bytes=upload.size or 0,
            uploaded_by=user,
        )
        broadcast("leads", "UPDATE", LeadSerializer(lead).data)
        return Response(
            LeadAttachmentSerializer(obj, context={"request": request}).data,
            status=201,
        )


class LeadHistoryViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = LeadHistorySerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = LeadHistory.objects.select_related("lead", "created_by").filter(lead__org_id__in=user.org_ids())
        lead_uid = self.request.query_params.get("lead_uid")
        lead_id = self.request.query_params.get("lead_id")
        if lead_uid:
            qs = qs.filter(lead__uid=lead_uid)
        elif lead_id:
            qs = qs.filter(lead_id=lead_id)
        return qs

    def perform_create(self, serializer):
        obj = serializer.save(created_by=self.request.user)
        broadcast("lead-history", "INSERT", LeadHistorySerializer(obj).data)

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast("lead-history", "UPDATE", LeadHistorySerializer(obj).data)

    def perform_destroy(self, instance):
        broadcast("lead-history", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()


class LeadAttachmentViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = LeadAttachmentSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "delete", "head", "options"]

    def get_queryset(self):
        user = cast(User, self.request.user)
        # Constrain the visible attachments to leads the user can see.
        # `visibility_q` walks the per-org-role rules and is keyed on
        # `lead.assigned_to`, so prefix it through the FK.
        admin_ids = list(user.memberships.filter(role="admin").values_list("org_id", flat=True))
        manager_ids = list(user.memberships.filter(role="manager").values_list("org_id", flat=True))
        employee_ids = list(user.memberships.filter(role="employee").values_list("org_id", flat=True))

        q = Q(pk__in=[])
        if admin_ids:
            q |= Q(lead__org_id__in=admin_ids)
        if manager_ids:
            q |= Q(lead__org_id__in=manager_ids)
        if employee_ids:
            q |= Q(lead__org_id__in=employee_ids, lead__assigned_to_id=user.id)
        # Author always sees their own lead's attachments even if reassigned.
        q |= Q(lead__created_by_id=user.id)
        return LeadAttachment.objects.select_related("lead", "lead__org", "uploaded_by").filter(q).distinct()

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "request": self.request}

    def perform_destroy(self, instance):
        user = cast(User, self.request.user)
        if not _user_can_mutate_lead(user, instance.lead):
            raise PermissionDenied("You don't have permission to delete this attachment.")
        lead = instance.lead
        instance.file.delete(save=False)
        instance.delete()
        broadcast("leads", "UPDATE", LeadSerializer(lead).data)

    @action(detail=True, methods=["get"], url_path="download")
    def download(self, request, uid=None):
        att: LeadAttachment = self.get_object()
        if not att.file:
            raise Http404("No file attached")
        return _stream_attachment(att.file, att.filename, request)
