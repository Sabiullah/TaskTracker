from django.contrib import admin

from .models import LeaveRequest


@admin.register(LeaveRequest)
class LeaveRequestAdmin(admin.ModelAdmin):
    list_display = ["uid", "user", "from_date", "to_date", "total_days", "status", "approver", "org"]
    list_filter = ["status", "org"]
    search_fields = ["user__email", "user__full_name", "reason"]
    readonly_fields = ["uid", "created_at", "updated_at"]
    autocomplete_fields = ["user", "approver", "created_by"]
    date_hierarchy = "from_date"
