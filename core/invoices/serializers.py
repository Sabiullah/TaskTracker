from django.urls import reverse
from rest_framework import serializers

from core.masters.models import Master
from core.masters.serializers import MasterMinSerializer
from core.serializers import UserMinSerializer
from users.models import Org

from .models import InvoiceCategory, InvoiceEntry, InvoicePlan


class InvoiceEntrySerializer(serializers.ModelSerializer):
    uploaded_by_detail = UserMinSerializer(source="uploaded_by", read_only=True)
    approved_by_detail = UserMinSerializer(source="approved_by", read_only=True)
    file_url = serializers.SerializerMethodField()
    # Surface the stored basename so the frontend can render a meaningful
    # label. The download URL ends in ``.../download/`` so you can't
    # split-and-pop it to recover the filename client-side.
    file_name = serializers.SerializerMethodField()

    class Meta:
        model = InvoiceEntry
        fields = [
            "id",
            "uid",
            "invoice_month",
            "invoice_date",
            "amount",
            "status",
            "invoice_number",
            "notes",
            "file",
            "file_url",
            "file_name",
            "rejection_reason",
            "uploaded_by_detail",
            "uploaded_at",
            "approved_by_detail",
            "approved_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "uid",
            "file_url",
            "file_name",
            "uploaded_by_detail",
            "uploaded_at",
            "approved_by_detail",
            "approved_at",
            "created_at",
            "updated_at",
        ]
        extra_kwargs = {"file": {"write_only": True}}

    def get_file_name(self, obj):
        if not obj.file:
            return None
        return obj.file.name.rsplit("/", 1)[-1]

    def get_file_url(self, obj):
        # Short auth-gated URL — ``/api/invoice_entries/<uid>/download/``.
        # The endpoint is protected by ``IsAuthenticated`` and scoped to
        # the caller's orgs, so no token/signature is needed in the URL.
        if not obj.file:
            return None
        path = reverse("invoiceentry-download", kwargs={"uid": str(obj.uid)})
        request = self.context.get("request")
        return request.build_absolute_uri(path) if request else path


class InvoicePlanSerializer(serializers.ModelSerializer):
    client_detail = MasterMinSerializer(source="client", read_only=True)
    created_by_detail = UserMinSerializer(source="created_by", read_only=True)
    entries = InvoiceEntrySerializer(many=True, read_only=True)

    client = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Master.objects.filter(type="client"),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = InvoicePlan
        fields = [
            "id",
            "uid",
            "serial_no",
            "client",
            "client_detail",
            "job_description",
            "periodicity",
            "start_month",
            "end_month",
            "invoice_day",
            "base_amount",
            "entries",
            "created_by_detail",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "uid",
            "serial_no",
            "client_detail",
            "created_by_detail",
            "entries",
            "created_at",
            "updated_at",
        ]


class InvoiceCategorySerializer(serializers.ModelSerializer):
    org = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Org.objects.all(),
    )

    class Meta:
        model = InvoiceCategory
        fields = [
            "id",
            "uid",
            "name",
            "org",
            "color",
            "is_active",
            "sort_order",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "uid", "created_at", "updated_at"]
