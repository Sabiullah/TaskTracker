from typing import cast

from rest_framework import permissions
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.org_utils import visibility_q
from core.pagination import StandardPagination
from users.models import User

from .models import ConveyanceEntry
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
