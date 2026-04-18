from rest_framework import serializers


class UserMinSerializer(serializers.Serializer):
    """Lightweight User representation for nested FK reads."""

    id = serializers.IntegerField()
    uid = serializers.UUIDField()
    full_name = serializers.CharField()
    username = serializers.CharField()
    avatar_color = serializers.CharField(allow_blank=True, required=False)


class OrgScopedMixin:
    """Enforces that a submitted ``org`` FK belongs to the request user.

    Without this check, a ``SlugRelatedField(queryset=Org.objects.all())``
    accepts any existing Org UID — that would let a caller write rows into
    an org they don't belong to. Apply by inheriting *before*
    ``ModelSerializer``.

    Multi-org: the caller's memberships are the allowed set. If the submitted
    ``org`` is one of them, the write is allowed; otherwise 400.
    """

    def validate_org(self, value):
        context = getattr(self, "context", {}) or {}
        request = context.get("request")
        user = getattr(request, "user", None) if request else None
        if value is None or not (user and user.is_authenticated):
            return value
        member_ids = set(user.org_ids())
        if not member_ids:
            return value
        if value.pk not in member_ids:
            raise serializers.ValidationError("Org must be one the authenticated user is a member of.")
        return value
