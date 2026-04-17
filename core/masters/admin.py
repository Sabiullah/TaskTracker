from django.contrib import admin

from .models import Master


@admin.register(Master)
class MasterAdmin(admin.ModelAdmin):
    list_display = ["name", "type", "org", "is_active", "sort_order", "color", "created_at"]
    list_filter = ["type", "is_active", "org"]
    search_fields = ["name"]
    readonly_fields = ["uid", "created_at", "updated_at"]
    autocomplete_fields = ["org", "created_by"]
    ordering = ["type", "sort_order", "name"]
