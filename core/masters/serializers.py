from django.contrib.auth import get_user_model
from rest_framework import serializers

from core.serializers import OrgScopedMixin, UserMinSerializer
from users.models import Org

from .models import (
    ClientActionPoint,
    ClientMeeting,
    ClientMeetingAttachment,
    ClientRoadmap,
    Master,
)

User = get_user_model()


class MasterMinSerializer(serializers.ModelSerializer):
    """Lightweight Master for nested FK reads."""

    class Meta:
        model = Master
        fields = ["id", "uid", "name", "type", "color"]


class MasterSerializer(OrgScopedMixin, serializers.ModelSerializer):
    org_uid = serializers.UUIDField(source="org.uid", read_only=True, allow_null=True)
    created_by_uid = serializers.UUIDField(source="created_by.uid", read_only=True, allow_null=True)

    # Legacy single-org FK — kept writable so existing callers that send
    # ``{"org": "<uid>"}`` still work. New flows should send ``orgs``.
    org = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Org.objects.all(),
        required=False,
        allow_null=True,
    )
    # Multi-org membership. The frontend's master modal posts an array of
    # org uids; ``to_internal_value`` on SlugRelatedField does the lookup.
    orgs = serializers.SlugRelatedField(
        many=True,
        slug_field="uid",
        queryset=Org.objects.all(),
        required=False,
    )

    class Meta:
        model = Master
        fields = [
            "id",
            "uid",
            "name",
            "type",
            "color",
            "is_active",
            "sort_order",
            "org",
            "org_uid",
            "orgs",
            "created_by_uid",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "uid", "org_uid", "created_by_uid", "created_at", "updated_at"]

    def validate_orgs(self, value):
        """Every org in the list must be one the caller belongs to.

        Mirrors ``OrgScopedMixin.validate_org`` but for the M2M side —
        without this, a caller could write a client across into an org
        they aren't a member of by stuffing its uid into the ``orgs``
        array even if the single ``org`` FK is fine.
        """
        request = (self.context or {}).get("request")
        user = getattr(request, "user", None) if request else None
        if not (user and user.is_authenticated):
            return value
        member_ids = set(user.org_ids())
        if not member_ids:
            return value
        bad = [o.pk for o in value if o.pk not in member_ids]
        if bad:
            raise serializers.ValidationError(
                "Every org must be one the authenticated user is a member of.",
            )
        return value

    def create(self, validated_data):
        orgs = validated_data.pop("orgs", None)
        obj = super().create(validated_data)
        if orgs is not None:
            obj.orgs.set(orgs)
        # Mirror the legacy FK onto the M2M so queries that still use the
        # old ``org`` filter keep seeing the row.
        if obj.org_id and not obj.orgs.filter(id=obj.org_id).exists():
            obj.orgs.add(obj.org_id)
        return obj

    def update(self, instance, validated_data):
        orgs = validated_data.pop("orgs", None)
        obj = super().update(instance, validated_data)
        if orgs is not None:
            obj.orgs.set(orgs)
        if obj.org_id and not obj.orgs.filter(id=obj.org_id).exists():
            obj.orgs.add(obj.org_id)
        return obj


class ClientRoadmapSerializer(OrgScopedMixin, serializers.ModelSerializer):
    org = serializers.SlugRelatedField(slug_field="uid", queryset=Org.objects.all(), required=False, allow_null=True)
    org_uid = serializers.UUIDField(source="org.uid", read_only=True, allow_null=True)
    client = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Master.objects.filter(type="client"),
        required=False,
        allow_null=True,
    )
    client_detail = MasterMinSerializer(source="client", read_only=True)
    owner = serializers.SlugRelatedField(slug_field="uid", queryset=User.objects.all(), required=False, allow_null=True)
    owner_detail = UserMinSerializer(source="owner", read_only=True)
    created_by_detail = UserMinSerializer(source="created_by", read_only=True)

    class Meta:
        model = ClientRoadmap
        fields = [
            "id",
            "uid",
            "org",
            "org_uid",
            "client",
            "client_detail",
            "title",
            "description",
            "owner",
            "owner_detail",
            "start_date",
            "target_date",
            "expected_date",
            "completion_date",
            "status",
            "priority",
            "progress_notes",
            "category",
            "created_by_detail",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "uid",
            "org_uid",
            "client_detail",
            "owner_detail",
            "created_by_detail",
            "created_at",
            "updated_at",
        ]


class ClientMeetingAttachmentSerializer(serializers.ModelSerializer):
    uploaded_by_detail = UserMinSerializer(source="uploaded_by", read_only=True)
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = ClientMeetingAttachment
        fields = [
            "id",
            "uid",
            "meeting",
            "filename",
            "size_bytes",
            "uploaded_by_detail",
            "uploaded_at",
            "download_url",
        ]
        read_only_fields = fields

    def get_download_url(self, obj):
        try:
            return obj.file.url
        except ValueError:
            return ""


class ClientActionPointSerializer(serializers.ModelSerializer):
    responsibility = serializers.SlugRelatedField(
        slug_field="uid", queryset=User.objects.all(), required=False, allow_null=True
    )
    responsibility_detail = UserMinSerializer(source="responsibility", read_only=True)
    roadmap_link = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=ClientRoadmap.objects.all(),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = ClientActionPoint
        fields = [
            "id",
            "uid",
            "meeting",
            "description",
            "responsibility",
            "responsibility_detail",
            "target_date",
            "completion_date",
            "status",
            "priority",
            "remarks",
            "roadmap_link",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "uid",
            "responsibility_detail",
            "created_at",
            "updated_at",
        ]


class ClientMeetingSerializer(OrgScopedMixin, serializers.ModelSerializer):
    org = serializers.SlugRelatedField(slug_field="uid", queryset=Org.objects.all(), required=False, allow_null=True)
    org_uid = serializers.UUIDField(source="org.uid", read_only=True, allow_null=True)
    client = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Master.objects.filter(type="client"),
        required=False,
        allow_null=True,
    )
    client_detail = MasterMinSerializer(source="client", read_only=True)
    conducted_by = serializers.SlugRelatedField(
        slug_field="uid", queryset=User.objects.all(), required=False, allow_null=True
    )
    conducted_by_detail = UserMinSerializer(source="conducted_by", read_only=True)
    our_attendees = serializers.SlugRelatedField(
        slug_field="uid", queryset=User.objects.all(), many=True, required=False
    )
    our_attendees_detail = UserMinSerializer(source="our_attendees", many=True, read_only=True)
    created_by_detail = UserMinSerializer(source="created_by", read_only=True)
    action_points = ClientActionPointSerializer(many=True, read_only=True)
    attachments = ClientMeetingAttachmentSerializer(many=True, read_only=True)

    class Meta:
        model = ClientMeeting
        fields = [
            "id",
            "uid",
            "org",
            "org_uid",
            "client",
            "client_detail",
            "meeting_date",
            "meeting_time",
            "meeting_type",
            "mode",
            "venue",
            "conducted_by",
            "conducted_by_detail",
            "our_attendees",
            "our_attendees_detail",
            "client_attendees",
            "agenda",
            "minutes",
            "next_meeting_date",
            "action_points",
            "attachments",
            "created_by_detail",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "uid",
            "org_uid",
            "client_detail",
            "conducted_by_detail",
            "our_attendees_detail",
            "action_points",
            "attachments",
            "created_by_detail",
            "created_at",
            "updated_at",
        ]
