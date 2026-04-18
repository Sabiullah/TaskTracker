from rest_framework import serializers

from core.filestore.signed_url import file_url
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

    class Meta:
        model = Employee
        fields = [
            "id",
            "uid",
            "user_detail",
            "employee_name",
            "status",
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

    def get_address_proof_url(self, obj):
        return file_url(obj.address_proof, request=self.context.get("request"))
