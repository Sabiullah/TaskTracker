from typing import cast

from rest_framework import permissions
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.org_utils import resolve_create_org, scoped
from core.realtime import broadcast
from users.models import User

from .models import Employee, EmployeeSalary
from .serializers import EmployeeSalarySerializer, EmployeeSerializer


def _raise_from_response(err):
    exc_cls = PermissionDenied if err.status_code == 403 else ValidationError
    raise exc_cls(err.data)


class EmployeeViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = EmployeeSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = scoped(
            Employee.objects.select_related("user", "created_by").prefetch_related("salary_records"),
            user,
        )
        status = self.request.query_params.get("status")
        if status:
            qs = qs.filter(status=status)
        return qs

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "request": self.request}

    def perform_create(self, serializer):
        org, err = resolve_create_org(self.request)
        if err is not None:
            _raise_from_response(err)
        obj = serializer.save(created_by=self.request.user, org=org)
        broadcast(
            "employees",
            "INSERT",
            EmployeeSerializer(obj, context={"request": self.request}).data,
        )

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast(
            "employees",
            "UPDATE",
            EmployeeSerializer(obj, context={"request": self.request}).data,
        )

    def perform_destroy(self, instance):
        broadcast("employees", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()


class EmployeeSalaryViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = EmployeeSalarySerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = EmployeeSalary.objects.select_related("employee", "created_by").filter(employee__org_id__in=user.org_ids())
        employee_uid = self.request.query_params.get("employee_uid")
        employee_id = self.request.query_params.get("employee_id")
        if employee_uid:
            qs = qs.filter(employee__uid=employee_uid)
        elif employee_id:
            qs = qs.filter(employee_id=employee_id)
        return qs

    def perform_create(self, serializer):
        # EmployeeSalary inherits its org from the Employee FK — no explicit
        # org needed here, but queryset scoping takes care of visibility.
        obj = serializer.save(created_by=self.request.user)
        broadcast("employee-salary", "INSERT", EmployeeSalarySerializer(obj).data)

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast("employee-salary", "UPDATE", EmployeeSalarySerializer(obj).data)

    def perform_destroy(self, instance):
        broadcast("employee-salary", "DELETE", {"id": instance.pk})
        instance.delete()
