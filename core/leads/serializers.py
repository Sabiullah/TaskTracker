from django.contrib.auth import get_user_model
from rest_framework import serializers

from core.masters.models import Master
from core.masters.serializers import MasterMinSerializer
from core.serializers import UserMinSerializer

from .models import Lead, LeadHistory, LeadStatus


class LeadStatusSerializer(serializers.ModelSerializer):
    class Meta:
        model = LeadStatus
        fields = ["id", "name", "color", "sort_order", "is_active"]


class LeadHistorySerializer(serializers.ModelSerializer):
    created_by_detail = UserMinSerializer(source="created_by", read_only=True)

    class Meta:
        model = LeadHistory
        fields = ["id", "uid", "lead", "note", "created_by_detail", "created_at", "updated_at"]
        read_only_fields = ["id", "uid", "created_by_detail", "created_at", "updated_at"]


class LeadSerializer(serializers.ModelSerializer):
    client_detail = MasterMinSerializer(source="client", read_only=True)
    status_detail = LeadStatusSerializer(source="status", read_only=True)
    assigned_to_detail = UserMinSerializer(source="assigned_to", read_only=True)
    created_by_detail = UserMinSerializer(source="created_by", read_only=True)
    org_uid = serializers.UUIDField(source="org.uid", read_only=True, allow_null=True)
    history = LeadHistorySerializer(many=True, read_only=True)

    client = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Master.objects.filter(type="client"),
        required=False,
        allow_null=True,
    )
    status = serializers.PrimaryKeyRelatedField(
        queryset=LeadStatus.objects.all(),
        required=False,
        allow_null=True,
    )
    assigned_to = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=get_user_model().objects.all(),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = Lead
        fields = [
            "id",
            "uid",
            "org_uid",
            "serial_no",
            "client",
            "client_detail",
            "client_name",
            "contact_person",
            "contact_email",
            "contact_phone",
            "lead_source",
            "reference_from",
            "status",
            "status_detail",
            "priority",
            "assigned_to",
            "assigned_to_detail",
            "estimated_value",
            "action_taken",
            "next_step",
            "next_step_date",
            "remarks",
            "history",
            "created_by_detail",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "uid",
            "org_uid",
            "serial_no",
            "client_detail",
            "status_detail",
            "assigned_to_detail",
            "created_by_detail",
            "history",
            "created_at",
            "updated_at",
        ]
