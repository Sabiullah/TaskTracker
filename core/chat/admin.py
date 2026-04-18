from django.contrib import admin
from django.urls import reverse
from django.utils.html import format_html

from .models import ChatMember, ChatMessage, ChatRoom


def _chat_file_link(msg):
    """Readonly admin cell: link to the short auth-gated download URL
    instead of the raw ``/media/<path>`` (which has no server route and
    otherwise falls through to the React SPA).
    """
    if not msg.file:
        return "—"
    url = reverse("chatmessage-download", kwargs={"uid": str(msg.uid)})
    filename = msg.file.name.rsplit("/", 1)[-1]
    return format_html('<a href="{}" target="_blank">📎 {}</a>', url, filename)


class ChatMemberInline(admin.TabularInline):
    model = ChatMember
    extra = 0
    readonly_fields = ["joined_at"]


class ChatMessageInline(admin.TabularInline):
    model = ChatMessage
    extra = 0
    readonly_fields = ["uid", "sender", "file_link", "created_at", "updated_at"]
    fields = [
        "uid",
        "sender",
        "message",
        "file",
        "file_link",
        "file_type",
        "file_size",
        "reply_to",
        "created_at",
    ]

    @admin.display(description="Download")
    def file_link(self, obj):
        return _chat_file_link(obj)


@admin.register(ChatRoom)
class ChatRoomAdmin(admin.ModelAdmin):
    list_display = ["uid", "name", "type", "created_by", "created_at"]
    list_filter = ["type"]
    search_fields = ["name"]
    readonly_fields = ["uid", "created_at", "updated_at"]
    inlines = [ChatMemberInline, ChatMessageInline]


@admin.register(ChatMessage)
class ChatMessageAdmin(admin.ModelAdmin):
    list_display = ["uid", "room", "sender", "file_type", "created_at"]
    list_filter = ["file_type"]
    search_fields = ["message"]
    readonly_fields = ["uid", "file_link", "created_at", "updated_at"]
    date_hierarchy = "created_at"

    @admin.display(description="Download")
    def file_link(self, obj):
        return _chat_file_link(obj)
