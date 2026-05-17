from django.contrib import admin

from core.gcal.models import GoogleCalendarCredential


@admin.register(GoogleCalendarCredential)
class GoogleCalendarCredentialAdmin(admin.ModelAdmin):
    """Visible to Django admins, but the tokens are explicitly excluded.

    Tokens should never appear in the admin (or anywhere else) - only the
    application code via :func:`core.gcal.services.get_user_credentials`
    is allowed to read them.
    """

    list_display = (
        "user",
        "google_email",
        "connected_since",
        "last_refreshed_at",
        "revoked_at",
    )
    readonly_fields = (
        "user",
        "google_email",
        "scopes",
        "last_refreshed_at",
        "revoked_at",
        "created_at",
        "updated_at",
    )
    exclude = ("refresh_token", "access_token", "access_token_expires_at")
    search_fields = ("user__email", "google_email")

    def connected_since(self, obj: GoogleCalendarCredential):
        return obj.created_at

    connected_since.short_description = "Connected since"  # type: ignore[attr-defined]
