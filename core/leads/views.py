from typing import cast

from rest_framework import permissions
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.org_utils import resolve_create_org, visibility_q
from core.pagination import StandardPagination
from core.realtime import broadcast
from users.models import User

from .models import Lead, LeadHistory, LeadStatus
from .serializers import LeadHistorySerializer, LeadSerializer, LeadStatusSerializer


def _raise_from_response(err):
    exc_cls = PermissionDenied if err.status_code == 403 else ValidationError
    raise exc_cls(err.data)


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

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = (
            Lead.objects.select_related("client", "status", "assigned_to", "created_by")
            .prefetch_related("history")
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
