from django.urls import reverse
from rest_framework import serializers

from core.masters.models import Master
from core.masters.serializers import MasterMinSerializer
from core.serializers import UserMinSerializer

from .models import ConveyanceAttachment, ConveyanceEntry
from .recurrence import period_dates  # noqa: F401


class ConveyanceAttachmentSerializer(serializers.ModelSerializer):
    uploaded_by_detail = UserMinSerializer(source="uploaded_by", read_only=True)
    file_url = serializers.SerializerMethodField()
    filename = serializers.SerializerMethodField()

    class Meta:
        model = ConveyanceAttachment
        fields = [
            "id",
            "uid",
            "label",
            "file",
            "file_url",
            "filename",
            "uploaded_by_detail",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "uid",
            "file_url",
            "filename",
            "uploaded_by_detail",
            "created_at",
        ]
        extra_kwargs = {"file": {"write_only": True, "required": False}}

    def get_filename(self, obj):
        if not obj.file:
            return None
        return obj.file.name.rsplit("/", 1)[-1]

    def get_file_url(self, obj):
        if not obj.file:
            return None
        # Same-origin relative path. The browser resolves it against the
        # current page origin (which always carries the right port), so the
        # link works regardless of whether nginx forwards Host with the
        # external port — see DEVELOPMENT.md §7.6.
        return reverse("conveyanceattachment-download", kwargs={"uid": str(obj.uid)})


class ConveyanceEntrySerializer(serializers.ModelSerializer):
    employee_detail = UserMinSerializer(source="employee", read_only=True)
    client_detail = MasterMinSerializer(source="client", read_only=True)
    reviewed_by_detail = UserMinSerializer(source="reviewed_by", read_only=True)
    created_by_detail = UserMinSerializer(source="created_by", read_only=True)
    attachments = ConveyanceAttachmentSerializer(many=True, read_only=True)
    employee_uid = serializers.UUIDField(write_only=True, required=False)

    client = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Master.objects.filter(type="client"),
    )

    class Meta:
        model = ConveyanceEntry
        fields = [
            "id",
            "uid",
            "date",
            "employee",
            "employee_detail",
            "employee_uid",
            "client",
            "client_detail",
            "reason",
            "amount",
            "claimable",
            "frequency",
            "series_uid",
            "start_month",
            "end_month",
            "status",
            "review_note",
            "reviewed_by_detail",
            "reviewed_at",
            "attachments",
            "created_by_detail",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "uid",
            "series_uid",
            "employee",
            "employee_detail",
            "client_detail",
            "status",
            "review_note",
            "reviewed_by_detail",
            "reviewed_at",
            "attachments",
            "created_by_detail",
            "created_at",
            "updated_at",
        ]

    def create(self, validated_data):
        validated_data.pop("employee_uid", None)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        # Frequency / series_uid / start_month / end_month are immutable once
        # the row exists. Silently dropping is friendlier than 400ing because
        # the frontend will sometimes resend the full row; the server is the
        # source of truth.
        for k in ("frequency", "start_month", "end_month"):
            validated_data.pop(k, None)
        return super().update(instance, validated_data)

    def validate_date(self, value):
        from django.utils import timezone

        # Future-date rule applies only to one-time entries; the materialiser
        # handles the window check for recurring submissions.
        if self.initial_data.get("frequency", "one_time") != "one_time":
            return value
        if value > timezone.localdate():
            raise serializers.ValidationError("Date cannot be in the future")
        return value

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be greater than zero")
        if value > 9_999_999_999.99:
            raise serializers.ValidationError("Amount is too large")
        return value

    def validate_reason(self, value):
        stripped = (value or "").strip()
        if len(stripped) < 3:
            raise serializers.ValidationError("Reason must be at least 3 characters")
        return stripped

    def validate_client(self, value):
        # ``SlugRelatedField`` already filters to type=client. Also guarantee
        # the client belongs to one of the caller's orgs.
        request = self.context.get("request")
        if request is not None:
            user = request.user
            caller_org_ids = set(user.org_ids()) if hasattr(user, "org_ids") else set()
            client_org_ids = set(value.orgs.values_list("id", flat=True))
            if value.org_id is not None:
                client_org_ids.add(value.org_id)
            if not (caller_org_ids & client_org_ids):
                raise serializers.ValidationError("Client is not in your organisation")
        return value

    def validate(self, attrs):
        frequency = attrs.get("frequency", getattr(self.instance, "frequency", "one_time"))
        start_month = attrs.get("start_month")
        end_month = attrs.get("end_month")

        if frequency == "one_time":
            if start_month or end_month:
                raise serializers.ValidationError({
                    "start_month": "Only set start_month / end_month for recurring entries.",
                })
            return attrs

        # Recurring: both months required, end >= start, normalise to 1st.
        missing = {}
        if not start_month:
            missing["start_month"] = "Required for recurring entries."
        if not end_month:
            missing["end_month"] = "Required for recurring entries."
        if missing:
            raise serializers.ValidationError(missing)

        start_norm = start_month.replace(day=1)
        end_norm = end_month.replace(day=1)
        if end_norm < start_norm:
            raise serializers.ValidationError({
                "end_month": "End month must be on or after start month.",
            })

        attrs["start_month"] = start_norm
        attrs["end_month"] = end_norm
        return attrs
