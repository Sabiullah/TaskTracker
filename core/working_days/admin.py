from django.contrib import admin

from .models import WorkingDayOverride


@admin.register(WorkingDayOverride)
class WorkingDayOverrideAdmin(admin.ModelAdmin):
    list_display = ["uid", "date", "org", "is_working", "note", "created_by"]
    list_filter = ["org", "is_working"]
    search_fields = ["note"]
    readonly_fields = ["uid", "created_at", "updated_at"]
    date_hierarchy = "date"
