import datetime
import uuid
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
from .services import generate_plan_dates


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

        When ``recurrence`` or ``recurrence_end_date`` change, this becomes a
        *reshape*: the source row is updated in place, all later same-series
        rows are deleted, and a fresh forward block is materialized using
        ``generate_plan_dates`` so the rest of the series matches the new
        cadence/end the Add Plan modal would have produced.
        """
        source = self.get_object()
        if source.series_uid is None:
            raise ValidationError({"detail": "Row is not part of a series."})

        allowed = {
            "date",
            "task_description",
            "planned_hours",
            "client",
            "recurrence",
            "recurrence_end_date",
        }
        payload = {k: v for k, v in request.data.items() if k in allowed}
        if not payload:
            raise ValidationError({"detail": "Provide at least one field to update."})

        # Turning a series into a one-time row is out of scope (delete instead).
        if "recurrence" in payload and payload["recurrence"] == "":
            raise ValidationError({"recurrence": "Cannot clear recurrence on a series."})

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
            new_client = _resolve_client_uid(payload["client"])

        # Resolve the date delta, if provided.
        delta = None
        if "date" in payload:
            try:
                new_date = datetime.date.fromisoformat(payload["date"])
            except (TypeError, ValueError) as err:
                raise ValidationError({"date": "Invalid date."}) from err
            delta = new_date - source.date

        new_task = payload.get("task_description")
        new_hours = payload.get("planned_hours")

        # Detect reshape: a change to cadence (recurrence) or end (recurrence_end_date).
        new_recurrence_raw = payload.get("recurrence")
        new_end_raw = payload.get("recurrence_end_date")
        recurrence_changed = "recurrence" in payload and new_recurrence_raw != source.recurrence
        end_changed = False
        new_end: datetime.date | None = None
        if "recurrence_end_date" in payload:
            if not new_end_raw:
                raise ValidationError({"recurrence_end_date": "End date is required on a series."})
            try:
                new_end = datetime.date.fromisoformat(str(new_end_raw))
            except (TypeError, ValueError) as err:
                raise ValidationError({"recurrence_end_date": "Invalid date."}) from err
            end_changed = new_end != source.recurrence_end_date
        reshape = recurrence_changed or end_changed

        if not reshape:
            # Existing behavior: per-row update in place.
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

        # Reshape branch.
        with transaction.atomic():
            # Lock all same-series rows from the source date onward (we touch
            # the source then delete everything past it).
            rows_to_drop = WorkPlan.objects.select_for_update().filter(
                series_uid=source.series_uid, date__gt=source.date
            )
            rows_to_drop_payloads = [{"id": r.pk, "uid": str(r.uid)} for r in rows_to_drop]
            rows_to_drop.delete()
            for p in rows_to_drop_payloads:
                broadcast("work-plans", "DELETE", p)

            # Update the source row with the edited fields, including the new
            # recurrence / recurrence_end_date.
            if new_task is not None:
                source.task_description = new_task
            if new_hours is not None:
                source.planned_hours = new_hours
            if "client" in payload:
                source.client = new_client
            if delta is not None:
                source.date = source.date + delta
            if "recurrence" in payload:
                source.recurrence = new_recurrence_raw
            if "recurrence_end_date" in payload:
                source.recurrence_end_date = new_end
            source.save()
            broadcast("work-plans", "UPDATE", WorkPlanSerializer(source).data)

            # Materialize forward rows from the (possibly shifted) source date
            # through the new end, using the new cadence. ``generate_plan_dates``
            # includes the start date itself; skip it to avoid duplicating
            # the source row.
            effective_recurrence = source.recurrence
            effective_end = source.recurrence_end_date
            updated_count = 1
            if effective_end is not None and effective_recurrence:
                dates = generate_plan_dates(source.date, effective_end, effective_recurrence)
                for d in dates:
                    if d == source.date:
                        continue
                    new_row = WorkPlan.objects.create(
                        org=source.org,
                        assigned_to=source.assigned_to,
                        date=d,
                        task_description=source.task_description,
                        planned_hours=source.planned_hours,
                        client=source.client,
                        series_uid=source.series_uid,
                        recurrence=source.recurrence,
                        recurrence_end_date=source.recurrence_end_date,
                    )
                    broadcast("work-plans", "INSERT", WorkPlanSerializer(new_row).data)
                    updated_count += 1

        return Response({"updated_count": updated_count})

    @action(detail=True, methods=["post"], url_path="promote_to_series")
    def promote_to_series(self, request, *args, **kwargs):
        """Promote a one-time row into a new series.

        Stamps a fresh ``series_uid`` on the source, applies the user's edits,
        and materializes forward rows using the new cadence.
        """
        source = self.get_object()
        if source.series_uid is not None:
            raise ValidationError({"detail": "Row is already part of a series; use apply_to_following instead."})

        allowed = {
            "date",
            "task_description",
            "planned_hours",
            "client",
            "recurrence",
            "recurrence_end_date",
        }
        payload = {k: v for k, v in request.data.items() if k in allowed}

        recurrence = payload.get("recurrence")
        if not recurrence:
            raise ValidationError({"recurrence": "Recurrence is required to promote a row."})

        end_raw = payload.get("recurrence_end_date")
        if not end_raw:
            raise ValidationError({"recurrence_end_date": "End date is required to promote a row."})
        try:
            end_date = datetime.date.fromisoformat(end_raw)
        except (TypeError, ValueError) as err:
            raise ValidationError({"recurrence_end_date": "Invalid date."}) from err

        # Standard serializer validation (planned_hours range, etc.).
        ser = WorkPlanSerializer(source, data=payload, partial=True)
        ser.is_valid(raise_exception=True)

        if "task_description" in payload and not payload["task_description"].strip():
            raise ValidationError({"task_description": "Task description cannot be empty."})

        # Resolve optional client.
        new_client = source.client
        if "client" in payload:
            new_client = _resolve_client_uid(payload["client"])

        # Resolve optional new date.
        new_date = source.date
        if "date" in payload:
            try:
                new_date = datetime.date.fromisoformat(payload["date"])
            except (TypeError, ValueError) as err:
                raise ValidationError({"date": "Invalid date."}) from err

        with transaction.atomic():
            series_uid = uuid.uuid4()
            source.series_uid = series_uid
            source.recurrence = recurrence
            source.recurrence_end_date = end_date
            if "task_description" in payload:
                source.task_description = payload["task_description"]
            if "planned_hours" in payload:
                source.planned_hours = payload["planned_hours"]
            if "client" in payload:
                source.client = new_client
            if "date" in payload:
                source.date = new_date
            source.save()
            broadcast("work-plans", "UPDATE", WorkPlanSerializer(source).data)

            updated_count = 1
            if source.date is not None:
                dates = generate_plan_dates(source.date, end_date, recurrence)
                for d in dates:
                    if d == source.date:
                        continue
                    new_row = WorkPlan.objects.create(
                        org=source.org,
                        assigned_to=source.assigned_to,
                        date=d,
                        task_description=source.task_description,
                        planned_hours=source.planned_hours,
                        client=source.client,
                        series_uid=series_uid,
                        recurrence=recurrence,
                        recurrence_end_date=end_date,
                    )
                    broadcast("work-plans", "INSERT", WorkPlanSerializer(new_row).data)
                    updated_count += 1

        return Response({"updated_count": updated_count})


def _resolve_client_uid(client_uid):
    """Map a client uid (or null/empty) to a Master instance.

    Shared by ``apply_to_following`` and ``promote_to_series``.
    """
    from core.masters.models import Master

    if client_uid in (None, ""):
        return None
    try:
        return Master.objects.get(uid=client_uid, type="client")
    except Master.DoesNotExist as err:
        raise ValidationError({"client": "Unknown client uid."}) from err
