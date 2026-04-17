"""
ASGI config — HTTP via Django, WebSocket via Django Channels.
"""

import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

# get_asgi_application() internally calls django.setup() — *must* run before
# anything that imports model code (our JWT middleware pulls in
# django.contrib.auth.models, which fails with AppRegistryNotReady otherwise).
from django.core.asgi import get_asgi_application  # noqa: E402

django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402
from channels.security.websocket import AllowedHostsOriginValidator  # noqa: E402

from core.chat.middleware import JWTAuthMiddleware  # noqa: E402
from core.chat.routing import websocket_urlpatterns  # noqa: E402

application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        # JWT in the `?token=` query param is the WebSocket auth mechanism —
        # the browser's native WebSocket API cannot set Authorization headers.
        "websocket": AllowedHostsOriginValidator(JWTAuthMiddleware(URLRouter(websocket_urlpatterns))),
    }
)
