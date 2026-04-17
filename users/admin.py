from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import Org, User


@admin.register(Org)
class OrgAdmin(admin.ModelAdmin):
    list_display = ["name", "uid", "created_at"]
    search_fields = ["name"]
    readonly_fields = ["uid", "created_at", "updated_at"]


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    ordering = ["email"]
    list_display = ["email", "username", "full_name", "role", "is_active", "is_staff"]
    list_filter = ["role", "is_active", "is_staff"]
    search_fields = ["email", "username", "full_name"]
    readonly_fields = ["uid"]

    fieldsets = [
        (None, {"fields": ("uid", "email", "username", "password")}),
        (
            "Profile",
            {
                "fields": (
                    "full_name",
                    "role",
                    "org",
                    "avatar_color",
                    "managers",
                )
            },
        ),
        (
            "Access Control",
            {
                "fields": (
                    "invoice_access",
                    "notice_access",
                    "masters_access",
                    "attendance_access",
                    "employee_access",
                )
            },
        ),
        (
            "Permissions",
            {
                "fields": (
                    "is_active",
                    "is_staff",
                    "is_superuser",
                    "groups",
                    "user_permissions",
                )
            },
        ),
    ]

    add_fieldsets = [
        (
            None,
            {
                "classes": ("wide",),
                "fields": (
                    "email",
                    "username",
                    "full_name",
                    "role",
                    "password1",
                    "password2",
                ),
            },
        ),
    ]
