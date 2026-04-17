from rest_framework import permissions
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.realtime import broadcast

from .models import Employee, EmployeeSalary
from .serializers import EmployeeSalarySerializer, EmployeeSerializer


class EmployeeViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = EmployeeSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user_org = getattr(self.request.user, "org", None)
        qs = (
            Employee.objects.select_related("user", "created_by")
            .prefetch_related("salary_records")
            .filter(org=user_org)
        )
        status = self.request.query_params.get("status")
        if status:
            qs = qs.filter(status=status)
        return qs

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "request": self.request}

    def perform_create(self, serializer):
        user = self.request.user
        obj = serializer.save(created_by=user, org=getattr(user, "org", None))
        broadcast("employees", "INSERT", EmployeeSerializer(obj, context={"request": self.request}).data)

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast("employees", "UPDATE", EmployeeSerializer(obj, context={"request": self.request}).data)

    def perform_destroy(self, instance):
        broadcast("employees", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()


class EmployeeSalaryViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = EmployeeSalarySerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user_org = getattr(self.request.user, "org", None)
        qs = EmployeeSalary.objects.select_related("employee", "created_by").filter(employee__org=user_org)
        employee_uid = self.request.query_params.get("employee_uid")
        employee_id = self.request.query_params.get("employee_id")
        if employee_uid:
            qs = qs.filter(employee__uid=employee_uid)
        elif employee_id:
            qs = qs.filter(employee_id=employee_id)
        return qs

    def perform_create(self, serializer):
        obj = serializer.save(created_by=self.request.user)
        broadcast("employee-salary", "INSERT", EmployeeSalarySerializer(obj).data)

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast("employee-salary", "UPDATE", EmployeeSalarySerializer(obj).data)

    def perform_destroy(self, instance):
        broadcast("employee-salary", "DELETE", {"id": instance.pk})
        instance.delete()
