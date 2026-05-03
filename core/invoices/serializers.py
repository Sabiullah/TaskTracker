from decimal import Decimal

from django.urls import reverse
from rest_framework import serializers

from core.masters.models import Master
from core.masters.serializers import MasterMinSerializer
from core.serializers import UserMinSerializer
from users.models import Org

from .models import (
    InvoiceCategory,
    InvoiceEntry,
    InvoiceEntryCategory,
    InvoiceEntryOwner,
    InvoicePlan,
    InvoicePlanCategory,
    InvoicePlanOwner,
)


def _validate_pct_list(items, *, key_field, label):
    """Shared validator for the four attribution lists.

    ``key_field`` is ``'category_uid'`` or ``'user_uid'``. Returns the
    cleaned list. Raises ``serializers.ValidationError`` with a list of
    field-level messages on failure.
    """
    if not items:
        return []
    seen = set()
    total = Decimal("0")
    for entry in items:
        key = entry.get(key_field)
        pct_raw = entry.get("contribution_pct")
        if key is None or pct_raw is None:
            raise serializers.ValidationError(
                {label: f"each item needs '{key_field}' and 'contribution_pct'"}
            )
        if key in seen:
            raise serializers.ValidationError({label: f"duplicate {key_field}: {key}"})
        seen.add(key)
        try:
            pct = Decimal(str(pct_raw))
        except Exception:
            raise serializers.ValidationError({label: f"invalid contribution_pct: {pct_raw}"}) from None
        if pct <= 0 or pct > 100:
            raise serializers.ValidationError({label: "contribution_pct must be in (0, 100]"})
        total += pct
    if total != Decimal("100.00"):
        raise serializers.ValidationError(
            {label: f"contribution_pct must sum to 100.00 (got {total})"}
        )
    return items


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


class InvoicePlanSerializer(serializers.ModelSerializer):
    client_detail = MasterMinSerializer(source="client", read_only=True)
    created_by_detail = UserMinSerializer(source="created_by", read_only=True)
    entries = InvoiceEntrySerializer(many=True, read_only=True)
    default_categories = serializers.SerializerMethodField()
    default_owners = serializers.SerializerMethodField()

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
            "project_status",
            "default_categories",
            "default_owners",
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

    def get_default_categories(self, obj):
        return [
            {
                "category_uid": str(link.category.uid),
                "category_name": link.category.name,
                "color": link.category.color,
                "contribution_pct": str(link.contribution_pct),
            }
            for link in obj.category_links.select_related("category").all()
        ]

    def get_default_owners(self, obj):
        return [
            {
                "user_uid": str(link.user.uid),
                "user_name": link.user.full_name or link.user.username,
                "contribution_pct": str(link.contribution_pct),
            }
            for link in obj.owner_links.select_related("user").all()
        ]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        # Pull from initial_data because the SerializerMethodField is
        # read-only — write data lives on initial_data, not attrs.
        cats = self.initial_data.get("default_categories", [])
        owns = self.initial_data.get("default_owners", [])
        _validate_pct_list(cats, key_field="category_uid", label="default_categories")
        _validate_pct_list(owns, key_field="user_uid", label="default_owners")
        attrs["_default_categories"] = cats
        attrs["_default_owners"] = owns
        return attrs

    def _sync_links(self, plan, cats, owns):
        from users.models import User as _User

        # Replace-all semantics.
        plan.category_links.all().delete()
        for item in cats:
            cat = InvoiceCategory.objects.get(uid=item["category_uid"])
            InvoicePlanCategory.objects.create(
                plan=plan, category=cat, contribution_pct=Decimal(str(item["contribution_pct"]))
            )
        plan.owner_links.all().delete()
        for item in owns:
            user = _User.objects.get(uid=item["user_uid"])
            InvoicePlanOwner.objects.create(
                plan=plan, user=user, contribution_pct=Decimal(str(item["contribution_pct"]))
            )

    def create(self, validated_data):
        cats = validated_data.pop("_default_categories", [])
        owns = validated_data.pop("_default_owners", [])
        plan = super().create(validated_data)
        self._sync_links(plan, cats, owns)
        return plan

    def update(self, instance, validated_data):
        cats = validated_data.pop("_default_categories", None)
        owns = validated_data.pop("_default_owners", None)
        plan = super().update(instance, validated_data)
        # Only sync if the field was provided in the request payload —
        # PATCHes that don't mention attribution leave the existing rows.
        if "default_categories" in self.initial_data or "default_owners" in self.initial_data:
            self._sync_links(plan, cats or [], owns or [])
        return plan
