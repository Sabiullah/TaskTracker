from django.contrib import admin
from django.urls import reverse
from django.utils.html import format_html

from .models import ConveyanceAttachment, ConveyanceEntry


class ConveyanceAttachmentInline(admin.TabularInline):
    model = ConveyanceAttachment
    extra = 0
    readonly_fields = ["uid", "file_link", "uploaded_by", "created_at", "updated_at"]
    fields = ["uid", "file", "file_link", "label", "uploaded_by", "created_at"]

    @admin.display(description="Download")
    def file_link(self, obj):
        if not obj.file:
            return "—"
        url = reverse("conveyanceattachment-download", kwargs={"uid": str(obj.uid)})
        filename = obj.file.name.rsplit("/", 1)[-1]
        return format_html('<a href="{}" target="_blank">📎 {}</a>', url, filename)


@admin.register(ConveyanceEntry)
class ConveyanceEntryAdmin(admin.ModelAdmin):
    list_display = ["uid", "employee", "date", "client", "amount", "claimable", "status"]
    list_filter = ["status", "claimable"]
    search_fields = ["reason", "employee__username", "client__name"]
    readonly_fields = [
        "uid",
        "reviewed_by",
        "reviewed_at",
        "created_by",
        "created_at",
        "updated_at",
    ]
    autocomplete_fields = ["employee", "client", "org"]
    date_hierarchy = "date"
    inlines = [ConveyanceAttachmentInline]


@admin.register(ConveyanceAttachment)
class ConveyanceAttachmentAdmin(admin.ModelAdmin):
    list_display = ["uid", "entry", "label", "uploaded_by", "created_at"]
    search_fields = ["label", "entry__reason"]
    readonly_fields = ["uid", "uploaded_by", "created_at", "updated_at"]
