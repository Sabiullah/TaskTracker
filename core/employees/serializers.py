from django.urls import reverse
from rest_framework import serializers

from core.masters.models import Master
from core.masters.serializers import MasterMinSerializer
from core.serializers import UserMinSerializer

from .models import Employee, EmployeeSalary


class EmployeeSalarySerializer(serializers.ModelSerializer):
    # ``uid`` exposes the salary row's own UUID (used as the list's React
    # key / edit-URL target). ``employee`` exposes the parent employee's
    # UUID so the frontend can join salary rows back to the employee row
    # for Name + DOJ columns — without this the Salary sub-tab renders
    # blank names. Both sides point at ``uid`` rather than PK to stay
    # consistent with the rest of the API.
    employee = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Employee.objects.all(),
    )

    class Meta:
        model = EmployeeSalary
        fields = [
            "id",
            "uid",
            "employee",
            "designation",
            "department",
            "fixed_salary",
            "basic_salary",
            "hra",
            "da",
            "other_allowances",
            "pf_number",
            "esi_number",
            "uan_number",
            "effective_from",
            "effective_to",
            "remarks",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "uid", "created_at", "updated_at"]


class EmployeeSerializer(serializers.ModelSerializer):
    salary_records = EmployeeSalarySerializer(many=True, read_only=True)
    user_detail = UserMinSerializer(source="user", read_only=True)
    address_proof_url = serializers.SerializerMethodField()
    designation = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Master.objects.filter(type="designation"),
        required=False,
        allow_null=True,
    )
    designation_detail = MasterMinSerializer(source="designation", read_only=True)

    class Meta:
        model = Employee
        fields = [
            "id",
            "uid",
            "user_detail",
            "employee_name",
            "status",
            "designation",
            "designation_detail",
            "date_of_joining",
            "date_of_birth",
            "gender",
            "blood_group",
            "marital_status",
            "father_name",
            "phone",
            "alt_phone",
            "email",
            "permanent_address",
            "current_address",
            "aadhar_number",
            "pan_number",
            "bank_name",
            "bank_account",
            "ifsc_code",
            "address_proof",
            "address_proof_url",
            "emergency_contact_name",
            "emergency_contact_phone",
            "emergency_contact_relation",
            "reference_name",
            "reference_contact",
            "reference_relation",
            "salary_records",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "uid",
            "user_detail",
            "address_proof_url",
            "salary_records",
            "created_at",
            "updated_at",
        ]
        extra_kwargs = {"address_proof": {"write_only": True, "required": False}}

    def _designation_in_org(self, designation, org) -> bool:
        """Match Master's org scoping in ``MasterViewSet.get_queryset``:
        a row belongs to an org via the legacy ``org`` FK OR the ``orgs``
        M2M — check both so a designation created either way is honoured.
        """
        if org is None:
            return True
        return designation.org_id == org.id or designation.orgs.filter(id=org.id).exists()

    def validate_designation(self, value):
        """Designation must belong to the employee's own org — otherwise an
        admin of Org A could assign Org B's designation Master row to an
        Org A employee, and ``designation_detail`` would echo Org B's name.

        Mirrors ``ClientVisitSerializer.validate_assigned_manager``: the
        employee's org isn't resolved yet on create (``resolve_create_org``
        runs in ``EmployeeViewSet.perform_create`` after validation), so
        that path is re-checked in ``validate()`` below. On update,
        ``self.instance.org`` is already known and is the source of truth.
        """
        if value is None:
            return value
        if self.instance is not None:
            target_org = self.instance.org
            if target_org and not self._designation_in_org(value, target_org):
                raise serializers.ValidationError("Designation must belong to this employee's organisation.")
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if self.instance is None:
            from core.org_utils import resolve_create_org

            request = (self.context or {}).get("request")
            if request is not None:
                org, _err = resolve_create_org(request)
                designation = attrs.get("designation")
                if org and designation and not self._designation_in_org(designation, org):
                    raise serializers.ValidationError(
                        {"designation": "Designation must belong to this employee's organisation."}
                    )
        return attrs

    def get_address_proof_url(self, obj):
        # Short auth-gated URL — ``/api/employees/<uid>/address_proof/``.
        # No JWT / token in the URL; access is gated by the caller being
        # authenticated and sharing an org with this employee.
        if not obj.address_proof:
            return None
        path = reverse("employee-address-proof", kwargs={"uid": str(obj.uid)})
        request = self.context.get("request")
        return request.build_absolute_uri(path) if request else path
