"""Signed-URL helpers for file serving.

Design:
- LOCAL storage (default): we issue a JWT containing the storage path +
  an expiry, and serve the file ourselves through ``ServeFileView``.
- S3 / remote storage (future): when ``FILE_STORAGE_BACKEND == "s3"`` we
  delegate to the storage backend's ``url(name)`` which django-storages
  already generates as a presigned URL.

The public entry point is ``file_url(file_field, request, expires_in)``
which callers (serializers, views) should use instead of ``file_field.url``
so that the signing strategy can be swapped without touching call sites.
"""

from __future__ import annotations

import time

import jwt
from django.conf import settings
from django.core.files.storage import default_storage
from django.urls import reverse

SIGNING_ALGORITHM = "HS256"


def make_signed_url(file_path: str, expires_in: int = 300, request=None) -> str:
    """Return a URL that will serve ``file_path`` via ``ServeFileView``.

    ``file_path`` is the name used by the storage backend (i.e. the value
    of ``FileField.name``). ``expires_in`` is in seconds.
    """

    payload = {"path": file_path, "exp": int(time.time()) + int(expires_in)}
    token = jwt.encode(payload, settings.SECRET_KEY, algorithm=SIGNING_ALGORITHM)
    path = reverse("filestore-serve") + f"?token={token}"
    if request is not None:
        return request.build_absolute_uri(path)
    return path


def decode_signed_url(token: str) -> str:
    """Validate the token and return the storage path it points to.

    Raises ``jwt.ExpiredSignatureError`` or ``jwt.InvalidTokenError`` on
    failure — callers translate those into HTTP 410/400 responses.
    """

    payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[SIGNING_ALGORITHM])
    return payload["path"]


def file_url(file_field, request=None, expires_in: int = 300) -> str | None:
    """Return a safe URL for a ``FileField`` value, or ``None`` if unset.

    Uses signed URLs for local storage and delegates to the storage
    backend for anything else (S3, GCS, etc.), which is the cleanest way
    to stay agnostic about the future storage choice.
    """

    if not file_field:
        return None

    backend = getattr(settings, "FILE_STORAGE_BACKEND", "local").lower()
    if backend == "local":
        return make_signed_url(file_field.name, expires_in=expires_in, request=request)

    # Non-local backend (e.g. S3): the storage's .url() already returns
    # a presigned URL when configured via django-storages.
    url = default_storage.url(file_field.name)
    if request is not None and url.startswith("/"):
        return request.build_absolute_uri(url)
    return url
