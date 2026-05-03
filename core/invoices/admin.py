from django.contrib import admin
from django.urls import reverse
from django.utils.html import format_html

from .models import InvoiceCategory, InvoiceEntry, InvoicePlan


def _invoice_file_link(entry):
    """Readonly admin cell: link to the short auth-gated download URL
    instead of the raw ``/media/<path>`` (which has no route in prod and
    falls through to the React SPA).
    """
    if not entry.file:
        return "—"
    url = reverse("invoiceentry-download", kwargs={"uid": str(entry.uid)})
    filename = entry.file.name.rsplit("/", 1)[-1]
    return format_html('<a href="{}" target="_blank">📎 {}</a>', url, filename)


class InvoiceEntryInline(admin.TabularInline):
    model = InvoiceEntry
    extra = 0
    readonly_fields = [
        "uid",
        "file_link",
        "uploaded_by",
        "uploaded_at",
        "approved_by",
        "approved_at",
        "created_at",
        "updated_at",
    ]
    fields = [
        "uid",
        "invoice_month",
        "invoice_date",
        "invoice_number",
        "amount",
        "status",
        "file",
        "file_link",
        "uploaded_by",
        "uploaded_at",
        "approved_by",
        "approved_at",
    ]

    @admin.display(description="Download")
    def file_link(self, obj):
        return _invoice_file_link(obj)


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
    readonly_fields = [
        "uid",
        "file_link",
        "uploaded_by",
        "uploaded_at",
        "approved_by",
        "approved_at",
        "created_at",
        "updated_at",
    ]
    date_hierarchy = "invoice_month"

    @admin.display(description="Download")
    def file_link(self, obj):
        return _invoice_file_link(obj)


@admin.register(InvoiceCategory)
class InvoiceCategoryAdmin(admin.ModelAdmin):
    list_display = ["name", "org", "color", "is_active", "sort_order"]
    list_filter = ["org", "is_active"]
    search_fields = ["name"]
    readonly_fields = ["uid", "created_at", "updated_at"]
