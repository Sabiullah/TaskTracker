from django.contrib import admin

from .models import Attendance


@admin.register(Attendance)
class AttendanceAdmin(admin.ModelAdmin):
    list_display = ["uid", "user", "date", "status", "work_location", "login_time", "logout_time"]
    list_filter = ["status", "work_location"]
    search_fields = ["user__full_name", "user__username", "remarks"]
    readonly_fields = ["uid", "created_at", "updated_at"]
    autocomplete_fields = ["user", "created_by"]
    date_hierarchy = "date"
