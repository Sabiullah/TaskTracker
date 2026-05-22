from rest_framework import serializers

from core.serializers import UserMinSerializer

from .models import LeaveRequest


class LeaveRequestSerializer(serializers.ModelSerializer):
    user_detail = UserMinSerializer(source="user", read_only=True)
    approver_detail = UserMinSerializer(source="approver", read_only=True)
    org_uid = serializers.UUIDField(source="org.uid", read_only=True, allow_null=True)
    # `user` is intentionally read-only on the serializer. Ownership is
    # set on create via `perform_create` reading raw request.data and
    # passing `user=target` as a kwarg to `serializer.save()`, which
    # bypasses serializer validation. Keeping the field `read_only=True`
    # prevents PATCH from re-assigning ownership to another user.
    user = serializers.SlugRelatedField(slug_field="uid", read_only=True)  # type: ignore[var-annotated]

    class Meta:
        model = LeaveRequest
        fields = [
            "id",
            "uid",
            "org_uid",
            "user",
            "user_detail",
            "from_date",
            "to_date",
            "from_session",
            "to_session",
            "reason",
            "request_type",
            "status",
            "approver",
            "approver_detail",
            "approved_at",
            "rejection_reason",
            "total_days",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "uid",
            "org_uid",
            "user",  # ownership cannot change post-create; admin sets via perform_create kwarg
            "user_detail",
            "approver",
            "approver_detail",
            "approved_at",
            "rejection_reason",
            "total_days",
            "status",  # use approve/reject/withdraw actions to change
            "created_at",
            "updated_at",
        ]

    def validate(self, attrs):
        if attrs.get("from_date") and attrs.get("to_date") and attrs["from_date"] > attrs["to_date"]:
            raise serializers.ValidationError({"to_date": "to_date cannot be before from_date"})
        return attrs
