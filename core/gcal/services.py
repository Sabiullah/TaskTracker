"""Google Calendar OAuth service layer.

This module is the ONLY place in the codebase that talks to Google's OAuth
endpoints. All HTTP calls go through ``google_auth_oauthlib`` or the Google
revoke endpoint.

The single entry point for downstream features (GC-2 read overlay, GC-3
schedule meeting) is :func:`get_user_credentials`.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import cast

import requests
from django.conf import settings
from django.utils import timezone as djtz
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow

from core.gcal.models import GoogleCalendarCredential
from core.gcal.state import sign_state
from users.models import User

# Scope set requested from Google. Must match the scopes configured on the
# OAuth consent screen in Google Cloud Console.
SCOPES: list[str] = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/calendar.events",
]

_ACCESS_TOKEN_SKEW_SECONDS = 60  # refresh 60s before actual expiry


class GcalNotConfigured(RuntimeError):
    """Raised when GCAL_CLIENT_ID is empty / blank."""


class GcalCodeExchangeFailed(RuntimeError):
    """Raised when Google rejects our code exchange request."""


class GcalUserinfoFailed(RuntimeError):
    """Raised when fetching /userinfo fails after a successful exchange."""


def _ensure_configured() -> None:
    if not settings.GCAL_CLIENT_ID:
        raise GcalNotConfigured("GCAL_CLIENT_ID is not set")


def _flow() -> Flow:
    return Flow.from_client_config(
        client_config={
            "web": {
                "client_id": settings.GCAL_CLIENT_ID,
                "client_secret": settings.GCAL_CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/v2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [settings.GCAL_REDIRECT_URI],
            }
        },
        scopes=SCOPES,
        redirect_uri=settings.GCAL_REDIRECT_URI,
    )


def build_auth_url(user: User) -> str:
    """Return the Google consent URL the frontend should redirect to."""
    _ensure_configured()
    flow = _flow()
    url, _state = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
        state=sign_state(user.pk),
    )
    return url


def _fetch_userinfo_email(creds: Credentials) -> str:
    """One extra HTTP call to /userinfo to capture the connected email."""
    resp = requests.get(
        "https://openidconnect.googleapis.com/v1/userinfo",
        headers={"Authorization": f"Bearer {creds.token}"},
        timeout=5,
    )
    if not resp.ok:
        raise GcalUserinfoFailed(f"Userinfo failed: {resp.status_code}")
    return resp.json().get("email", "")


def exchange_code_and_save(user: User, code: str) -> GoogleCalendarCredential:
    """Exchange an OAuth code for tokens and upsert the credential row."""
    _ensure_configured()
    flow = _flow()
    try:
        flow.fetch_token(code=code)
    except Exception as exc:
        raise GcalCodeExchangeFailed(str(exc)) from exc

    creds = cast(Credentials, flow.credentials)
    email = _fetch_userinfo_email(creds)
    expiry_aware = creds.expiry.replace(tzinfo=UTC) if creds.expiry else None
    cred, _ = GoogleCalendarCredential.objects.update_or_create(
        user=user,
        defaults={
            "refresh_token": creds.refresh_token or "",
            "access_token": creds.token or "",
            "access_token_expires_at": expiry_aware,
            "google_email": email,
            "scopes": " ".join(creds.scopes or []),
            "last_refreshed_at": djtz.now(),
            "revoked_at": None,
        },
    )
    return cred


def _is_expired(expiry: datetime | None) -> bool:
    if expiry is None:
        return True
    now = djtz.now()
    return expiry <= now + timedelta(seconds=_ACCESS_TOKEN_SKEW_SECONDS)


def get_user_credentials(user: User) -> Credentials | None:
    """Return refreshed Google credentials for the user, or None.

    None is returned when:
      * no credential row exists,
      * the credential has been marked ``revoked_at``, or
      * refresh failed (in which case we mark the row revoked too).
    """
    try:
        row = GoogleCalendarCredential.objects.get(user=user)
    except GoogleCalendarCredential.DoesNotExist:
        return None
    if row.revoked_at is not None:
        return None

    creds = Credentials(
        token=row.access_token or None,
        refresh_token=row.refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.GCAL_CLIENT_ID,
        client_secret=settings.GCAL_CLIENT_SECRET,
        scopes=row.scopes.split() if row.scopes else None,
        expiry=row.access_token_expires_at.replace(tzinfo=None) if row.access_token_expires_at else None,
    )

    if _is_expired(row.access_token_expires_at):
        from google.auth.exceptions import RefreshError

        try:
            creds.refresh(Request())
        except RefreshError:
            row.revoked_at = djtz.now()
            row.save(update_fields=["revoked_at", "updated_at"])
            return None

        row.access_token = creds.token or ""
        if creds.expiry is not None:
            row.access_token_expires_at = creds.expiry.replace(tzinfo=UTC)
        row.last_refreshed_at = djtz.now()
        row.save(
            update_fields=[
                "access_token",
                "access_token_expires_at",
                "last_refreshed_at",
                "updated_at",
            ]
        )

    return creds


def revoke_and_delete(user: User) -> None:
    """Best-effort revoke on Google + always-delete locally."""
    try:
        row = GoogleCalendarCredential.objects.get(user=user)
    except GoogleCalendarCredential.DoesNotExist:
        return

    try:
        requests.post(
            "https://oauth2.googleapis.com/revoke",
            params={"token": row.refresh_token},
            headers={"content-type": "application/x-www-form-urlencoded"},
            timeout=5,
        )
    except Exception:
        # Network errors don't block local disconnect.
        pass

    row.delete()
