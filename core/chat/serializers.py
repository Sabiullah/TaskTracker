from rest_framework import serializers

from core.filestore.signed_url import file_url
from core.filestore.validators import ALLOWED_CHAT_TYPES, safe_filename, validate_upload
from core.serializers import UserMinSerializer

from .models import ChatMember, ChatMessage, ChatRoom


class ChatMemberSerializer(serializers.ModelSerializer):
    user_detail = UserMinSerializer(source="user", read_only=True)

    class Meta:
        model = ChatMember
        fields = ["id", "user_detail", "joined_at", "last_read_at"]
        read_only_fields = fields


class ChatMessageSerializer(serializers.ModelSerializer):
    sender_detail = UserMinSerializer(source="sender", read_only=True)
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = ChatMessage
        fields = [
            "id",
            "uid",
            "room",
            "sender_detail",
            "message",
            "reply_to",
            "file",
            "file_url",
            "file_type",
            "file_size",
            "is_deleted",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "uid", "sender_detail", "file_url", "is_deleted", "created_at", "updated_at"]
        extra_kwargs = {"file": {"write_only": True}}

    def get_file_url(self, obj):
        return file_url(obj.file, request=self.context.get("request"))

    def validate_file(self, value):
        if value is None:
            return value
        validate_upload(value, allowed_types=ALLOWED_CHAT_TYPES)
        value.name = safe_filename(value.name)
        return value


class ChatRoomSerializer(serializers.ModelSerializer):
    members = ChatMemberSerializer(many=True, read_only=True)
    created_by_detail = UserMinSerializer(source="created_by", read_only=True)

    class Meta:
        model = ChatRoom
        fields = [
            "id",
            "uid",
            "name",
            "type",
            "parent_room",
            "members",
            "created_by_detail",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "uid", "members", "created_by_detail", "created_at", "updated_at"]
