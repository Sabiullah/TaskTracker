from django.urls import path

from .consumers import RealtimeConsumer

# `path()` from django.urls is typed for HTTP views; Channels reuses the
# same callable for WebSocket ASGI apps. Runtime works fine — silence
# pyright's view-type check for this one call.
websocket_urlpatterns = [
    path("ws/", RealtimeConsumer.as_asgi()),  # pyright: ignore[reportArgumentType, reportCallIssue]
]
