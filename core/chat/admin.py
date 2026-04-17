from django.contrib import admin

from .models import ChatMember, ChatMessage, ChatRoom


class ChatMemberInline(admin.TabularInline):
    model = ChatMember
    extra = 0
    readonly_fields = ["joined_at"]


class ChatMessageInline(admin.TabularInline):
    model = ChatMessage
    extra = 0
    readonly_fields = ["uid", "sender", "created_at", "updated_at"]
    fields = ["uid", "sender", "message", "file", "file_type", "file_size", "reply_to", "created_at"]


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
    readonly_fields = ["uid", "created_at", "updated_at"]
    date_hierarchy = "created_at"
