from django.urls import reverse
from rest_framework import serializers

from core.masters.models import Master
from core.masters.serializers import MasterMinSerializer
from core.serializers import UserMinSerializer

from .models import ConveyanceAttachment, ConveyanceEntry


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
        path = reverse("conveyanceattachment-download", kwargs={"uid": str(obj.uid)})
        request = self.context.get("request")
        return request.build_absolute_uri(path) if request else path


class ConveyanceEntrySerializer(serializers.ModelSerializer):
    employee_detail = UserMinSerializer(source="employee", read_only=True)
    client_detail = MasterMinSerializer(source="client", read_only=True)
    reviewed_by_detail = UserMinSerializer(source="reviewed_by", read_only=True)
    created_by_detail = UserMinSerializer(source="created_by", read_only=True)
    attachments = ConveyanceAttachmentSerializer(many=True, read_only=True)

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
            "client",
            "client_detail",
            "reason",
            "amount",
            "claimable",
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
