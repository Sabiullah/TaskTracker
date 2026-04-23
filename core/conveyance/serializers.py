from django.urls import reverse
from rest_framework import serializers

from core.serializers import UserMinSerializer

from .models import ConveyanceAttachment


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
