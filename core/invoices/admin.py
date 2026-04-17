from django.contrib import admin

from .models import InvoiceEntry, InvoicePlan


class InvoiceEntryInline(admin.TabularInline):
    model = InvoiceEntry
    extra = 0
    readonly_fields = ["uid", "uploaded_by", "uploaded_at", "approved_by", "approved_at", "created_at", "updated_at"]
    fields = [
        "uid",
        "invoice_month",
        "invoice_date",
        "invoice_number",
        "amount",
        "status",
        "file",
        "uploaded_by",
        "uploaded_at",
        "approved_by",
        "approved_at",
    ]


@admin.register(InvoicePlan)
class InvoicePlanAdmin(admin.ModelAdmin):
    list_display = ["uid", "client", "periodicity", "start_month", "end_month", "invoice_day", "base_amount"]
    list_filter = ["periodicity"]
    search_fields = ["job_description", "client__name"]
    readonly_fields = ["uid", "created_at", "updated_at"]
    autocomplete_fields = ["client", "created_by"]
    inlines = [InvoiceEntryInline]


@admin.register(InvoiceEntry)
class InvoiceEntryAdmin(admin.ModelAdmin):
    list_display = ["uid", "plan", "invoice_month", "invoice_number", "amount", "status"]
    list_filter = ["status"]
    search_fields = ["invoice_number", "notes"]
    readonly_fields = ["uid", "uploaded_by", "uploaded_at", "approved_by", "approved_at", "created_at", "updated_at"]
    date_hierarchy = "invoice_month"
