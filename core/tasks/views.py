from typing import cast

from rest_framework import permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.org_utils import resolve_admin_org, resolve_create_org, visibility_q
from core.pagination import StandardPagination
from core.permissions import IsAdmin
from core.realtime import broadcast
from users.models import User

from .models import Task, TaskLog
from .serializers import TaskLogSerializer, TaskSerializer


class TaskViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = TaskSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardPagination

    def get_queryset(self):
        user = cast(User, self.request.user)
        # Per-org role visibility: admin in org X sees every task in X,
        # manager sees their subordinates' tasks in X, employee sees only
        # their own in X. A user admin in one org and employee in another
        # sees merged results with each org's rule applied independently.
        return (
            Task.objects.select_related(
                "client", "category", "org", "responsible", "reporting_manager", "created_by"
            )
            .filter(visibility_q(user, "responsible"))
            .order_by("-created_at")
        )

    def perform_create(self, serializer):
        org, err = resolve_create_org(self.request)
        if err is not None:
            # DRF's perform_* can't return a Response directly; raise instead.
            from rest_framework.exceptions import PermissionDenied, ValidationError

            raise (PermissionDenied if err.status_code == 403 else ValidationError)(err.data)

        user = cast(User, self.request.user)
        task = serializer.save(created_by=user, org=org)
        broadcast("tasks", "INSERT", TaskSerializer(task).data)

    def perform_update(self, serializer):
        task = serializer.save()
        broadcast("tasks", "UPDATE", TaskSerializer(task).data)

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
