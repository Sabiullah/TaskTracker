from typing import cast

from django.db import transaction
from rest_framework import permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.pagination import StandardPagination
from core.realtime import broadcast
from users.models import User

from .models import WorkLog, WorkPlan
from .serializers import WorkLogSerializer, WorkPlanSerializer


class WorkLogViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = WorkLogSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardPagination

    def get_queryset(self):
        user = cast(User, self.request.user)
        role = user.role
        qs = (
            WorkLog.objects.select_related("user", "client", "org")
            .filter(org=getattr(user, "org", None))
            .order_by("-date", "sort_order")
        )

        date = self.request.query_params.get("date")
        month = self.request.query_params.get("month")
        user_uid = self.request.query_params.get("user_uid")

        if date:
            qs = qs.filter(date=date)
        if month:
            qs = qs.filter(date__startswith=month)
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
        obj = serializer.save(user=user, org=getattr(user, "org", None))
        broadcast("work-logs", "INSERT", WorkLogSerializer(obj).data)

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast("work-logs", "UPDATE", WorkLogSerializer(obj).data)

    def perform_destroy(self, instance):
        broadcast("work-logs", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()

    @action(detail=False, methods=["post"], url_path="bulk_import")
    def bulk_import(self, request):
        import datetime

        from django.utils import timezone

        from core.settings_app.models import AppSetting

        user = cast(User, request.user)
        role = user.role

        try:
            backdate_days = int(
                AppSetting.objects.filter(org=user.org, key="worklog_backdate_days")
                .values_list("value", flat=True)
                .first()
                or 7
            )
        except (TypeError, ValueError):
            backdate_days = 7

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
            if role == "admin" and row.get("user_uid"):
                from django.contrib.auth import get_user_model

                row_user = get_user_model().objects.filter(uid=row["user_uid"]).first() or user

            s = WorkLogSerializer(data=row, context={"request": request})
            if not s.is_valid():
                results.append({"index": i, "status": 400, "error": str(s.errors)})
                failed_count += 1
                continue

            try:
                with transaction.atomic():
                    obj = s.save(user=row_user, org=getattr(user, "org", None))
                broadcast("work-logs", "INSERT", WorkLogSerializer(obj).data)
                results.append({"index": i, "status": 201, "uid": str(obj.uid)})
                created_count += 1
            except Exception as exc:
                results.append({"index": i, "status": 400, "error": str(exc)})
                failed_count += 1

        return Response({"created": created_count, "failed": failed_count, "results": results}, status=207)

    @action(detail=False, methods=["post"], url_path="reorder")
    def reorder(self, request):
        user = cast(User, request.user)
        role = user.role
        rows = request.data.get("rows", [])
        if not isinstance(rows, list):
            return Response({"error": "Expected rows array"}, status=400)

        uid_order = {str(r["uid"]): r["sort_order"] for r in rows if "uid" in r and "sort_order" in r}
        if not uid_order:
            return Response({"updated": 0})

        qs = WorkLog.objects.filter(uid__in=uid_order.keys())
        if role not in ("admin", "manager"):
            qs = qs.filter(user=user)

        with transaction.atomic():
            updated = 0
            for wl in qs:
                wl.sort_order = uid_order[str(wl.uid)]
                wl.save(update_fields=["sort_order"])
                updated += 1

        return Response({"updated": updated})


class WorkPlanViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = WorkPlanSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = cast(User, self.request.user)
        role = user.role
        qs = WorkPlan.objects.select_related("assigned_to", "client", "org", "created_by").filter(
            org=getattr(user, "org", None)
        )

        date = self.request.query_params.get("date")
        user_uid = self.request.query_params.get("user_uid")
        if date:
            qs = qs.filter(date=date)
        if user_uid:
            qs = qs.filter(assigned_to__uid=user_uid)

        if role in ("admin", "manager"):
            return qs
        return qs.filter(assigned_to=user)

    def perform_create(self, serializer):
        user = cast(User, self.request.user)
        obj = serializer.save(created_by=user, org=getattr(user, "org", None))
        broadcast("work-plans", "INSERT", WorkPlanSerializer(obj).data)

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast("work-plans", "UPDATE", WorkPlanSerializer(obj).data)

    def perform_destroy(self, instance):
        broadcast("work-plans", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()
