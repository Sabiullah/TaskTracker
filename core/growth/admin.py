from django.contrib import admin

from .models import GrowthPlan


@admin.register(GrowthPlan)
class GrowthPlanAdmin(admin.ModelAdmin):
    list_display = ["uid", "activity_short", "status", "priority", "assigned_to", "target_month"]
    list_filter = ["status", "priority"]
    search_fields = ["activity", "remarks"]
    readonly_fields = ["uid", "created_at", "updated_at"]
    autocomplete_fields = ["assigned_to", "created_by"]
    date_hierarchy = "target_month"

    @admin.display(description="Activity")
    def activity_short(self, obj):
        return obj.activity[:60]
