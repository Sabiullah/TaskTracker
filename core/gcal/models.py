from django.conf import settings
from django.db import models

from core.base import TimeStampedModel


class GoogleCalendarCredential(TimeStampedModel):
    """OAuth credentials for one Tasktracker user's personal Google account.

    The ``refresh_token`` column is SENSITIVE - never log it, never return it
    to the frontend. DB column access is restricted by Postgres role rules.
    The on-disk format is plain text; encryption-at-rest is a documented
    future change (see ``docs/superpowers/specs/2026-05-16-gcal-oauth-foundation-design.md``).
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="gcal_credential",
    )
    refresh_token = models.TextField()
    access_token = models.TextField(blank=True)
    access_token_expires_at = models.DateTimeField(null=True, blank=True)
    google_email = models.EmailField(blank=True)
    scopes = models.TextField(blank=True)  # space-separated
    last_refreshed_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "Google Calendar credential"
        verbose_name_plural = "Google Calendar credentials"

    def __str__(self) -> str:
        suffix = " (revoked)" if self.revoked_at else ""
        return f"GCal credential for {self.user_id}{suffix}"
