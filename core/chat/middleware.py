"""Channels middleware that authenticates WebSocket connections via JWT.

The REST side uses `Authorization: Bearer <access>` — but the browser cannot
set headers on a native WebSocket, so the frontend passes the access token
as a `?token=<jwt>` query param on the WS URL. This middleware decodes it,
resolves the user, and attaches it to ``scope["user"]``.
"""

from __future__ import annotations

from typing import Any, cast
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import UntypedToken

User = get_user_model()


@database_sync_to_async
def _user_from_token(raw_token: str):
    try:
        # simplejwt accepts a str at runtime; stubs type it as Token | None.
        validated = UntypedToken(raw_token)  # type: ignore[arg-type]
    except (InvalidToken, TokenError):
        return AnonymousUser()
    user_id = validated.get("user_id")
    if user_id is None:
        return AnonymousUser()
    try:
        return User.objects.get(pk=user_id)
    except User.DoesNotExist:
        return AnonymousUser()


class JWTAuthMiddleware(BaseMiddleware):
    """Reads `?token=<access>` from the WebSocket URL and sets scope['user']."""

    async def __call__(self, scope, receive, send):
        qs = parse_qs((scope.get("query_string") or b"").decode("utf-8"))
        tokens = qs.get("token") or []
        user = await _user_from_token(tokens[0]) if tokens else AnonymousUser()
        # channels' scope TypedDict expects UserLazyObject; at runtime any
        # AbstractBaseUser works and consumers check `user.is_authenticated`.
        cast(dict[str, Any], scope)["user"] = user
        return await super().__call__(scope, receive, send)
