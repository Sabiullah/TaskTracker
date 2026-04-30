from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import Org, OrgMembership, User


@admin.register(Org)
class OrgAdmin(admin.ModelAdmin):
    list_display = ["name", "uid", "created_at"]
    search_fields = ["name"]
    readonly_fields = ["uid", "created_at", "updated_at"]


class OrgMembershipInline(admin.TabularInline):
    """Edit a user's memberships (role + per-org access) inline on their page."""

    model = OrgMembership
    fk_name = "user"
    extra = 0
    autocomplete_fields = ["org"]
    fields = [
        "org",
        "role",
        "is_default",
        "invoice_access",
        "notice_access",
        "masters_access",
        "attendance_access",
        "employee_access",
        "leads_access",
        "conveyance_access",
    ]


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    ordering = ["email"]
    list_display = [
        "email",
        "username",
        "full_name",
        "highest_role_display",
        "org_list",
        "is_active",
        "is_staff",
    ]
    # Filter by the role on ANY of the user's memberships.
    list_filter = ["memberships__role", "is_active", "is_staff"]
    search_fields = ["email", "username", "full_name"]
    readonly_fields = ["uid"]
    inlines = [OrgMembershipInline]

    fieldsets = [
        (None, {"fields": ("uid", "email", "username", "password")}),
        ("Profile", {"fields": ("full_name", "avatar_color", "managers")}),
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
                    "password1",
                    "password2",
                ),
            },
        ),
    ]

    # ── list_display callables ──────────────────────────────────────────────
    @admin.display(description="Roles")
    def highest_role_display(self, obj: User) -> str:
        roles = list(obj.memberships.values_list("org__name", "role"))
        if not roles:
            return "—"
        return ", ".join(f"{name}: {role}" for name, role in roles)

    @admin.display(description="Orgs")
    def org_list(self, obj: User) -> str:
        names = list(obj.memberships.values_list("org__name", flat=True))
        return ", ".join(names) if names else "—"


@admin.register(OrgMembership)
class OrgMembershipAdmin(admin.ModelAdmin):
    list_display = ["user", "org", "role", "is_default", "updated_at"]
    list_filter = ["role", "org", "is_default"]
    search_fields = ["user__email", "user__username", "user__full_name", "org__name"]
    autocomplete_fields = ["user", "org"]
