import datetime
from typing import cast

from django.db import transaction
from django.utils import timezone
from rest_framework import permissions
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.org_utils import resolve_create_org, visibility_q
from core.pagination import StandardPagination
from core.realtime import broadcast
from users.models import User

from .models import Attendance
from .serializers import AttendanceSerializer


def _raise_from_response(err):
    exc_cls = PermissionDenied if err.status_code == 403 else ValidationError
    raise exc_cls(err.data)


class AttendanceViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = AttendanceSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardPagination

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = (
            Attendance.objects.select_related("user", "created_by").filter(visibility_q(user, "user")).order_by("-date")
        )

        month = self.request.query_params.get("month")
        date = self.request.query_params.get("date")
        user_uid = self.request.query_params.get("user_uid")

        if month:
            qs = qs.filter(date__startswith=month)
        if date:
            qs = qs.filter(date=date)
        if user_uid:
            qs = qs.filter(user__uid=user_uid)
        return qs

    def perform_create(self, serializer):
        org, err = resolve_create_org(self.request)
        if err is not None:
            _raise_from_response(err)
        user = cast(User, self.request.user)
        obj = serializer.save(created_by=user, org=org)
        broadcast("attendance", "INSERT", AttendanceSerializer(obj).data)

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast("attendance", "UPDATE", AttendanceSerializer(obj).data)

    def perform_destroy(self, instance):
        broadcast("attendance", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()

    @action(detail=False, methods=["post"], url_path="quick_punch")
    def quick_punch(self, request):
        """Toggle today's punch-in/out for the calling user.

        Lands the row in the user's default org. If they have no default,
        use `perform_create`-style flow via the normal POST endpoint with an
        explicit ``org_id``.
        """
        user = cast(User, request.user)
        today = timezone.localdate()
        default_org = user.default_org
        if default_org is None:
            return Response({"error": "User is not a member of any organisation"}, status=400)

        try:
            attendance = Attendance.objects.get(user=user, date=today)
        except Attendance.DoesNotExist:
            attendance = Attendance.objects.create(
                user=user,
                date=today,
                login_time=timezone.localtime().time(),
                status="Present",
                work_location=getattr(user, "default_work_location", "Office"),
                created_by=user,
                org=default_org,
            )
            broadcast("attendance", "INSERT", AttendanceSerializer(attendance).data)
            return Response(AttendanceSerializer(attendance).data)

        if attendance.login_time and not attendance.logout_time:
            attendance.logout_time = timezone.localtime().time()
            attendance.save()
            broadcast("attendance", "UPDATE", AttendanceSerializer(attendance).data)
            return Response(AttendanceSerializer(attendance).data)

        if attendance.login_time and attendance.logout_time:
            return Response({"error": "already-punched-out"}, status=400)

        attendance.login_time = timezone.localtime().time()
        attendance.save()
        broadcast("attendance", "UPDATE", AttendanceSerializer(attendance).data)
        return Response(AttendanceSerializer(attendance).data)

    @action(detail=False, methods=["post"], url_path="bulk_import")
    def bulk_import(self, request):
        from django.core.cache import cache

        from core.settings_app.models import AppSetting

        user = cast(User, request.user)

        org, err = resolve_create_org(request)
        if err is not None:
            return err

        assert org is not None
        # Per-org backdate limit with a short cache to avoid a DB hit per row.
        cache_key = f"appsetting:{org.id}:attendance_backdate_days"
        backdate_days = cache.get(cache_key)
        if backdate_days is None:
            try:
                backdate_days = int(
                    AppSetting.objects.filter(org=org, key="attendance_backdate_days")
                    .values_list("value", flat=True)
                    .first()
                    or 7
                )
            except (TypeError, ValueError):
                backdate_days = 7
            cache.set(cache_key, backdate_days, timeout=300)

        # Role checks are per-org on the target org.
        is_admin = user.is_admin_in(org)
        is_manager = user.is_manager_in(org)
        can_backdate = is_manager  # admins are managers too

        subordinate_ids: set[int] = set()
        if is_manager and not is_admin:
            subordinate_ids = set(user.subordinates.values_list("id", flat=True))
            subordinate_ids.add(user.id)

        today = timezone.localdate()
        rows = request.data.get("rows", [])
        if not isinstance(rows, list):
            return Response({"error": "Expected rows array"}, status=400)

        created_count = failed_count = 0
        results = []
        for i, row in enumerate(rows):
            date_str = row.get("date")
            if not date_str:
                results.append({"index": i, "status": 400, "error": "date required"})
                failed_count += 1
                continue

            try:
                date = datetime.date.fromisoformat(date_str)
            except ValueError:
                results.append({"index": i, "status": 400, "error": "invalid date"})
                failed_count += 1
                continue

            if not can_backdate and (today - date).days > backdate_days:
                results.append({"index": i, "status": 400, "error": "backdate-violation", "max_days": backdate_days})
                failed_count += 1
                continue

            row_user = user
            target_uid = row.get("user_uid")
            if target_uid:
                candidate = User.objects.filter(uid=target_uid).first()
                if candidate is None:
                    results.append({"index": i, "status": 400, "error": "user not found"})
                    failed_count += 1
                    continue
                if is_admin:
                    row_user = candidate
                elif is_manager:
                    if candidate.id not in subordinate_ids:
                        results.append({"index": i, "status": 403, "error": "not authorized for this user"})
                        failed_count += 1
                        continue
                    row_user = candidate
                elif candidate.id != user.id:
                    results.append({"index": i, "status": 403, "error": "not authorized for this user"})
                    failed_count += 1
                    continue

            s = AttendanceSerializer(data={**row, "date": date_str}, context={"request": request})
            if not s.is_valid():
                results.append({"index": i, "status": 400, "error": str(s.errors)})
                failed_count += 1
                continue

            try:
                with transaction.atomic():
                    obj = s.save(user=row_user, created_by=user, org=org)
                broadcast("attendance", "INSERT", AttendanceSerializer(obj).data)
                results.append({"index": i, "status": 201, "uid": str(obj.uid)})
                created_count += 1
            except Exception as exc:
                results.append({"index": i, "status": 400, "error": str(exc)})
                failed_count += 1

        return Response(
            {"created": created_count, "failed": failed_count, "results": results},
            status=207,
        )
