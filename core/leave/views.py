from typing import cast

from rest_framework import permissions
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from core.attendance.models import Attendance
from core.base import UidLookupMixin
from core.org_utils import resolve_create_org, visibility_q
from core.pagination import StandardPagination
from core.realtime import broadcast
from users.models import User

from .models import LeaveRequest
from .permissions import approver_pool, can_approve
from .serializers import LeaveRequestSerializer


def _raise(err):
    exc_cls = PermissionDenied if err.status_code == 403 else ValidationError
    raise exc_cls(err.data)


class LeaveRequestViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = LeaveRequestSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardPagination

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = LeaveRequest.objects.select_related("user", "approver", "org").filter(visibility_q(user, "user"))

        status_q = self.request.query_params.get("status")
        user_uid = self.request.query_params.get("user_uid")
        month = self.request.query_params.get("month")
        if status_q:
            qs = qs.filter(status=status_q)
        if user_uid:
            qs = qs.filter(user__uid=user_uid)
        if month:
            qs = qs.filter(from_date__startswith=month)
        return qs.order_by("-from_date", "-id")

    def perform_create(self, serializer):
        request = self.request
        user = cast(User, request.user)
        org, err = resolve_create_org(request)
        if err is not None:
            _raise(err)
        target_uid = request.data.get("user")
        target = user
        if target_uid and str(target_uid) != str(user.uid):
            looked = User.objects.filter(uid=target_uid).first()
            if looked is None:
                raise ValidationError({"user": "Unknown user"})
            if not user.is_admin_in(org):
                raise PermissionDenied({"detail": "Only an admin may file leave for another user"})
            target = looked
        instance: LeaveRequest = serializer.save(user=target, created_by=user, org=org)
        instance.total_days = instance.compute_total_days()
        instance.save(update_fields=["total_days"])

        # Admins are auto-approved (spec Q5).
        if not approver_pool(target, org):
            instance.apply_state_transition("Approved", by_user=user)

        payload = LeaveRequestSerializer(instance).data
        broadcast("leave", "INSERT", payload)
        broadcast(
            "leave.approval",
            "PENDING" if instance.status == "Pending" else "DECIDED",
            {**payload, "approver_uids": [str(User.objects.get(pk=u).uid) for u in approver_pool(target, org)]},
        )

    def perform_update(self, serializer):
        instance = serializer.instance
        if instance.status != "Pending":
            raise ValidationError({"detail": "Only Pending requests can be edited"})
        user = cast(User, self.request.user)
        if instance.user_id != user.pk and not user.is_admin_in(instance.org):
            raise PermissionDenied({"detail": "Only the requester or an admin may edit"})
        obj = serializer.save()
        obj.total_days = obj.compute_total_days()
        obj.save(update_fields=["total_days"])
        broadcast("leave", "UPDATE", LeaveRequestSerializer(obj).data)

    def perform_destroy(self, instance):
        # Use Withdraw instead of delete to keep history.
        raise PermissionDenied({"detail": "Use the withdraw action instead of DELETE"})

    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request, uid=None):
        instance: LeaveRequest = self.get_object()
        actor = cast(User, request.user)
        if not can_approve(actor, instance.user, instance.org):
            raise PermissionDenied({"detail": "You are not in the approver pool for this request"})
        if instance.status != "Pending":
            raise ValidationError({"detail": f"Cannot approve a {instance.status} request"})
        # Conflict guard — see signals.materialise_attendance.
        conflicting = []
        for date, session in instance.included_dates():
            row = Attendance.objects.filter(user=instance.user, date=date).first()
            if row and row.status not in ("Leave", "Half Day"):
                conflicting.append(str(date))
            elif row and row.status == "Half Day" and session == "Full":
                conflicting.append(str(date))
        if conflicting:
            raise ValidationError({"detail": "conflict-on-date", "dates": conflicting})
        instance.apply_state_transition("Approved", by_user=actor)
        payload = LeaveRequestSerializer(instance).data
        broadcast("leave", "UPDATE", payload)
        broadcast("leave.approval", "DECIDED", {**payload, "decision": "Approved"})
        return Response(payload)

    @action(detail=True, methods=["post"], url_path="reject")
    def reject(self, request, uid=None):
        instance: LeaveRequest = self.get_object()
        actor = cast(User, request.user)
        if not can_approve(actor, instance.user, instance.org):
            raise PermissionDenied({"detail": "You are not in the approver pool for this request"})
        if instance.status != "Pending":
            raise ValidationError({"detail": f"Cannot reject a {instance.status} request"})
        reason = (request.data.get("reason") or "").strip()
        if not reason:
            raise ValidationError({"reason": "Required when rejecting"})
        instance.apply_state_transition("Rejected", by_user=actor, reason=reason)
        payload = LeaveRequestSerializer(instance).data
        broadcast("leave", "UPDATE", payload)
        broadcast("leave.approval", "DECIDED", {**payload, "decision": "Rejected"})
        return Response(payload)

    @action(detail=True, methods=["post"], url_path="withdraw")
    def withdraw(self, request, uid=None):
        instance: LeaveRequest = self.get_object()
        actor = cast(User, request.user)
        if instance.user_id != actor.pk:
            raise PermissionDenied({"detail": "Only the requester may withdraw"})
        if instance.status not in ("Pending", "Approved"):
            raise ValidationError({"detail": f"Cannot withdraw a {instance.status} request"})
        instance.apply_state_transition("Withdrawn", by_user=actor)
        payload = LeaveRequestSerializer(instance).data
        broadcast("leave", "UPDATE", payload)
        return Response(payload)
