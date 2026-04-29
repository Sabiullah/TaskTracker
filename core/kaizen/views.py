from typing import cast

from django.utils import timezone
from rest_framework import permissions
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.org_utils import resolve_create_org
from core.realtime import broadcast
from users.models import User

from .models import Kaizen
from .serializers import KaizenSerializer


def _raise_from_response(err):
    """Translate the (response, error) tuples returned by ``resolve_create_org``
    into the matching DRF exception so the viewset can ``raise`` instead of
    returning a Response from ``perform_create``.
    """
    exc_cls = PermissionDenied if err.status_code == 403 else ValidationError
    raise exc_cls(err.data)


class KaizenViewSet(UidLookupMixin, ModelViewSet):
    """Cross-organisation Kaizen Library.

    The list endpoint deliberately does NOT filter by ``request.user.org`` —
    every authenticated user sees every (non-rejected) Kaizen entry regardless
    of which org raised it. The ``org`` FK is stored on the row for
    traceability/reporting only. See the design spec, §2.4.
    """

    serializer_class = KaizenSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = Kaizen.objects.select_related(
            "org", "raised_by", "client", "reviewed_by"
        )

        # Optional filters
        status_param = self.request.query_params.get("status")
        client_uid = self.request.query_params.get("client_uid")
        if status_param:
            qs = qs.filter(status=status_param)
        if client_uid:
            qs = qs.filter(client__uid=client_uid)

        # Hide ``Rejected`` rows from the default list. Admins (in any org) may
        # opt back in via ``?include_rejected=1``. Applied LAST so it overrides
        # any prior ``?status=Rejected`` filter from a non-admin caller.
        include_rejected = (
            self.request.query_params.get("include_rejected") == "1"
            and user.is_admin_in_any()
        )
        if not include_rejected:
            qs = qs.exclude(status="Rejected")
        return qs

    def perform_create(self, serializer):
        org, err = resolve_create_org(self.request)
        if err is not None:
            _raise_from_response(err)
        obj = serializer.save(
            raised_by=self.request.user,
            org=org,
            entry_date=timezone.localdate(),
            status="Pending",
        )
        broadcast("kaizen", "INSERT", KaizenSerializer(obj).data)

    def perform_update(self, serializer):
        instance = cast(Kaizen, serializer.instance)
        user = cast(User, self.request.user)
        is_owner_pending = (
            instance.raised_by_id == user.pk and instance.status == "Pending"
        )
        if not (is_owner_pending or user.is_admin_in_any()):
            raise PermissionDenied(
                "Only the raiser (while Pending) or an admin can edit this entry."
            )
        obj = serializer.save()
        broadcast("kaizen", "UPDATE", KaizenSerializer(obj).data)

    def perform_destroy(self, instance):
        user = cast(User, self.request.user)
        is_owner_pending = (
            instance.raised_by_id == user.pk and instance.status == "Pending"
        )
        if not (is_owner_pending or user.is_admin_in_any()):
            raise PermissionDenied(
                "Only the raiser (while Pending) or an admin can delete this entry."
            )
        broadcast("kaizen", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()

    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request, uid=None):
        user = cast(User, request.user)
        if not user.is_admin_in_any():
            raise PermissionDenied("Admin role required to approve")
        obj: Kaizen = self.get_object()
        if obj.status != "Pending":
            raise ValidationError({"detail": f"Cannot approve a {obj.status} entry"})
        obj.status = "Approved"
        obj.reviewed_by = user
        obj.reviewed_at = timezone.now()
        obj.rejection_reason = ""
        obj.save(
            update_fields=[
                "status",
                "reviewed_by",
                "reviewed_at",
                "rejection_reason",
                "updated_at",
            ]
        )
        data = KaizenSerializer(obj).data
        broadcast("kaizen", "UPDATE", data)
        return Response(data)

    @action(detail=True, methods=["post"], url_path="reject")
    def reject(self, request, uid=None):
        user = cast(User, request.user)
        if not user.is_admin_in_any():
            raise PermissionDenied("Admin role required to reject")
        reason = (request.data.get("reason") or "").strip()
        if not reason:
            raise ValidationError({"reason": ["Rejection reason is required"]})
        obj: Kaizen = self.get_object()
        if obj.status != "Pending":
            raise ValidationError({"detail": f"Cannot reject a {obj.status} entry"})
        obj.status = "Rejected"
        obj.reviewed_by = user
        obj.reviewed_at = timezone.now()
        obj.rejection_reason = reason
        obj.save(
            update_fields=[
                "status",
                "reviewed_by",
                "reviewed_at",
                "rejection_reason",
                "updated_at",
            ]
        )
        data = KaizenSerializer(obj).data
        broadcast("kaizen", "UPDATE", data)
        return Response(data)
