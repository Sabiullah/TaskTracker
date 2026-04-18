from rest_framework import serializers

from core.serializers import UserMinSerializer
from users.models import User

from .models import Attendance


class AttendanceSerializer(serializers.ModelSerializer):
    user_detail = UserMinSerializer(source="user", read_only=True)
    org_uid = serializers.UUIDField(source="org.uid", read_only=True, allow_null=True)
    # ``user`` is a required FK on the model. Without a writable serializer
    # field, admin/manager POSTs that target another employee had ``user``
    # silently dropped and the create raised an IntegrityError. Frontend
    # sends the target user's uid in the body.
    user = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=User.objects.all(),
    )

    class Meta:
        model = Attendance
        fields = [
            "id",
            "uid",
            "org_uid",
            "user",
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
