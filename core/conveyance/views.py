from typing import cast

from django.db import transaction
from rest_framework import permissions
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.filestore.validators import validate_upload
from core.org_utils import resolve_create_org, visibility_q
from core.pagination import StandardPagination
from users.models import User

from .models import ConveyanceAttachment, ConveyanceEntry
from .serializers import ConveyanceEntrySerializer


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
        instance.delete()


class ConveyanceAttachmentViewSet(UidLookupMixin, ModelViewSet):
    """Read-only ViewSet providing the download action for attachments."""

    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "head", "options"]

    def get_queryset(self):
        user = cast(User, self.request.user)
        visible_entries = ConveyanceEntry.objects.filter(visibility_q(user, "employee"))
        return ConveyanceAttachment.objects.filter(entry__in=visible_entries)

    @action(detail=True, methods=["get"], url_path="download")
    def download(self, request, uid=None):
        """Stream a conveyance attachment file to the authenticated user."""
        import mimetypes

        from django.http import FileResponse, Http404

        att: ConveyanceAttachment = self.get_object()
        if not att.file:
            raise Http404("No file attached")
        filename = (att.file.name or "").split("/")[-1]
        content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        force_download = request.query_params.get("download") in ("1", "true")
        response = FileResponse(
            att.file.open("rb"),
            filename=filename,
            content_type=content_type,
        )
        disposition = "attachment" if force_download else "inline"
        response["Content-Disposition"] = f'{disposition}; filename="{filename}"'
        return response
