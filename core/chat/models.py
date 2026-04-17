import uuid

from django.conf import settings
from django.db import models

from core.base import TimeStampedModel
from core.filestore.validators import chat_upload_to


class ChatRoom(TimeStampedModel):
    TYPE_CHOICES = [("direct", "Direct"), ("group", "Group")]
    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    org = models.ForeignKey(
        "users.Org",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="chat_rooms",
    )
    name = models.CharField(max_length=255, blank=True, default="")
    type = models.CharField(max_length=10, choices=TYPE_CHOICES, default="direct", db_index=True)
    parent_room = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="subrooms",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_rooms",
    )

    class Meta:
        verbose_name = "chat room"
        verbose_name_plural = "chat rooms"

    def __str__(self):
        return self.name or f"Room #{self.pk}"


class ChatMember(models.Model):
    room = models.ForeignKey(ChatRoom, on_delete=models.CASCADE, related_name="members")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="chat_memberships",
    )
    joined_at = models.DateTimeField(auto_now_add=True)
    last_read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = ("room", "user")
        verbose_name = "chat member"
        verbose_name_plural = "chat members"

    def __str__(self):
        return f"{self.user} in {self.room}"


class ChatMessage(models.Model):
    # Django attaches these implicitly from the FKs below.
    room_id: int
    sender_id: int | None

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    room = models.ForeignKey(ChatRoom, on_delete=models.CASCADE, related_name="messages")
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="sent_messages",
    )
    message = models.TextField(blank=True)
    reply_to = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="replies",
    )
    file = models.FileField(upload_to=chat_upload_to, null=True, blank=True)
    file_type = models.CharField(max_length=100, blank=True, default="")
    file_size = models.PositiveIntegerField(null=True, blank=True)
    is_deleted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]
        verbose_name = "chat message"
        verbose_name_plural = "chat messages"

    def __str__(self):
        return f"Msg #{self.pk} in room {self.room_id}"
