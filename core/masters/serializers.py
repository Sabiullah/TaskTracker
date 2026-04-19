from rest_framework import serializers

from core.serializers import OrgScopedMixin
from users.models import Org

from .models import Master


class MasterMinSerializer(serializers.ModelSerializer):
    """Lightweight Master for nested FK reads."""

    class Meta:
        model = Master
        fields = ["id", "uid", "name", "type", "color"]


class MasterSerializer(OrgScopedMixin, serializers.ModelSerializer):
    org_uid = serializers.UUIDField(source="org.uid", read_only=True, allow_null=True)
    created_by_uid = serializers.UUIDField(source="created_by.uid", read_only=True, allow_null=True)

    # Legacy single-org FK — kept writable so existing callers that send
    # ``{"org": "<uid>"}`` still work. New flows should send ``orgs``.
    org = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Org.objects.all(),
        required=False,
        allow_null=True,
    )
    # Multi-org membership. The frontend's master modal posts an array of
    # org uids; ``to_internal_value`` on SlugRelatedField does the lookup.
    orgs = serializers.SlugRelatedField(
        many=True,
        slug_field="uid",
        queryset=Org.objects.all(),
        required=False,
    )

    class Meta:
        model = Master
        fields = [
            "id",
            "uid",
            "name",
            "type",
            "color",
            "is_active",
            "sort_order",
            "org",
            "org_uid",
            "orgs",
            "created_by_uid",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "uid", "org_uid", "created_by_uid", "created_at", "updated_at"]

    def validate_orgs(self, value):
        """Every org in the list must be one the caller belongs to.

        Mirrors ``OrgScopedMixin.validate_org`` but for the M2M side —
        without this, a caller could write a client across into an org
        they aren't a member of by stuffing its uid into the ``orgs``
        array even if the single ``org`` FK is fine.
        """
        request = (self.context or {}).get("request")
        user = getattr(request, "user", None) if request else None
        if not (user and user.is_authenticated):
            return value
        member_ids = set(user.org_ids())
        if not member_ids:
            return value
        bad = [o.pk for o in value if o.pk not in member_ids]
        if bad:
            raise serializers.ValidationError(
                "Every org must be one the authenticated user is a member of.",
            )
        return value

    def create(self, validated_data):
        orgs = validated_data.pop("orgs", None)
        obj = super().create(validated_data)
        if orgs is not None:
            obj.orgs.set(orgs)
        # Mirror the legacy FK onto the M2M so queries that still use the
        # old ``org`` filter keep seeing the row.
        if obj.org_id and not obj.orgs.filter(id=obj.org_id).exists():
            obj.orgs.add(obj.org_id)
        return obj

    def update(self, instance, validated_data):
        orgs = validated_data.pop("orgs", None)
        obj = super().update(instance, validated_data)
        if orgs is not None:
            obj.orgs.set(orgs)
        if obj.org_id and not obj.orgs.filter(id=obj.org_id).exists():
            obj.orgs.add(obj.org_id)
        return obj
