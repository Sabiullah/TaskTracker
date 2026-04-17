"""
ASGI config — HTTP via Django, WebSocket via Django Channels.
"""

import os

from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import AllowedHostsOriginValidator
from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

# Import websocket routes *after* setting DJANGO_SETTINGS_MODULE so that
# Django's app registry is ready when the consumers are imported.
from core.chat.middleware import JWTAuthMiddleware  # noqa: E402
from core.chat.routing import websocket_urlpatterns  # noqa: E402

application = ProtocolTypeRouter(
    {
        "http": get_asgi_application(),
        # JWT in the `?token=` query param is the WebSocket auth mechanism —
        # the browser's native WebSocket API cannot set Authorization headers.
        "websocket": AllowedHostsOriginValidator(JWTAuthMiddleware(URLRouter(websocket_urlpatterns))),
    }
)
