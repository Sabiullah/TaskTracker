from django.contrib import admin

from .models import Notice


@admin.register(Notice)
class NoticeAdmin(admin.ModelAdmin):
    list_display = ["serial_no", "client", "fy", "status", "received_date", "next_target_date", "org"]
    list_filter = ["status", "org"]
    search_fields = ["dispute_nature", "remarks"]
    readonly_fields = ["uid", "serial_no", "created_at", "updated_at"]
    autocomplete_fields = ["client", "org", "created_by"]
    date_hierarchy = "received_date"
