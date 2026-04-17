"""HTTP endpoint that serves files referenced by a signed URL."""

from __future__ import annotations

import jwt
from django.conf import settings
from django.core.files.storage import default_storage
from django.http import FileResponse, HttpResponse
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .signed_url import decode_signed_url


class ServeFileView(APIView):
    """Serve the file whose path is encoded in the ``token`` query param.

    The signed token is the authentication, so we deliberately leave the
    view open to anonymous callers — anyone who has the URL (and hasn't
    run past ``exp``) gets the file.

    In prod (``FILESTORE_USE_XACCEL=True``) we return an empty response
    with the ``X-Accel-Redirect`` header so nginx does the actual file
    send. In dev Django streams the file itself.
    """

    permission_classes = [AllowAny]
    authentication_classes: list = []

    def get(self, request):
        token = request.GET.get("token")
        if not token:
            return Response({"error": "Missing token"}, status=400)
        try:
            file_path = decode_signed_url(token)
        except jwt.ExpiredSignatureError:
            return Response({"error": "Link expired"}, status=410)
        except jwt.InvalidTokenError:
            return Response({"error": "Invalid token"}, status=400)

        if not default_storage.exists(file_path):
            return Response({"error": "File not found"}, status=404)

        filename = file_path.rsplit("/", 1)[-1]

        if getattr(settings, "FILESTORE_USE_XACCEL", False):
            # nginx location block is marked `internal` so clients cannot
            # hit it directly — the redirect header is the handoff.
            accel = HttpResponse(status=200)
            accel["X-Accel-Redirect"] = f"{settings.FILESTORE_XACCEL_LOCATION}{file_path}"
            accel["Content-Disposition"] = f'inline; filename="{filename}"'
            # Let nginx set Content-Type from the file extension
            del accel["Content-Type"]
            return accel

        # DEBUG / dev path: Django streams the file itself.
        streamed = FileResponse(default_storage.open(file_path, "rb"))
        streamed["Content-Disposition"] = f'inline; filename="{filename}"'
        return streamed
