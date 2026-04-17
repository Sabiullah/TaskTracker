from rest_framework import serializers

from core.masters.models import Master
from core.masters.serializers import MasterMinSerializer
from core.serializers import UserMinSerializer

from .models import Notice


class NoticeSerializer(serializers.ModelSerializer):
    client_detail = MasterMinSerializer(source="client", read_only=True)
    created_by_detail = UserMinSerializer(source="created_by", read_only=True)

    client = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Master.objects.filter(type="client"),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = Notice
        fields = [
            "id",
            "uid",
            "serial_no",
            "client",
            "client_detail",
            "dispute_nature",
            "fy",
            "status",
            "remarks",
            "received_date",
            "replied_date",
            "next_target_date",
            "created_by_detail",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "uid", "serial_no", "client_detail", "created_by_detail", "created_at", "updated_at"]
