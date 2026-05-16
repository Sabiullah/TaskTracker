import datetime as dt
from typing import Any, cast

from rest_framework import permissions
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError as DrfValidationError
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.masters.models import Master
from core.org_utils import resolve_admin_org, resolve_create_org, visibility_q
from core.pagination import StandardPagination
from core.permissions import IsAdmin
from core.realtime import broadcast
from core.tasks.models import TaskSubcategoryPlan
from core.tasks.services import (
    add_or_extend_plan,
    cap_plan,
    cascade_owner_forward,
    materialize_month,
    update_plan_recurrence,
)
from users.models import User

from .models import Task, TaskLog
from .serializers import (
    TaskLogSerializer,
    TaskSerializer,
    TaskSubcategoryPlanSerializer,
    TaskWithSubtasksSerializer,
)


class TaskViewSet(UidLookupMixin, ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardPagination

    def get_serializer_class(self):
        # Use the nested serializer when the request includes a subtasks
        # array or a plans array; otherwise fall back to the flat serializer
        # so single-row endpoints (board quick-edits, dashboard inline
        # patches) keep working unchanged.
        body = getattr(self.request, "data", None)
        if isinstance(body, dict) and ("subtasks" in body or "plans" in body):
            return TaskWithSubtasksSerializer
        return TaskSerializer

    def get_queryset(self):
        user = cast(User, self.request.user)
        # Per-org role visibility: admin in org X sees every task in X,
        # manager sees their subordinates' tasks in X, employee sees only
        # their own in X. A user admin in one org and employee in another
        # sees merged results with each org's rule applied independently.
        return (
            Task.objects.select_related("client", "category", "org", "responsible", "reporting_manager", "created_by")
            .filter(visibility_q(user, "responsible"))
            .order_by("-created_at")
        )

    def retrieve(self, request, *args, **kwargs):
        """Detail view with optional ``?month=YYYY-MM`` filter.

        When ``month`` is provided and lands inside the goal's engagement
        window, lazy-materializes that month's children before returning so
        the modal sees a complete snapshot. Past, current, and future months
        all materialize on view; the past-month write-protection is enforced
        on the PATCH/DELETE side, not here.
        """
        instance = self.get_object()
        month_param = request.query_params.get("month")

        subtasks_payload: Any = []
        if month_param:
            try:
                month_start = dt.datetime.strptime(month_param, "%Y-%m").date().replace(day=1)
            except ValueError as e:
                raise DrfValidationError({"month": "Expected YYYY-MM."}) from e
            if instance.parent_id is None:
                if instance.engagement_start is None or month_start >= instance.engagement_start:
                    materialize_month(instance, month_start)

            month_end = (month_start + dt.timedelta(days=31)).replace(day=1)
            subs_qs = Task.objects.filter(
                parent=instance,
                target_date__gte=month_start,
                target_date__lt=month_end,
            ).order_by("target_date", "id")
            subtasks_payload = TaskSerializer(subs_qs, many=True).data

        plans_payload: Any = []
        if month_param and instance.parent_id is None:
            plans_payload = TaskSubcategoryPlanSerializer(
                instance.sub_plans.all().select_related("subcategory", "default_owner"),
                many=True,
            ).data

        serializer = self.get_serializer(instance)
        data = dict(serializer.data)
        if month_param:
            data["subtasks"] = subtasks_payload
            data["plans"] = plans_payload
        return Response(data)

    def update(self, request, *args, **kwargs):
        """Standard PATCH/PUT, with optional ``?cascade_owner=true`` to push
        a ``responsible`` change forward to every later child of the same
        plan. Only meaningful on a child Task with both ``parent`` and
        ``target_date`` set.
        """
        instance = self.get_object()
        cascade = request.query_params.get("cascade_owner", "").lower() in (
            "1",
            "true",
            "yes",
        )
        if cascade and instance.parent_id is not None and "responsible" in request.data:
            new_owner_uid = request.data.get("responsible")
            new_owner = User.objects.filter(uid=new_owner_uid).first() if new_owner_uid else None
            # Org-scope check: same as Task 8's owner lookup. A non-member
            # can't be assigned via the cascade endpoint either.
            if new_owner is not None and instance.org_id and instance.org_id not in new_owner.org_ids():
                return Response({"detail": "Owner not found in this org."}, status=404)
            cascaded_uids = cascade_owner_forward(instance, new_owner)
            instance.refresh_from_db()
            # Broadcast UPDATE for the directly-edited row + every cascaded one.
            broadcast("tasks", "UPDATE", TaskSerializer(instance).data)
            cascaded = Task.objects.filter(uid__in=cascaded_uids)
            for c in cascaded:
                broadcast("tasks", "UPDATE", TaskSerializer(c).data)
            return Response(self.get_serializer(instance).data)
        return super().update(request, *args, **kwargs)

    @action(detail=True, methods=["post", "patch", "delete"], url_path=r"plans(?:/(?P<plan_uid>[^/]+))?")
    def plans(self, request, *args, plan_uid=None, **kwargs):
        """Plan add/extend (POST without ``plan_uid``), update (PATCH with
        ``plan_uid``), or cap (DELETE with ``plan_uid``).

        POST body: ``{ "subcategory": "<uid>", "month": "YYYY-MM",
                       "default_owner": "<uid>?" }``
        PATCH body: ``{ "recurrence": "Monthly" }`` and ``?from_month=YYYY-MM``
                    query param required. Past completed children are
                    preserved; future open children re-materialise on the
                    new cadence.
        DELETE: ``?from_month=YYYY-MM`` query param required.
        """
        main = self.get_object()
        if main.parent_id is not None:
            return Response({"detail": "Plans only attach to main goals."}, status=400)

        if request.method == "POST":
            sub_uid = request.data.get("subcategory")
            month = request.data.get("month")
            owner_uid = request.data.get("default_owner")
            if not sub_uid or not month:
                return Response({"detail": "subcategory and month are required."}, status=400)
            try:
                month_start = dt.datetime.strptime(month, "%Y-%m").date().replace(day=1)
            except ValueError:
                return Response({"detail": "month must be YYYY-MM."}, status=400)
            from django.db.models import Q

            sub_cat = (
                Master.objects.filter(uid=sub_uid, type="category").filter(Q(org=main.org) | Q(orgs=main.org)).first()
            )
            if sub_cat is None:
                return Response({"detail": "Sub-category not found."}, status=404)
            owner = None
            if owner_uid:
                owner = User.objects.filter(uid=owner_uid).first()
                if owner is None or main.org_id not in owner.org_ids():
                    return Response({"detail": "Owner not found in this org."}, status=404)
            plan, child, all_created = add_or_extend_plan(main, sub_cat, month_start, owner=owner)
            # Broadcast every newly-materialized row so connected clients
            # (Board, dashboard) update for every affected month, not just
            # the one the user is editing.
            for created_child in all_created:
                broadcast("tasks", "INSERT", TaskSerializer(created_child).data)
            return Response(
                {
                    "plan": TaskSubcategoryPlanSerializer(plan).data,
                    "child": TaskSerializer(child).data if child else None,
                },
                status=201,
            )

        if request.method == "PATCH":
            if not plan_uid:
                return Response({"detail": "plan_uid required to update a plan."}, status=400)
            from_month_str = request.query_params.get("from_month")
            if not from_month_str:
                return Response({"detail": "from_month query param required."}, status=400)
            try:
                from_month = dt.datetime.strptime(from_month_str, "%Y-%m").date().replace(day=1)
            except ValueError:
                return Response({"detail": "from_month must be YYYY-MM."}, status=400)
            existing_plan = TaskSubcategoryPlan.objects.filter(uid=plan_uid, main_task=main).first()
            if existing_plan is None:
                return Response({"detail": "Plan not found for this goal."}, status=404)
            new_recurrence = request.data.get("recurrence")
            if new_recurrence is None:
                return Response({"detail": "recurrence is required."}, status=400)
            # Optional target_day: lets the UI resync the plan's cadence day
            # in one PATCH alongside the recurrence (e.g. switching to/from
            # Weekly where 1-7 weekday ≠ 1-31 day-of-month semantics).
            new_target_day_raw = request.data.get("target_day", None)
            new_target_day: int | None = None
            if new_target_day_raw is not None:
                try:
                    new_target_day = int(new_target_day_raw)
                except (TypeError, ValueError):
                    return Response({"detail": "target_day must be an integer."}, status=400)
                # Range-by-recurrence validation mirrors MasterSerializer.validate
                # so a malformed value is rejected at the API boundary.
                is_weekly = (new_recurrence or "").strip().lower() == "weekly"
                hi = 7 if is_weekly else 31
                if not (1 <= new_target_day <= hi):
                    label = "weekday (1-7)" if is_weekly else "day-of-month (1-31)"
                    return Response({"detail": f"target_day must be a valid {label}."}, status=400)
            result = update_plan_recurrence(existing_plan, new_recurrence, from_month, new_target_day)
            for uid in result.get("deleted_child_uids", []):
                broadcast("tasks", "DELETE", {"uid": uid})
            for created_uid in result.get("created_child_uids", []):
                created = Task.objects.filter(uid=created_uid).first()
                if created is not None:
                    broadcast("tasks", "INSERT", TaskSerializer(created).data)
            return Response(
                {
                    "plan": TaskSubcategoryPlanSerializer(existing_plan).data,
                    **result,
                },
                status=200,
            )

        # DELETE
        if not plan_uid:
            return Response({"detail": "plan_uid required to remove a plan."}, status=400)
        from_month_str = request.query_params.get("from_month")
        if not from_month_str:
            return Response({"detail": "from_month query param required."}, status=400)
        try:
            from_month = dt.datetime.strptime(from_month_str, "%Y-%m").date().replace(day=1)
        except ValueError:
            return Response({"detail": "from_month must be YYYY-MM."}, status=400)
        existing_plan = TaskSubcategoryPlan.objects.filter(uid=plan_uid, main_task=main).first()
        if existing_plan is None:
            return Response({"detail": "Plan not found for this goal."}, status=404)
        result = cap_plan(existing_plan, from_month)
        for uid in result.get("deleted_child_uids", []):
            broadcast("tasks", "DELETE", {"uid": uid})
        return Response(result, status=200)

    def perform_create(self, serializer):
        org, err = resolve_create_org(self.request)
        if err is not None:
            from rest_framework.exceptions import PermissionDenied, ValidationError

            raise (PermissionDenied if err.status_code == 403 else ValidationError)(err.data)

        user = cast(User, self.request.user)
        task = serializer.save(created_by=user, org=org)
        self._broadcast_tree(task, "INSERT")

    def perform_update(self, serializer):
        # Capture the set of sub uids BEFORE the save so we can detect deletions.
        existing_sub_uids: set[str] = set()
        if serializer.instance and serializer.instance.parent_id is None:
            existing_sub_uids = set(str(uid) for uid in serializer.instance.subtasks.values_list("uid", flat=True))
        task = serializer.save()
        self._broadcast_tree(task, "UPDATE")
        # Broadcast deletions for subs that were removed during the upsert.
        if existing_sub_uids:
            current = (
                set(str(uid) for uid in task.subtasks.values_list("uid", flat=True))
                if task.parent_id is None
                else set()
            )
            for removed_uid in existing_sub_uids - current:
                broadcast("tasks", "DELETE", {"uid": removed_uid})

    def _broadcast_tree(self, task: "Task", event: str) -> None:
        # Always broadcast the row that the serializer returned. If it's a
        # Main with subs (nested path), broadcast each sub individually so
        # connected clients see the full tree without a reload.
        broadcast("tasks", event, TaskSerializer(task).data)
        if task.parent_id is None:
            for sub in task.subtasks.all():
                broadcast("tasks", event, TaskSerializer(sub).data)

    def perform_destroy(self, instance):
        broadcast("tasks", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()

    @action(detail=False, methods=["delete"], url_path="delete_all", permission_classes=[IsAdmin])
    def delete_all(self, request):
        """Bulk-delete tasks in one org. Caller must be admin of that org.

        The target org is chosen by ``?org=<id|uid>`` query param or (if the
        caller is admin of exactly one org) defaults to that org. An admin in
        one org cannot drop tasks from another org just by passing that
        org's id — ``resolve_admin_org`` enforces the per-org role check.
        """
        org, err = resolve_admin_org(request)
        if err is not None:
            return err
        assert org is not None
        deleted, _ = Task.objects.filter(org=org).delete()
        return Response({"deleted": deleted, "org": str(org.uid)})

    @action(detail=False, methods=["post"], url_path="bulk_create", permission_classes=[IsAdmin])
    def bulk_create(self, request):
        rows = request.data if isinstance(request.data, list) else request.data.get("rows", [])
        if not isinstance(rows, list):
            return Response({"error": "Expected a list of task objects"}, status=400)

        # Bulk-admin actions must run against an org the caller is admin of
        # — not merely any org they belong to.
        org, err = resolve_admin_org(request)
        if err is not None:
            return err

        assert org is not None
        created, errors = [], []
        for row in rows:
            s = TaskSerializer(data=row, context={"request": request})
            if s.is_valid():
                s.save(created_by=request.user, org=org)
                created.append(s.data)
            else:
                errors.append(s.errors)
        if errors:
            return Response({"created": created, "errors": errors}, status=207)
        return Response(created, status=201)


class TaskLogViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = TaskLogSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardPagination
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        # Only show logs for tasks in orgs the caller can see.
        user = cast(User, self.request.user)
        qs = (
            TaskLog.objects.select_related("task", "changed_by")
            .filter(task__org_id__in=user.org_ids())
            .order_by("-changed_at")
        )
        task_uid = self.request.query_params.get("task_uid")
        task_id = self.request.query_params.get("task_id")
        if task_uid:
            qs = qs.filter(task__uid=task_uid)
        elif task_id:
            qs = qs.filter(task_id=task_id)
        return qs

    def perform_create(self, serializer):
        serializer.save(changed_by=self.request.user)
