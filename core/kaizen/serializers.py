from rest_framework import serializers

from core.masters.models import Master
from core.masters.serializers import MasterMinSerializer
from core.serializers import UserMinSerializer

from .models import Kaizen


class KaizenSerializer(serializers.ModelSerializer):
    raised_by_detail = UserMinSerializer(source="raised_by", read_only=True)
    reviewed_by_detail = UserMinSerializer(source="reviewed_by", read_only=True)
    client_detail = MasterMinSerializer(source="client", read_only=True)
    org_uid = serializers.UUIDField(source="org.uid", read_only=True, allow_null=True)

    client = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Master.objects.filter(type="client"),
        required=True,
        allow_null=False,
    )

    class Meta:
        model = Kaizen
        fields = [
            "id",
            "uid",
            "org_uid",
            "raised_by_detail",
            "entry_date",
            "client",
            "client_detail",
            "area",
            "description",
            "takeaway",
            "status",
            "reviewed_by_detail",
            "reviewed_at",
            "rejection_reason",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "uid",
            "org_uid",
            "raised_by_detail",
            "entry_date",
            "client_detail",
            "status",
            "reviewed_by_detail",
            "reviewed_at",
            "rejection_reason",
            "created_at",
            "updated_at",
        ]
