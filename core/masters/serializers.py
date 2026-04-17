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

    org = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Org.objects.all(),
        required=False,
        allow_null=True,
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
            "created_by_uid",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "uid", "org_uid", "created_by_uid", "created_at", "updated_at"]
