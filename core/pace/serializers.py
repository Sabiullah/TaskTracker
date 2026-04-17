from django.contrib.auth import get_user_model
from rest_framework import serializers

from core.masters.models import Master
from core.masters.serializers import MasterMinSerializer
from core.serializers import OrgScopedMixin, UserMinSerializer
from users.models import Org

from .models import ClientClassification, PaceChecklist, PaceGoal, PaceGoalReview, PaceMeeting


class PaceGoalSerializer(OrgScopedMixin, serializers.ModelSerializer):
    profile_detail = UserMinSerializer(source="profile", read_only=True)
    created_by_detail = UserMinSerializer(source="created_by", read_only=True)
    org_uid = serializers.UUIDField(source="org.uid", read_only=True, allow_null=True)

    profile = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=get_user_model().objects.all(),
        required=False,
        allow_null=True,
    )
    org = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Org.objects.all(),
        required=False,
        allow_null=True,
    )

    def validate_profile(self, value):
        request = self.context.get("request")
        if request and value and hasattr(request.user, "org") and request.user.org:
            if value.org_id != request.user.org_id:
                raise serializers.ValidationError("Profile must belong to the same organization.")
        return value

    class Meta:
        model = PaceGoal
        fields = [
            "id",
            "uid",
            "profile",
            "profile_detail",
            "goal_type",
            "title",
            "description",
            "status",
            "priority",
            "current_rating",
            "target_rating",
            "success_criteria",
            "frequency",
            "target",
            "tracking_method",
            "learning_action",
            "completion_by",
            "iceberg_level",
            "focus_area",
            "daily_practice",
            "org",
            "org_uid",
            "created_by_detail",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "uid",
            "profile_detail",
            "created_by_detail",
            "org_uid",
            "created_at",
            "updated_at",
        ]


class PaceGoalReviewSerializer(serializers.ModelSerializer):
    goal_uid = serializers.UUIDField(source="goal.uid", read_only=True)
    reviewed_by_detail = UserMinSerializer(source="reviewed_by", read_only=True)

    goal = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=PaceGoal.objects.all(),
    )

    class Meta:
        model = PaceGoalReview
        fields = [
            "id",
            "uid",
            "goal",
            "goal_uid",
            "review_date",
            "previous_rating",
            "new_rating",
            "reviewer_name",
            "reviewed_by_detail",
            "comments",
            "created_at",
        ]
        read_only_fields = ["id", "uid", "goal_uid", "reviewed_by_detail", "created_at"]


class PaceMeetingSerializer(OrgScopedMixin, serializers.ModelSerializer):
    created_by_detail = UserMinSerializer(source="created_by", read_only=True)
    org_uid = serializers.UUIDField(source="org.uid", read_only=True, allow_null=True)

    org = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Org.objects.all(),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = PaceMeeting
        fields = [
            "id",
            "uid",
            "title",
            "meeting_type",
            "scheduled_date",
            "scheduled_time",
            "duration_minutes",
            "status",
            "agenda",
            "minutes",
            "attendees",
            "action_items",
            "conducted_by",
            "org",
            "org_uid",
            "created_by_detail",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "uid", "org_uid", "created_by_detail", "created_at", "updated_at"]


class PaceChecklistSerializer(OrgScopedMixin, serializers.ModelSerializer):
    updated_by_detail = UserMinSerializer(source="updated_by", read_only=True)
    org_uid = serializers.UUIDField(source="org.uid", read_only=True, allow_null=True)

    org = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Org.objects.all(),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = PaceChecklist
        fields = [
            "id",
            "uid",
            "fy",
            "week_number",
            "item_number",
            "action_item",
            "done",
            "notes",
            "updated_by_detail",
            "org",
            "org_uid",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "uid", "updated_by_detail", "org_uid", "created_at", "updated_at"]


class ClientClassificationSerializer(OrgScopedMixin, serializers.ModelSerializer):
    client_detail = MasterMinSerializer(source="client", read_only=True)
    updated_by_detail = UserMinSerializer(source="updated_by", read_only=True)
    org_uid = serializers.UUIDField(source="org.uid", read_only=True, allow_null=True)

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
        model = ClientClassification
        fields = [
            "id",
            "uid",
            "client",
            "client_detail",
            "classification",
            "revenue_tier",
            "strategic_importance",
            "relationship_health",
            "growth_potential",
            "risk_level",
            "notes",
            "updated_by_detail",
            "org",
            "org_uid",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "uid",
            "client_detail",
            "updated_by_detail",
            "org_uid",
            "created_at",
            "updated_at",
        ]
