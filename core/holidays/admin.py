from django.contrib import admin

from .models import Holiday


@admin.register(Holiday)
class HolidayAdmin(admin.ModelAdmin):
    list_display = ["uid", "name", "date", "day", "type"]
    list_filter = ["type"]
    search_fields = ["name"]
    readonly_fields = ["uid", "created_at", "updated_at"]
    date_hierarchy = "date"
