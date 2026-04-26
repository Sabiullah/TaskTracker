from rest_framework import serializers

from .models import WorkingDayOverride


class WorkingDayOverrideSerializer(serializers.ModelSerializer):
    org_uid = serializers.UUIDField(source="org.uid", read_only=True)

    class Meta:
        model = WorkingDayOverride
        fields = ["id", "uid", "org_uid", "date", "is_working", "note", "created_at"]
        read_only_fields = ["id", "uid", "org_uid", "created_at"]
