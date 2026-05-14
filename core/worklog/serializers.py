from rest_framework import serializers

from core.masters.models import Master
from core.masters.serializers import MasterMinSerializer
from core.serializers import OrgScopedMixin, UserMinSerializer
from users.models import Org, User

from .models import WorkLog, WorkPlan


class WorkLogSerializer(OrgScopedMixin, serializers.ModelSerializer):
    client_detail = MasterMinSerializer(source="client", read_only=True)
    org_uid = serializers.UUIDField(source="org.uid", read_only=True, allow_null=True)
    user_detail = UserMinSerializer(source="user", read_only=True)

    client = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Master.objects.filter(type="client"),
        required=False,
        allow_null=True,
    )
    org = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Org.objects.all(),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = WorkLog
        fields = [
            "id",
            "uid",
            "user_detail",
            "date",
            "task_description",
            "hours_worked",
            "priority",
            "sort_order",
            "client",
            "client_detail",
            "org",
            "org_uid",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "uid",
            "user_detail",
            "client_detail",
            "org_uid",
            "created_at",
            "updated_at",
        ]


class WorkPlanSerializer(serializers.ModelSerializer):
    client_detail = MasterMinSerializer(source="client", read_only=True)
    assigned_to_detail = UserMinSerializer(source="assigned_to", read_only=True)
    created_by_detail = UserMinSerializer(source="created_by", read_only=True)

    client = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Master.objects.filter(type="client"),
        required=False,
        allow_null=True,
    )
    # ``assigned_to`` is a required FK on the model — without a writable
    # serializer field, POSTs from the frontend (which sends the user uid)
    # had it silently dropped and the create raised an IntegrityError.
    assigned_to = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=User.objects.all(),
    )

    def update(self, instance, validated_data):
        # Series tag is stamped at create-time only. The dedicated
        # ``apply_to_following`` endpoint handles series-wide edits; the
        # standard PATCH path must not move a row between series.
        validated_data.pop("series_uid", None)
        validated_data.pop("recurrence", None)
        validated_data.pop("recurrence_end_date", None)
        return super().update(instance, validated_data)

    class Meta:
        model = WorkPlan
        fields = [
            "id",
            "uid",
            "assigned_to",
            "assigned_to_detail",
            "created_by_detail",
            "date",
            "task_description",
            "planned_hours",
            "client",
            "client_detail",
            "series_uid",
            "recurrence",
            "recurrence_end_date",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "uid",
            "assigned_to_detail",
            "created_by_detail",
            "client_detail",
            "created_at",
            "updated_at",
        ]
