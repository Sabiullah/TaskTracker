from django.contrib import admin

from .models import Employee, EmployeeSalary


class EmployeeSalaryInline(admin.StackedInline):
    model = EmployeeSalary
    extra = 0
    readonly_fields = ["created_at", "updated_at"]


@admin.register(Employee)
class EmployeeAdmin(admin.ModelAdmin):
    list_display = ["uid", "employee_name", "status", "gender", "phone", "date_of_joining"]
    list_filter = ["status", "gender", "marital_status"]
    search_fields = ["employee_name", "email", "phone", "pan_number"]
    readonly_fields = ["uid", "created_at", "updated_at"]
    autocomplete_fields = ["user", "created_by"]
    fieldsets = [
        ("Basic Info", {"fields": ("uid", "user", "employee_name", "status", "date_of_joining", "date_of_birth")}),
        ("Personal", {"fields": ("gender", "blood_group", "marital_status", "father_name")}),
        ("Contact", {"fields": ("phone", "alt_phone", "email", "permanent_address", "current_address")}),
        (
            "Sensitive / Financial",
            {
                "classes": ("collapse",),
                "fields": ("aadhar_number", "pan_number", "bank_name", "bank_account", "ifsc_code"),
            },
        ),
        (
            "Emergency Contact",
            {"fields": ("emergency_contact_name", "emergency_contact_phone", "emergency_contact_relation")},
        ),
        ("Reference", {"fields": ("reference_name", "reference_contact", "reference_relation")}),
        ("Meta", {"fields": ("created_by", "created_at", "updated_at")}),
    ]
    inlines = [EmployeeSalaryInline]


@admin.register(EmployeeSalary)
class EmployeeSalaryAdmin(admin.ModelAdmin):
    list_display = ["employee", "designation", "department", "fixed_salary", "effective_from", "effective_to"]
    list_filter = ["department"]
    search_fields = ["employee__employee_name", "designation"]
    readonly_fields = ["created_at", "updated_at"]
    date_hierarchy = "effective_from"
