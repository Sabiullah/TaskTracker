from typing import cast

from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet, ReadOnlyModelViewSet

from core.base import UidLookupMixin
from core.pagination import LargePagination
from core.realtime import broadcast
from users.models import User

from .models import ChatMember, ChatMessage, ChatRoom
from .serializers import ChatMemberSerializer, ChatMessageSerializer, ChatRoomSerializer


def _parse_since(raw):
    if not raw:
        return None
    dt = parse_datetime(raw)
    return dt


class ChatRoomViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = ChatRoomSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = cast(User, self.request.user)
        return ChatRoom.objects.filter(members__user=user).distinct().select_related("created_by", "org")

    def perform_create(self, serializer):
        room = serializer.save(created_by=self.request.user)
        ChatMember.objects.get_or_create(room=room, user=self.request.user)

    @action(detail=True, methods=["post"], url_path="add_member")
    def add_member(self, request, pk=None):
        room = self.get_object()
        is_admin = getattr(request.user, "role", None) == "admin"
        if room.created_by != request.user and not is_admin:
            return Response({"error": "Only the room creator or an admin can add members"}, status=403)
        user_uid = request.data.get("user_uid")
        try:
            user = User.objects.get(uid=user_uid)
        except User.DoesNotExist:
            return Response({"error": "User not found"}, status=404)
        member, created = ChatMember.objects.get_or_create(room=room, user=user)
        return Response(ChatMemberSerializer(member).data, status=201 if created else 200)

    @action(detail=True, methods=["post"], url_path="mark_read")
    def mark_read(self, request, pk=None):
        room = self.get_object()
        ChatMember.objects.filter(room=room, user=request.user).update(last_read_at=timezone.now())
        return Response({"ok": True})

    @action(detail=True, methods=["get"], url_path="messages")
    def messages(self, request, pk=None):
        room = self.get_object()
        qs = room.messages.select_related("sender", "reply_to").order_by("-created_at")
        since = _parse_since(request.query_params.get("since"))
        if request.query_params.get("since") and since is None:
            return Response({"error": "invalid since timestamp"}, status=400)
        if since:
            qs = qs.filter(created_at__gt=since)

        paginator = LargePagination()
        page = paginator.paginate_queryset(qs, request, view=self)
        serializer = ChatMessageSerializer(page, many=True, context={"request": request})
        return paginator.get_paginated_response(serializer.data)

    @action(detail=True, methods=["get"], url_path="members")
    def members(self, request, pk=None):
        room = self.get_object()
        return Response(ChatMemberSerializer(room.members.select_related("user").all(), many=True).data)


class ChatMemberViewSet(UidLookupMixin, ReadOnlyModelViewSet):
    serializer_class = ChatMemberSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = ChatMember.objects.filter(room__members__user=user).distinct().select_related("user", "room")
        room_uid = self.request.query_params.get("room_uid")
        if room_uid:
            qs = qs.filter(room__uid=room_uid)
        return qs


class ChatMessageViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = ChatMessageSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = LargePagination

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = (
            ChatMessage.objects.filter(room__members__user=user, is_deleted=False)
            .distinct()
            .select_related("sender", "reply_to")
            .order_by("-created_at")
        )
        room_uid = self.request.query_params.get("room_uid")
        since = _parse_since(self.request.query_params.get("since"))
        if room_uid:
            qs = qs.filter(room__uid=room_uid)
        if since:
            qs = qs.filter(created_at__gt=since)
        return qs

    def perform_create(self, serializer):
        msg = serializer.save(sender=self.request.user)
        broadcast("chat-messages", "INSERT", ChatMessageSerializer(msg, context={"request": self.request}).data)

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "request": self.request}

    def perform_destroy(self, instance):
        instance.is_deleted = True
        instance.message = ""
        instance.file = None
        instance.save(update_fields=["is_deleted", "message", "file", "updated_at"])
        broadcast("chat-messages", "UPDATE", ChatMessageSerializer(instance, context={"request": self.request}).data)

    @action(detail=True, methods=["get"], url_path="download")
    def download(self, request, pk=None):
        import mimetypes

        from django.http import FileResponse, Http404

        msg: ChatMessage = self.get_object()
        if not msg.file:
            raise Http404("No file attached")
        filename = (msg.file.name or "").split("/")[-1]
        content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        return FileResponse(
            msg.file.open("rb"),
            as_attachment=True,
            filename=filename,
            content_type=content_type,
        )
