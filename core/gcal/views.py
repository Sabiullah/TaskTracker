from urllib.parse import urlencode

from django.conf import settings
from django.core.signing import BadSignature, SignatureExpired
from django.http import HttpResponseRedirect
from rest_framework import permissions, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from core.gcal import services
from core.gcal.models import GoogleCalendarCredential
from core.gcal.serializers import GcalStatusSerializer
from core.gcal.state import verify_state
from users.models import User


def _redirect_to_frontend(**params: str) -> HttpResponseRedirect:
    base = settings.GCAL_FRONTEND_RETURN_URL
    return HttpResponseRedirect(f"{base}?{urlencode(params)}")


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def auth_url(request):
    if not settings.GCAL_CLIENT_ID:
        return Response(
            {"error": "GCAL_NOT_CONFIGURED"},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    url = services.build_auth_url(request.user)
    return Response({"url": url})


@api_view(["GET"])
@permission_classes([permissions.AllowAny])
def oauth_callback(request):
    state = request.query_params.get("state") or ""
    code = request.query_params.get("code") or ""

    if not state or not code:
        return _redirect_to_frontend(gcal="error", reason="bad_state")

    try:
        user_id = verify_state(state)
    except (BadSignature, SignatureExpired):
        return _redirect_to_frontend(gcal="error", reason="bad_state")

    try:
        user = User.objects.get(pk=user_id)
    except User.DoesNotExist:
        return _redirect_to_frontend(gcal="error", reason="bad_state")

    try:
        services.exchange_code_and_save(user, code)
    except services.GcalCodeExchangeFailed:
        return _redirect_to_frontend(gcal="error", reason="code_exchange_failed")
    except services.GcalUserinfoFailed:
        return _redirect_to_frontend(gcal="error", reason="userinfo_failed")
    except Exception:
        return _redirect_to_frontend(gcal="error", reason="unknown")

    return _redirect_to_frontend(gcal="connected")


@api_view(["GET"])
@permission_classes([permissions.IsAuthenticated])
def status_view(request):
    try:
        row = GoogleCalendarCredential.objects.get(user=request.user)
    except GoogleCalendarCredential.DoesNotExist:
        return Response({"connected": False})
    if row.revoked_at is not None:
        return Response({"connected": False})
    return Response({"connected": True, **GcalStatusSerializer(row).data})


@api_view(["DELETE"])
@permission_classes([permissions.IsAuthenticated])
def disconnect(request):
    services.revoke_and_delete(request.user)
    return Response({"disconnected": True})
