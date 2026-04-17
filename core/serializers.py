from rest_framework import serializers


class UserMinSerializer(serializers.Serializer):
    """Lightweight User representation for nested FK reads."""

    id = serializers.IntegerField()
    uid = serializers.UUIDField()
    full_name = serializers.CharField()
    username = serializers.CharField()
    avatar_color = serializers.CharField(allow_blank=True, required=False)


class OrgScopedMixin:
    """Enforces that a submitted ``org`` FK matches the request user's org.

    Without this check, a SlugRelatedField with ``queryset=Org.objects.all()``
    accepts any existing Org UID, allowing a caller to write rows into another
    tenant. Apply by inheriting *before* ``ModelSerializer``.
    """

    def validate_org(self, value):
        context = getattr(self, "context", {}) or {}
        request = context.get("request")
        user = getattr(request, "user", None) if request else None
        user_org = getattr(user, "org", None) if user and user.is_authenticated else None
        if value is None or user_org is None:
            return value
        if value.pk != user_org.pk:
            raise serializers.ValidationError("Org must match the authenticated user's organization.")
        return value
