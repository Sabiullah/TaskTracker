from rest_framework import serializers

from core.employees.models import Employee
from core.masters.models import Master
from core.masters.serializers import MasterMinSerializer
from users.models import Org

from .models import CostingEntry, SeatCostSetting


class EmployeeMinSerializer(serializers.ModelSerializer):
    """Lightweight Employee for nested FK reads — mirrors MasterMinSerializer."""

    class Meta:
        model = Employee
        fields = ["id", "uid", "employee_name"]


class CostingEntrySerializer(serializers.ModelSerializer):
    org = serializers.SlugRelatedField(slug_field="uid", queryset=Org.objects.all(), required=False)
    client = serializers.SlugRelatedField(slug_field="uid", queryset=Master.objects.filter(type="client"))
    designation = serializers.SlugRelatedField(slug_field="uid", queryset=Master.objects.filter(type="designation"))
    employee = serializers.SlugRelatedField(
        slug_field="uid", queryset=Employee.objects.all(), required=False, allow_null=True
    )
    client_detail = MasterMinSerializer(source="client", read_only=True)
    designation_detail = MasterMinSerializer(source="designation", read_only=True)
    employee_detail = EmployeeMinSerializer(source="employee", read_only=True)
    org_name = serializers.SerializerMethodField()
    created_by_uid = serializers.UUIDField(source="created_by.uid", read_only=True, allow_null=True)

    class Meta:
        model = CostingEntry
        fields = [
            "id",
            "uid",
            "org",
            "org_name",
            "client",
            "client_detail",
            "designation",
            "designation_detail",
            "employee",
            "employee_detail",
            "hr_day",
            "days_working",
            "total",
            "created_by_uid",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "uid", "total", "created_by_uid", "created_at", "updated_at"]

    def get_org_name(self, obj):
        return obj.org.name if obj.org_id else None

    def _employee_in_org(self, employee, org) -> bool:
        if org is None:
            return True
        return employee.org_id == org.id

    def validate_employee(self, value):
        """Employee must belong to the entry's own org — otherwise an admin
        of Org A could attach Org B's employee to an Org A costing row.
        Mirrors ``EmployeeSerializer.validate_designation``: the entry's org
        isn't resolved yet on create (``resolve_create_org`` runs in
        ``CostingEntryViewSet.perform_create`` after validation), so that
        path is re-checked in ``validate()`` below. On update,
        ``self.instance.org`` is already known and is the source of truth.
        """
        if value is None:
            return value
        if self.instance is not None:
            target_org = self.instance.org
            if target_org and not self._employee_in_org(value, target_org):
                raise serializers.ValidationError("Employee must belong to this costing entry's organisation.")
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if self.instance is None:
            from core.org_utils import resolve_create_org

            request = (self.context or {}).get("request")
            if request is not None:
                org, _err = resolve_create_org(request)
                employee = attrs.get("employee")
                if org and employee and not self._employee_in_org(employee, org):
                    raise serializers.ValidationError(
                        {"employee": "Employee must belong to this costing entry's organisation."}
                    )
        return attrs


class SeatCostSettingSerializer(serializers.ModelSerializer):
    org = serializers.SlugRelatedField(slug_field="uid", queryset=Org.objects.all(), required=False)
    org_name = serializers.SerializerMethodField()

    class Meta:
        model = SeatCostSetting
        fields = ["id", "uid", "org", "org_name", "monthly_amount", "created_at", "updated_at"]
        read_only_fields = ["id", "uid", "created_at", "updated_at"]

    def get_org_name(self, obj):
        return obj.org.name if obj.org_id else None
