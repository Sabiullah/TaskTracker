"""
Broadcast helpers for pushing real-time events to WebSocket clients.

Usage in a ViewSet:
    from core.realtime import broadcast

    def perform_create(self, serializer):
        obj = serializer.save()
        broadcast("tasks", "INSERT", TaskSerializer(obj).data)

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast("tasks", "UPDATE", TaskSerializer(obj).data)

    def perform_destroy(self, instance):
        broadcast("tasks", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()

Channels to use per model:
    tasks            → "tasks"
    invoice_entries  → "invoice-entries"
    invoice_plans    → "invoice-plans"
    notices          → "notices"
    leads            → "leads"
    lead_statuses    → "lead-statuses"
    chat_messages    → "chat-messages"
"""

import datetime
import uuid
from decimal import Decimal

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer


def _msgpack_safe(value):
    """Coerce types DRF handles natively but msgpack does not.

    Serialiser ``.data`` still carries native Python objects at the edges —
    ``UUID`` (from ``SlugRelatedField(slug_field="uid")`` and any
    ``UUIDField``), ``date`` / ``datetime``, ``Decimal``. DRF's JSON
    renderer converts these on the way out, but ``channels_redis`` uses
    msgpack which raises ``TypeError: can not serialize 'UUID' object``
    (or similar) on the first such value. Walk the structure and stringify
    the problem types recursively.
    """
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, datetime.datetime | datetime.date | datetime.time):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return {k: _msgpack_safe(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [_msgpack_safe(v) for v in value]
    return value


def broadcast(channel: str, event_type: str, record: dict) -> None:
    """
    Send a real-time event to all WebSocket clients subscribed to *channel*.

    :param channel:    Logical channel name (e.g. "tasks", "invoice-entries").
    :param event_type: One of "INSERT", "UPDATE", "DELETE".
    :param record:     Serialised payload to send to clients.
    """
    layer = get_channel_layer()
    if layer is None:
        # Channels not configured (e.g. during tests without Redis) — skip silently.
        return
    async_to_sync(layer.group_send)(
        channel,
        {
            "type": "realtime_event",  # maps to RealtimeConsumer.realtime_event()
            "channel": channel,
            "event_type": event_type,
            "record": _msgpack_safe(record),
        },
    )
