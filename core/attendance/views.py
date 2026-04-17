import datetime
from typing import cast

from django.db import transaction
from django.utils import timezone
from rest_framework import permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.pagination import StandardPagination
from core.realtime import broadcast
from users.models import User

from .models import Attendance
from .serializers import AttendanceSerializer


class AttendanceViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = AttendanceSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardPagination

    def get_queryset(self):
        user = cast(User, self.request.user)
        role = user.role
        qs = (
            Attendance.objects.select_related("user", "created_by")
            .filter(org=getattr(user, "org", None))
            .order_by("-date")
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

        if role == "admin":
            return qs
        if role == "manager":
            subordinate_ids = list(user.subordinates.values_list("id", flat=True))
            subordinate_ids.append(user.id)
            return qs.filter(user_id__in=subordinate_ids)
        return qs.filter(user=user)

    def perform_create(self, serializer):
        user = cast(User, self.request.user)
        obj = serializer.save(created_by=user, org=getattr(user, "org", None))
        broadcast("attendance", "INSERT", AttendanceSerializer(obj).data)

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast("attendance", "UPDATE", AttendanceSerializer(obj).data)

    def perform_destroy(self, instance):
        broadcast("attendance", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()

    @action(detail=False, methods=["post"], url_path="quick_punch")
    def quick_punch(self, request):
        user = cast(User, request.user)
        today = timezone.localdate()

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
                org=user.org,
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

        # Row exists but has no login_time — set it now.
        attendance.login_time = timezone.localtime().time()
        attendance.save()
        broadcast("attendance", "UPDATE", AttendanceSerializer(attendance).data)
        return Response(AttendanceSerializer(attendance).data)

    @action(detail=False, methods=["post"], url_path="bulk_import")
    def bulk_import(self, request):
        from django.core.cache import cache

        from core.settings_app.models import AppSetting

        user = cast(User, request.user)
        role = user.role

        cache_key = f"appsetting:{getattr(user, 'org_id', None)}:attendance_backdate_days"
        backdate_days = cache.get(cache_key)
        if backdate_days is None:
            try:
                backdate_days = int(
                    AppSetting.objects.filter(org=user.org, key="attendance_backdate_days")
                    .values_list("value", flat=True)
                    .first()
                    or 7
                )
            except (TypeError, ValueError):
                backdate_days = 7
            cache.set(cache_key, backdate_days, timeout=300)

        subordinate_ids: set[int] = set()
        if role == "manager":
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

            if role not in ("admin", "manager") and (today - date).days > backdate_days:
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
                if role == "admin":
                    row_user = candidate
                elif role == "manager":
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
                    obj = s.save(user=row_user, created_by=user, org=user.org)
                broadcast("attendance", "INSERT", AttendanceSerializer(obj).data)
                results.append({"index": i, "status": 201, "uid": str(obj.uid)})
                created_count += 1
            except Exception as exc:
                results.append({"index": i, "status": 400, "error": str(exc)})
                failed_count += 1

        return Response({"created": created_count, "failed": failed_count, "results": results}, status=207)
