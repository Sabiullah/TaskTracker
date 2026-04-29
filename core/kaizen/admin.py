from django.contrib import admin

from .models import Kaizen


@admin.register(Kaizen)
class KaizenAdmin(admin.ModelAdmin):
    list_display = ["uid", "raised_by", "client", "area", "status", "entry_date"]
    list_filter = ["status"]
    search_fields = ["area", "description", "takeaway"]
    autocomplete_fields = ["raised_by", "client", "reviewed_by"]
    readonly_fields = ["uid", "created_at", "updated_at"]
    date_hierarchy = "entry_date"
