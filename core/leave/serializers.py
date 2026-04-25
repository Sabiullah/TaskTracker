from rest_framework import serializers

from core.serializers import UserMinSerializer
from users.models import User

from .models import LeaveRequest


class LeaveRequestSerializer(serializers.ModelSerializer):
    user_detail = UserMinSerializer(source="user", read_only=True)
    approver_detail = UserMinSerializer(source="approver", read_only=True)
    org_uid = serializers.UUIDField(source="org.uid", read_only=True, allow_null=True)
    user = serializers.SlugRelatedField(slug_field="uid", queryset=User.objects.all())

    class Meta:
        model = LeaveRequest
        fields = [
            "id", "uid", "org_uid",
            "user", "user_detail",
            "from_date", "to_date", "from_session", "to_session",
            "reason", "status",
            "approver", "approver_detail", "approved_at", "rejection_reason",
            "total_days",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "uid", "org_uid",
            "user",  # ownership cannot change post-create; admin sets via perform_create kwarg
            "user_detail", "approver", "approver_detail", "approved_at",
            "rejection_reason", "total_days",
            "status",  # use approve/reject/withdraw actions to change
            "created_at", "updated_at",
        ]

    def validate(self, data):
        if data.get("from_date") and data.get("to_date") and data["from_date"] > data["to_date"]:
            raise serializers.ValidationError({"to_date": "to_date cannot be before from_date"})
        return data
