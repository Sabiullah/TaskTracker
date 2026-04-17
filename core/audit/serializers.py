from rest_framework import serializers

from core.serializers import UserMinSerializer

from .models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    actor_detail = UserMinSerializer(source="actor", read_only=True)
    org_uid = serializers.UUIDField(source="org.uid", read_only=True, allow_null=True)

    class Meta:
        model = AuditLog
        fields = [
            "id",
            "actor_detail",
            "org_uid",
            "action",
            "resource_type",
            "resource_id",
            "changes",
            "ip_address",
            "created_at",
        ]
        read_only_fields = fields
