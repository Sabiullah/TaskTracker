from django.contrib import admin

from .models import WorkLog, WorkPlan


@admin.register(WorkLog)
class WorkLogAdmin(admin.ModelAdmin):
    list_display = ["uid", "user", "date", "client", "priority", "hours_worked"]
    list_filter = ["priority", "date"]
    search_fields = ["task_description", "user__full_name", "user__username"]
    readonly_fields = ["uid", "created_at", "updated_at"]
    autocomplete_fields = ["user", "client", "org"]
    date_hierarchy = "date"


@admin.register(WorkPlan)
class WorkPlanAdmin(admin.ModelAdmin):
    list_display = ["uid", "assigned_to", "date", "client", "planned_hours"]
    list_filter = ["date"]
    search_fields = ["task_description", "assigned_to__full_name"]
    readonly_fields = ["uid", "created_at", "updated_at"]
    autocomplete_fields = ["assigned_to", "client", "created_by"]
    date_hierarchy = "date"
