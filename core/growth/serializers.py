from django.contrib.auth import get_user_model
from rest_framework import serializers

from core.serializers import UserMinSerializer

from .models import GrowthPlan


class GrowthPlanSerializer(serializers.ModelSerializer):
    assigned_to_detail = UserMinSerializer(source="assigned_to", read_only=True)
    created_by_detail = UserMinSerializer(source="created_by", read_only=True)
    org_uid = serializers.UUIDField(source="org.uid", read_only=True, allow_null=True)

    assigned_to = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=get_user_model().objects.all(),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = GrowthPlan
        fields = [
            "id",
            "uid",
            "org_uid",
            "activity",
            "target_month",
            "steps_taken",
            "steps_to_take",
            "status",
            "priority",
            "remarks",
            "assigned_to",
            "assigned_to_detail",
            "created_by_detail",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "uid",
            "org_uid",
            "assigned_to_detail",
            "created_by_detail",
            "created_at",
            "updated_at",
        ]
