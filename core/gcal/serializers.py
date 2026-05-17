from rest_framework import serializers

from core.gcal.models import GoogleCalendarCredential


class GcalStatusSerializer(serializers.ModelSerializer):
    """Read-only DTO surfacing connection state to the frontend.

    Never includes the tokens.
    """

    scopes = serializers.SerializerMethodField()
    connected_at = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = GoogleCalendarCredential
        fields = ["google_email", "scopes", "connected_at", "last_refreshed_at"]
        read_only_fields = fields

    def get_scopes(self, obj: GoogleCalendarCredential) -> list[str]:
        return obj.scopes.split() if obj.scopes else []
