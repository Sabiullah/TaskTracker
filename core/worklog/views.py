from typing import cast

from django.db import transaction
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

from .models import WorkLog, WorkPlan
from .serializers import WorkLogSerializer, WorkPlanSerializer


def _raise_from_response(err):
    """Turn an org_utils Response error into the DRF exception equivalent."""
    exc_cls = PermissionDenied if err.status_code == 403 else ValidationError
    raise exc_cls(err.data)


class WorkLogViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = WorkLogSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardPagination

    def get_queryset(self):
        user = cast(User, self.request.user)
        # Per-org visibility: admin/manager/employee rules applied per org
        # membership, not globally (see core.org_utils.visibility_q docstring).
        #
        # Ordering rules:
        #   - Rows the user manually reordered have ``sort_order >= 1`` and
        #     render in that ascending order — the user's arrangement wins.
        #   - Rows still at the default ``sort_order = 0`` are treated as
        #     "not reordered" and fall to natural date-desc / created-desc
        #     order BELOW the manual block. Previously we used
        #     ``-date, sort_order`` which flipped the priority and silently
        #     undid any cross-date reorder on refresh.
        from django.db.models import Case, F, IntegerField, Value, When

        manual_first = Case(
            When(sort_order=0, then=Value(10_000_000)),
            default=F("sort_order"),
            output_field=IntegerField(),
        )
        qs = (
            WorkLog.objects.select_related("user", "client", "org")
            .filter(visibility_q(user, "user"))
            .annotate(_sort_key=manual_first)
            .order_by("_sort_key", "-date", "-created_at")
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
        return qs

    def perform_create(self, serializer):
        org, err = resolve_create_org(self.request)
        if err is not None:
            _raise_from_response(err)
        user = cast(User, self.request.user)
        obj = serializer.save(user=user, org=org)
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

        org, err = resolve_create_org(request)
        if err is not None:
            return err

        # Per-org backdate limit (falls back to global default 7). Looks it up
        # on the org the rows will land in so different orgs can carry
        # different grace windows.
        try:
            backdate_days = int(
                AppSetting.objects.filter(org=org, key="worklog_backdate_days").values_list("value", flat=True).first()
                or 7
            )
        except (TypeError, ValueError):
            backdate_days = 7

        today = timezone.localdate()
        rows = request.data.get("rows", [])
        if not isinstance(rows, list):
            return Response({"error": "Expected rows array"}, status=400)

        # Backdate bypass is granted to admins/managers in this specific org.
        can_backdate = user.is_manager_in(org)

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

            # Admins in this org can log on behalf of a different user.
            row_user = user
            if user.is_admin_in(org) and row.get("user_uid"):
                from django.contrib.auth import get_user_model

                row_user = get_user_model().objects.filter(uid=row["user_uid"]).first() or user

            s = WorkLogSerializer(data=row, context={"request": request})
            if not s.is_valid():
                results.append({"index": i, "status": 400, "error": str(s.errors)})
                failed_count += 1
                continue

            try:
                with transaction.atomic():
                    obj = s.save(user=row_user, org=org)
                broadcast("work-logs", "INSERT", WorkLogSerializer(obj).data)
                results.append({"index": i, "status": 201, "uid": str(obj.uid)})
                created_count += 1
            except Exception as exc:
                results.append({"index": i, "status": 400, "error": str(exc)})
                failed_count += 1

        return Response(
            {"created": created_count, "failed": failed_count, "results": results},
            status=207,
        )

    @action(detail=False, methods=["post"], url_path="reorder")
    def reorder(self, request):
        user = cast(User, request.user)
        rows = request.data.get("rows", [])
        if not isinstance(rows, list):
            return Response({"error": "Expected rows array"}, status=400)

        uid_order = {str(r["uid"]): r["sort_order"] for r in rows if "uid" in r and "sort_order" in r}
        if not uid_order:
            return Response({"updated": 0})

        # Reuse the same visibility rule as the list queryset so an employee
        # in one org can't reorder rows they'd never see, but a manager in
        # the right org can reorder subordinates' rows.
        qs = WorkLog.objects.filter(visibility_q(user, "user"), uid__in=uid_order.keys())

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
        qs = WorkPlan.objects.select_related("assigned_to", "client", "org", "created_by").filter(
            visibility_q(user, "assigned_to")
        )

        date = self.request.query_params.get("date")
        user_uid = self.request.query_params.get("user_uid")
        if date:
            qs = qs.filter(date=date)
        if user_uid:
            qs = qs.filter(assigned_to__uid=user_uid)
        return qs

    def perform_create(self, serializer):
        org, err = resolve_create_org(self.request)
        if err is not None:
            _raise_from_response(err)
        user = cast(User, self.request.user)
        obj = serializer.save(created_by=user, org=org)
        broadcast("work-plans", "INSERT", WorkPlanSerializer(obj).data)

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast("work-plans", "UPDATE", WorkPlanSerializer(obj).data)

    def perform_destroy(self, instance):
        broadcast("work-plans", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()

    @action(detail=True, methods=["post"], url_path="apply_to_following")
    def apply_to_following(self, request, *args, **kwargs):
        """Apply the edited fields to this row and every later same-series row.

        Atomic. ``date`` is applied as a delta so weekday/day-of-month cadence
        is preserved across the shifted block. Other fields are applied verbatim.
        """
        source = self.get_object()
        if source.series_uid is None:
            raise ValidationError({"detail": "Row is not part of a series."})

        allowed = {"date", "task_description", "planned_hours", "client"}
        payload = {k: v for k, v in request.data.items() if k in allowed}
        if not payload:
            raise ValidationError({"detail": "Provide at least one field to update."})

        # Validate the payload through the standard serializer so range/format
        # checks (e.g. HOURS_VALIDATORS on planned_hours) match the PATCH path.
        # We validate against the source row partial-style — every field in
        # ``payload`` is one the serializer will accept; series-only fields were
        # already stripped by the ``allowed`` filter.
        ser = WorkPlanSerializer(source, data=payload, partial=True)
        ser.is_valid(raise_exception=True)

        if "task_description" in payload and not payload["task_description"].strip():
            raise ValidationError({"task_description": "Task description cannot be empty."})

        # Resolve the client uid → Master pk, if provided.
        new_client = None
        if "client" in payload:
            from core.masters.models import Master

            client_uid = payload["client"]
            if client_uid in (None, ""):
                new_client = None
            else:
                try:
                    new_client = Master.objects.get(uid=client_uid, type="client")
                except Master.DoesNotExist as err:
                    raise ValidationError({"client": "Unknown client uid."}) from err

        # Resolve the date delta, if provided.
        delta = None
        if "date" in payload:
            import datetime

            try:
                new_date = datetime.date.fromisoformat(payload["date"])
            except (TypeError, ValueError) as err:
                raise ValidationError({"date": "Invalid date."}) from err
            delta = new_date - source.date

        new_task = payload.get("task_description")
        new_hours = payload.get("planned_hours")

        updated_count = 0
        with transaction.atomic():
            rows = (
                WorkPlan.objects.select_for_update()
                .filter(series_uid=source.series_uid, date__gte=source.date)
                .order_by("date")
            )
            for row in rows:
                if new_task is not None:
                    row.task_description = new_task
                if new_hours is not None:
                    row.planned_hours = new_hours
                if "client" in payload:
                    row.client = new_client
                if delta is not None:
                    row.date = row.date + delta
                row.save()
                broadcast("work-plans", "UPDATE", WorkPlanSerializer(row).data)
                updated_count += 1

        return Response({"updated_count": updated_count})
