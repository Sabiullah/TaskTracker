from typing import cast

from django.db import transaction
from rest_framework import permissions
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.filestore.validators import validate_upload
from core.org_utils import resolve_create_org, visibility_q
from core.pagination import StandardPagination
from users.models import User

from .models import ConveyanceAttachment, ConveyanceEntry
from .serializers import ConveyanceAttachmentSerializer, ConveyanceEntrySerializer


class ConveyanceEntryViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = ConveyanceEntrySerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardPagination

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = (
            ConveyanceEntry.objects.select_related(
                "employee", "client", "org", "reviewed_by", "created_by"
            )
            .prefetch_related("attachments", "attachments__uploaded_by")
            .filter(visibility_q(user, "employee"))
        )

        employee_uid = self.request.query_params.get("employee_uid")
        client_uid = self.request.query_params.get("client_uid")
        status = self.request.query_params.get("status")
        claimable = self.request.query_params.get("claimable")
        month = self.request.query_params.get("month")
        date_from = self.request.query_params.get("from")
        date_to = self.request.query_params.get("to")
        search = self.request.query_params.get("search")

        if employee_uid:
            qs = qs.filter(employee__uid=employee_uid)
        if client_uid:
            qs = qs.filter(client__uid=client_uid)
        if status in {"pending", "approved", "rejected"}:
            qs = qs.filter(status=status)
        if claimable in {"true", "false"}:
            qs = qs.filter(claimable=(claimable == "true"))
        if month:
            qs = qs.filter(date__startswith=month)
        if date_from:
            qs = qs.filter(date__gte=date_from)
        if date_to:
            qs = qs.filter(date__lte=date_to)
        if search:
            qs = qs.filter(reason__icontains=search)
        return qs

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "request": self.request}

    def perform_create(self, serializer):
        user = cast(User, self.request.user)
        org, err = resolve_create_org(self.request)
        if err is not None:
            exc_cls = PermissionDenied if err.status_code == 403 else ValidationError
            raise exc_cls(err.data)

        target_employee = user
        employee_uid = self.request.data.get("employee_uid")
        if employee_uid:
            if not user.is_admin_in(org):
                raise PermissionDenied(
                    {"detail": "Only an admin of the target org may set employee_uid"}
                )
            target_employee = (
                User.objects.filter(uid=employee_uid, memberships__org=org).first()
            )
            if target_employee is None:
                raise ValidationError(
                    {"employee_uid": "User is not a member of the target organisation"}
                )

        files = self.request.FILES.getlist("attachments")
        labels = self.request.data.getlist("attachment_labels") if hasattr(self.request.data, "getlist") else []

        for f in files:
            validate_upload(f)

        with transaction.atomic():
            entry = serializer.save(employee=target_employee, created_by=user, org=org)
            for idx, f in enumerate(files):
                label = labels[idx].strip()[:100] if idx < len(labels) else ""
                ConveyanceAttachment.objects.create(
                    entry=entry,
                    file=f,
                    label=label,
                    uploaded_by=user,
                )

    def _caller_is_admin_in_entry_org(self, entry) -> bool:
        user = cast(User, self.request.user)
        return bool(entry.org_id and user.is_admin_in(entry.org_id))

    def _assert_mutable_for_caller(self, entry):
        user = cast(User, self.request.user)
        if self._caller_is_admin_in_entry_org(entry):
            return
        if entry.status != "pending":
            raise PermissionDenied({"detail": "Only pending entries can be modified"})
        if entry.employee_id != user.id:
            raise PermissionDenied({"detail": "You can only modify your own entries"})

    def perform_update(self, serializer):
        self._assert_mutable_for_caller(serializer.instance)
        serializer.save()

    def perform_destroy(self, instance):
        self._assert_mutable_for_caller(instance)
        for attachment in instance.attachments.all():
            if attachment.file:
                attachment.file.delete(save=False)
        instance.delete()

    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request, uid=None):
        from django.utils import timezone

        from core.audit.models import log as audit_log
        from core.realtime import broadcast

        entry: ConveyanceEntry = self.get_object()
        user = cast(User, request.user)
        if entry.employee_id == user.id:
            raise PermissionDenied({"detail": "Cannot review your own entry"})
        if not user.is_manager_in(entry.org_id):
            raise PermissionDenied(
                {"detail": "Manager or admin role required in the entry's organisation"}
            )
        if entry.status != "pending":
            return Response(
                {"detail": f"Entry is already {entry.status}"},
                status=409,
            )
        entry.status = "approved"
        entry.reviewed_by = user
        entry.reviewed_at = timezone.now()
        entry.review_note = (request.data.get("review_note") or "").strip()[:500]
        entry.save()
        audit_log(
            user,
            "conveyance.approve",
            resource_type="conveyance_entry",
            resource_id=entry.uid,
            changes={"status": "approved"},
            request=request,
        )
        data = ConveyanceEntrySerializer(entry, context={"request": request}).data
        broadcast("conveyance-entries", "UPDATE", data)
        return Response(data)

    @action(detail=True, methods=["post"], url_path="reject")
    def reject(self, request, uid=None):
        from django.utils import timezone

        from core.audit.models import log as audit_log
        from core.realtime import broadcast

        entry: ConveyanceEntry = self.get_object()
        user = cast(User, request.user)
        note = (request.data.get("review_note") or "").strip()
        if len(note) < 3:
            return Response(
                {"review_note": "A rejection note of at least 3 characters is required"},
                status=400,
            )
        if entry.employee_id == user.id:
            raise PermissionDenied({"detail": "Cannot review your own entry"})
        if not user.is_manager_in(entry.org_id):
            raise PermissionDenied(
                {"detail": "Manager or admin role required in the entry's organisation"}
            )
        if entry.status != "pending":
            return Response(
                {"detail": f"Entry is already {entry.status}"},
                status=409,
            )
        entry.status = "rejected"
        entry.reviewed_by = user
        entry.reviewed_at = timezone.now()
        entry.review_note = note[:500]
        entry.save()
        audit_log(
            user,
            "conveyance.reject",
            resource_type="conveyance_entry",
            resource_id=entry.uid,
            changes={"status": "rejected", "reason": entry.review_note},
            request=request,
        )
        data = ConveyanceEntrySerializer(entry, context={"request": request}).data
        broadcast("conveyance-entries", "UPDATE", data)
        return Response(data)


