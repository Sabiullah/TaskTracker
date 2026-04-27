from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import serializers

from core.serializers import OrgScopedMixin, UserMinSerializer
from users.models import Org

from .models import (
    ClientActionPoint,
    ClientActionPointAttachment,
    ClientMeeting,
    ClientMeetingAttachment,
    ClientRoadmap,
    ClientVisit,
    Master,
    VisitReport,
    VisitReportAuditEvent,
    is_visit_overdue,
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
        # Auth-gated path served by ``ClientMeetingAttachmentViewSet.download``.
        # Returning ``obj.file.url`` (``/media/...``) doesn't work because the
        # frontend's ``openAuthenticatedFile`` re-prefixes ``/api`` to whatever
        # path it gets, and ``/api/media/...`` isn't a valid route.
        if not obj.file:
            return ""
        path = reverse("client-attachment-download", kwargs={"uid": str(obj.uid)})
        request = (self.context or {}).get("request")
        return request.build_absolute_uri(path) if request else path


class ClientActionPointAttachmentSerializer(serializers.ModelSerializer):
    uploaded_by_detail = UserMinSerializer(source="uploaded_by", read_only=True)
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = ClientActionPointAttachment
        fields = [
            "id",
            "uid",
            "action_point",
            "filename",
            "size_bytes",
            "uploaded_by_detail",
            "uploaded_at",
            "download_url",
        ]
        read_only_fields = fields

    def get_download_url(self, obj):
        if not obj.file:
            return ""
        path = reverse("client-ap-attachment-download", kwargs={"uid": str(obj.uid)})
        request = (self.context or {}).get("request")
        return request.build_absolute_uri(path) if request else path


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
    attachments = ClientActionPointAttachmentSerializer(many=True, read_only=True)

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
            "attachments",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "uid",
            "responsibility_detail",
            "attachments",
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


class VisitReportAuditEventSerializer(serializers.ModelSerializer):
    actor_detail = UserMinSerializer(source="actor", read_only=True)
    report_uid = serializers.UUIDField(source="report.uid", read_only=True, allow_null=True)
    visit_uid = serializers.UUIDField(source="visit.uid", read_only=True)

    class Meta:
        model = VisitReportAuditEvent
        fields = [
            "id",
            "uid",
            "visit_uid",
            "report_uid",
            "event_type",
            "actor_detail",
            "comment",
            "created_at",
        ]
        read_only_fields = fields


class VisitReportSerializer(serializers.ModelSerializer):
    created_by_detail = UserMinSerializer(source="created_by", read_only=True)
    reviewed_by_detail = UserMinSerializer(source="reviewed_by", read_only=True)
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = VisitReport
        fields = [
            "id",
            "uid",
            "visit",
            "revision_number",
            "key_points",
            "attachment_filename",
            "attachment_size_bytes",
            "status",
            "submitted_at",
            "reviewed_at",
            "reviewed_by_detail",
            "manager_comment",
            "created_by_detail",
            "created_at",
            "updated_at",
            "download_url",
        ]
        read_only_fields = [
            "id",
            "uid",
            "visit",
            "revision_number",
            "attachment_filename",
            "attachment_size_bytes",
            "status",
            "submitted_at",
            "reviewed_at",
            "reviewed_by_detail",
            "manager_comment",
            "created_by_detail",
            "created_at",
            "updated_at",
            "download_url",
        ]

    def get_download_url(self, obj):
        if not obj.observation_attachment:
            return ""
        path = reverse("visit-report-attachment-download", kwargs={"uid": str(obj.uid)})
        request = (self.context or {}).get("request")
        return request.build_absolute_uri(path) if request else path


class ClientVisitSerializer(OrgScopedMixin, serializers.ModelSerializer):
    org = serializers.SlugRelatedField(slug_field="uid", queryset=Org.objects.all(), required=False, allow_null=True)
    org_uid = serializers.UUIDField(source="org.uid", read_only=True, allow_null=True)
    client = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Master.objects.filter(type="client"),
    )
    client_detail = MasterMinSerializer(source="client", read_only=True)
    prepared_by = serializers.SlugRelatedField(
        slug_field="uid", queryset=User.objects.all(), required=False, allow_null=True
    )
    prepared_by_detail = UserMinSerializer(source="prepared_by", read_only=True)
    assigned_manager = serializers.SlugRelatedField(slug_field="uid", queryset=User.objects.all())
    assigned_manager_detail = UserMinSerializer(source="assigned_manager", read_only=True)
    created_by_detail = UserMinSerializer(source="created_by", read_only=True)
    reports = VisitReportSerializer(many=True, read_only=True)
    audit_events = VisitReportAuditEventSerializer(many=True, read_only=True)
    is_overdue = serializers.SerializerMethodField()

    class Meta:
        model = ClientVisit
        fields = [
            "id",
            "uid",
            "org",
            "org_uid",
            "client",
            "client_detail",
            "visit_date",
            "prepared_by",
            "prepared_by_detail",
            "assigned_manager",
            "assigned_manager_detail",
            "current_status",
            "report_sent_date",
            "voice_note_sent",
            "voice_note_summary",
            "created_by_detail",
            "reports",
            "audit_events",
            "is_overdue",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "uid",
            "org_uid",
            "client_detail",
            "prepared_by_detail",
            "assigned_manager_detail",
            "current_status",
            "created_by_detail",
            "reports",
            "audit_events",
            "is_overdue",
            "created_at",
            "updated_at",
        ]

    def get_is_overdue(self, obj) -> bool:
        return is_visit_overdue(obj)

    def validate_assigned_manager(self, value):
        """Assigned manager must be admin/manager in the visit's org."""
        # Org isn't bound yet on create — defer the org check to validate(); for
        # update, ``self.instance.org`` is the source of truth.
        request = (self.context or {}).get("request")
        if request and self.instance is not None:
            target_org = self.instance.org
            if target_org and not value.is_manager_in(target_org):
                raise serializers.ValidationError(
                    "Assigned manager must be admin or manager in this org."
                )
        return value

    def validate(self, attrs):
        # On create, cross-check assigned_manager against the resolved org from
        # the request (resolve_create_org is called in the viewset's
        # perform_create). Re-resolve here so the error fires before save.
        if self.instance is None:
            from core.org_utils import resolve_create_org

            request = (self.context or {}).get("request")
            if request is not None:
                org, _err = resolve_create_org(request)
                manager = attrs.get("assigned_manager")
                if org and manager and not manager.is_manager_in(org):
                    raise serializers.ValidationError(
                        {"assigned_manager": "Must be admin or manager in this org."}
                    )
        return super().validate(attrs)
