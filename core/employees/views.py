from typing import cast

from rest_framework import permissions
from rest_framework.decorators import action
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

    @action(
        detail=True,
        methods=["get"],
        url_path="address_proof",
        url_name="address-proof",
    )
    def address_proof(self, request, uid=None):
        """Stream the employee's address proof to any authenticated user
        who can see the employee (``scoped`` queryset handles org checks).

        Rendered ``inline`` so the browser opens PDFs / images in a new
        tab rather than forcing a download.
        """
        import mimetypes

        from django.http import FileResponse, Http404

        employee: Employee = self.get_object()
        if not employee.address_proof:
            raise Http404("No address proof attached")
        filename = (employee.address_proof.name or "").split("/")[-1]
        content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        response = FileResponse(
            employee.address_proof.open("rb"),
            filename=filename,
            content_type=content_type,
        )
        response["Content-Disposition"] = f'inline; filename="{filename}"'
        return response


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
