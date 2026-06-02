from typing import cast

from django.db.models import Q
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.org_utils import resolve_create_org
from core.permissions import IsAdminOrEmployeeAccess
from core.realtime import broadcast
from users.models import User

from .models import Employee, EmployeeSalary
from .serializers import EmployeeSalarySerializer, EmployeeSerializer


def _raise_from_response(err):
    exc_cls = PermissionDenied if err.status_code == 403 else ValidationError
    raise exc_cls(err.data)


def _employee_visibility_q(user, employee_path: str) -> Q:
    """Per-org role-aware visibility for Employee rows.

    Employee carries PII + comp data, so the org-only ``scoped`` filter is
    too permissive: a plain employee in an org would see every colleague's
    Aadhar/PAN/bank details. Narrow it per role:

      - admin in an org          → every employee row in that org
      - employee_access in an org → every employee row in that org (admin-
        equivalent inside the Employee Management module)
      - manager in an org         → own row + direct reports (``User.subordinates``)
      - employee in an org        → own row only

    ``employee_path`` is the dotted lookup that lands on the Employee table —
    pass ``""`` from ``EmployeeViewSet`` (filtering Employee directly) and
    ``"employee__"`` from ``EmployeeSalaryViewSet`` (filtering through the FK).
    """
    org_path = f"{employee_path}org_id"
    user_path = f"{employee_path}user_id"

    admin_org_ids = list(user.memberships.filter(role="admin").values_list("org_id", flat=True))
    access_org_ids = list(user.memberships.filter(employee_access=True).values_list("org_id", flat=True))
    manager_org_ids = list(user.memberships.filter(role="manager").values_list("org_id", flat=True))
    employee_org_ids = list(user.memberships.filter(role="employee").values_list("org_id", flat=True))

    # Admin and employee_access both see every row in their org.
    full_org_ids = list(set(admin_org_ids) | set(access_org_ids))

    visible_user_ids: set[int] = {user.id}
    if manager_org_ids:
        visible_user_ids.update(user.subordinates.values_list("id", flat=True))

    q = Q(pk__in=[])
    if full_org_ids:
        q |= Q(**{f"{org_path}__in": full_org_ids})
    if manager_org_ids:
        q |= Q(
            **{
                f"{org_path}__in": manager_org_ids,
                f"{user_path}__in": list(visible_user_ids),
            }
        )
    if employee_org_ids:
        q |= Q(
            **{
                f"{org_path}__in": employee_org_ids,
                user_path: user.id,
            }
        )
    return q


class EmployeeViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = EmployeeSerializer
    permission_classes = [IsAdminOrEmployeeAccess]

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = (
            Employee.objects.select_related("user", "created_by")
            .prefetch_related("salary_records")
            .filter(_employee_visibility_q(user, ""))
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
    permission_classes = [IsAdminOrEmployeeAccess]

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = EmployeeSalary.objects.select_related("employee", "created_by").filter(
            _employee_visibility_q(user, "employee__")
        )
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
