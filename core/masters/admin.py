from django.contrib import admin

from .models import (
    ClientActionPoint,
    ClientActionPointAttachment,
    ClientMeeting,
    ClientMeetingAttachment,
    ClientRoadmap,
    Master,
)


@admin.register(Master)
class MasterAdmin(admin.ModelAdmin):
    list_display = ["name", "type", "org", "is_active", "sort_order", "color", "created_at"]
    list_filter = ["type", "is_active", "org"]
    search_fields = ["name"]
    readonly_fields = ["uid", "created_at", "updated_at"]
    autocomplete_fields = ["org", "created_by"]
    ordering = ["type", "sort_order", "name"]


@admin.register(ClientRoadmap)
class ClientRoadmapAdmin(admin.ModelAdmin):
    list_display = ["title", "client", "owner", "status", "priority", "target_date", "completion_date"]
    list_filter = ["status", "priority", "org"]
    search_fields = ["title", "description", "category"]
    readonly_fields = ["uid", "created_at", "updated_at"]
    autocomplete_fields = ["org", "client", "owner", "created_by"]


class ClientActionPointInline(admin.TabularInline):
    model = ClientActionPoint
    extra = 0
    autocomplete_fields = ["responsibility", "roadmap_link"]
    fields = ["description", "responsibility", "target_date", "completion_date", "status", "priority"]


class ClientMeetingAttachmentInline(admin.TabularInline):
    model = ClientMeetingAttachment
    extra = 0
    readonly_fields = ["uploaded_at", "size_bytes"]


@admin.register(ClientMeeting)
class ClientMeetingAdmin(admin.ModelAdmin):
    list_display = ["client", "meeting_date", "meeting_type", "mode", "conducted_by"]
    list_filter = ["meeting_type", "mode", "org"]
    search_fields = ["agenda", "minutes", "venue"]
    readonly_fields = ["uid", "created_at", "updated_at"]
    autocomplete_fields = ["org", "client", "conducted_by", "created_by"]
    filter_horizontal = ["our_attendees"]
    inlines = [ClientActionPointInline, ClientMeetingAttachmentInline]


@admin.register(ClientActionPoint)
class ClientActionPointAdmin(admin.ModelAdmin):
    list_display = ["description", "meeting", "responsibility", "status", "priority", "target_date", "completion_date"]
    list_filter = ["status", "priority"]
    search_fields = ["description", "remarks"]
    autocomplete_fields = ["meeting", "responsibility", "roadmap_link"]


@admin.register(ClientMeetingAttachment)
class ClientMeetingAttachmentAdmin(admin.ModelAdmin):
    list_display = ["filename", "meeting", "uploaded_by", "size_bytes", "uploaded_at"]
    readonly_fields = ["uid", "uploaded_at", "size_bytes"]
    autocomplete_fields = ["meeting", "uploaded_by"]


@admin.register(ClientActionPointAttachment)
class ClientActionPointAttachmentAdmin(admin.ModelAdmin):
    list_display = ["filename", "action_point", "uploaded_by", "size_bytes", "uploaded_at"]
    readonly_fields = ["uid", "uploaded_at", "size_bytes"]
    autocomplete_fields = ["action_point", "uploaded_by"]
