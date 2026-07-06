from rest_framework import serializers

from core.masters.models import Master
from core.masters.serializers import MasterMinSerializer
from users.models import Org

from .models import CostingEntry


class CostingEntrySerializer(serializers.ModelSerializer):
    org = serializers.SlugRelatedField(slug_field="uid", queryset=Org.objects.all(), required=False)
    client = serializers.SlugRelatedField(slug_field="uid", queryset=Master.objects.filter(type="client"))
    designation = serializers.SlugRelatedField(slug_field="uid", queryset=Master.objects.filter(type="designation"))
    client_detail = MasterMinSerializer(source="client", read_only=True)
    designation_detail = MasterMinSerializer(source="designation", read_only=True)
    created_by_uid = serializers.UUIDField(source="created_by.uid", read_only=True, allow_null=True)

    class Meta:
        model = CostingEntry
        fields = [
            "id",
            "uid",
            "org",
            "client",
            "client_detail",
            "designation",
            "designation_detail",
            "hr_day",
            "days_working",
            "total",
            "created_by_uid",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "uid", "total", "created_by_uid", "created_at", "updated_at"]
