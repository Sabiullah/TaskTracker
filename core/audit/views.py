"""Read-only API for querying ``AuditLog`` entries.

Writes happen via ``core.audit.models.log()``; no API surface for insertion
is intentional. Only admins can list.
"""

from typing import cast

from rest_framework import mixins, viewsets

from core.pagination import StandardPagination
from core.permissions import IsAdmin
from users.models import User

from .models import AuditLog
from .serializers import AuditLogSerializer


class AuditLogViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = AuditLogSerializer
    permission_classes = [IsAdmin]
    pagination_class = StandardPagination

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = AuditLog.objects.select_related("actor", "org").filter(org_id__in=user.org_ids()).order_by("-created_at")
        params = self.request.query_params
        if action := params.get("action"):
            qs = qs.filter(action=action)
        if rtype := params.get("resource_type"):
            qs = qs.filter(resource_type=rtype)
        if rid := params.get("resource_id"):
            qs = qs.filter(resource_id=str(rid))
        if actor_uid := params.get("actor_uid"):
            qs = qs.filter(actor__uid=actor_uid)
        if since := params.get("since"):
            qs = qs.filter(created_at__gte=since)
        if until := params.get("until"):
            qs = qs.filter(created_at__lt=until)
        return qs
