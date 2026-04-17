import json

from channels.generic.websocket import AsyncWebsocketConsumer


class RealtimeConsumer(AsyncWebsocketConsumer):
    """
    Generic real-time consumer.

    Clients send:
        {"action": "subscribe",   "channel": "<channel_name>"}
        {"action": "unsubscribe", "channel": "<channel_name>"}

    Server pushes:
        {"channel": "<channel_name>", "event": "INSERT|UPDATE|DELETE", "record": {...}}
    """

    async def connect(self):
        user = self.scope.get("user")
        if not user or not user.is_authenticated:
            await self.close()
            return
        self._groups: set[str] = set()
        await self.accept()

    async def disconnect(self, code):
        for group in list(getattr(self, "_groups", [])):
            await self.channel_layer.group_discard(group, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        try:
            data = json.loads(text_data or "{}")
        except json.JSONDecodeError:
            return

        action = data.get("action")
        channel = data.get("channel", "").strip()

        if not channel:
            return

        if action == "subscribe":
            if channel not in self._groups:
                self._groups.add(channel)
                await self.channel_layer.group_add(channel, self.channel_name)

        elif action == "unsubscribe":
            self._groups.discard(channel)
            await self.channel_layer.group_discard(channel, self.channel_name)

    # Called by channel layer when backend broadcasts via group_send
    async def realtime_event(self, event):
        await self.send(
            text_data=json.dumps(
                {
                    "channel": event["channel"],
                    "event": event["event_type"],
                    "record": event["record"],
                }
            )
        )