class ConveyanceAttachmentViewSet(UidLookupMixin, ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = ConveyanceAttachmentSerializer
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_queryset(self):
        user = cast(User, self.request.user)
        visible_entries = ConveyanceEntry.objects.filter(visibility_q(user, "employee"))
        return ConveyanceAttachment.objects.select_related(
            "entry", "entry__employee", "uploaded_by"
        ).filter(entry__in=visible_entries)

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "request": self.request}

    def create(self, request, *args, **kwargs):
        from django.shortcuts import get_object_or_404

        from core.filestore.validators import validate_upload
        from core.realtime import broadcast

        user = cast(User, request.user)
        entry_uid = request.data.get("entry_uid")
        if not entry_uid:
            return Response({"entry_uid": "Required"}, status=400)

        entry_qs = ConveyanceEntry.objects.filter(visibility_q(user, "employee"))
        entry = get_object_or_404(entry_qs, uid=entry_uid)

        is_admin_in_org = bool(entry.org_id and user.is_admin_in(entry.org_id))
        if not is_admin_in_org:
            if entry.employee_id != user.id:
                raise PermissionDenied({"detail": "Not allowed to add attachments to this entry"})
            if entry.status != "pending":
                raise PermissionDenied({"detail": "Only pending entries accept new attachments"})

        uploaded = request.FILES.get("file")
        if not uploaded:
            return Response({"file": "Required"}, status=400)
        validate_upload(uploaded)

        label = (request.data.get("label") or "").strip()[:100]
        attachment = ConveyanceAttachment.objects.create(
            entry=entry, file=uploaded, label=label, uploaded_by=user
        )
        broadcast(
            "conveyance-entries",
            "UPDATE",
            ConveyanceEntrySerializer(entry, context={"request": request}).data,
        )
        return Response(
            self.get_serializer(attachment).data,
            status=201,
        )

    def destroy(self, request, *args, **kwargs):
        from core.realtime import broadcast

        attachment = self.get_object()
        entry = attachment.entry
        user = cast(User, request.user)

        is_admin_in_org = bool(entry.org_id and user.is_admin_in(entry.org_id))
        if not is_admin_in_org:
            if entry.employee_id != user.id:
                raise PermissionDenied({"detail": "Not allowed"})
            if entry.status != "pending":
                raise PermissionDenied({"detail": "Only pending entries accept attachment removal"})

        if attachment.file:
            attachment.file.delete(save=False)
        attachment.delete()
        broadcast(
            "conveyance-entries",
            "UPDATE",
            ConveyanceEntrySerializer(entry, context={"request": request}).data,
        )
        return Response(status=204)

    @action(detail=True, methods=["get"], url_path="download")
    def download(self, request, uid=None):
        import mimetypes

        from django.http import FileResponse, Http404

        attachment = self.get_object()
        if not attachment.file:
            raise Http404("No file attached")
        filename = attachment.file.name.rsplit("/", 1)[-1]
        content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        force_download = request.query_params.get("download") in {"1", "true"}
        response = FileResponse(
            attachment.file.open("rb"),
            filename=filename,
            content_type=content_type,
        )
        disposition = "attachment" if force_download else "inline"
        response["Content-Disposition"] = f'{disposition}; filename="{filename}"'
        return response
