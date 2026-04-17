from rest_framework import serializers

from core.serializers import UserMinSerializer

from .models import Attendance


class AttendanceSerializer(serializers.ModelSerializer):
    user_detail = UserMinSerializer(source="user", read_only=True)
    org_uid = serializers.UUIDField(source="org.uid", read_only=True, allow_null=True)

    class Meta:
        model = Attendance
        fields = [
            "id",
            "uid",
            "org_uid",
            "user_detail",
            "date",
            "status",
            "work_location",
            "login_time",
            "logout_time",
            "remarks",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "uid", "org_uid", "user_detail", "created_at", "updated_at"]
