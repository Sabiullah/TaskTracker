from django.contrib import admin

from .models import Lead, LeadHistory, LeadStatus


class LeadHistoryInline(admin.TabularInline):
    model = LeadHistory
    extra = 0
    readonly_fields = ["uid", "created_by", "created_at", "updated_at"]


@admin.register(LeadStatus)
class LeadStatusAdmin(admin.ModelAdmin):
    list_display = ["name", "color", "sort_order"]
    search_fields = ["name"]


@admin.register(Lead)
class LeadAdmin(admin.ModelAdmin):
    list_display = ["uid", "client", "contact_person", "status", "priority", "assigned_to", "next_step_date"]
    list_filter = ["status", "priority"]
    search_fields = ["contact_person", "contact_email", "contact_phone", "remarks"]
    readonly_fields = ["uid", "created_at", "updated_at"]
    autocomplete_fields = ["client", "assigned_to", "created_by"]
    date_hierarchy = "created_at"
    inlines = [LeadHistoryInline]


@admin.register(LeadHistory)
class LeadHistoryAdmin(admin.ModelAdmin):
    list_display = ["uid", "lead", "created_by", "created_at"]
    search_fields = ["note"]
    readonly_fields = ["uid", "created_at", "updated_at"]
