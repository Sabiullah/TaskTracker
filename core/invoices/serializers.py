from decimal import Decimal

from django.urls import reverse
from rest_framework import serializers

from core.masters.models import Master
from core.masters.serializers import MasterMinSerializer
from core.realtime import broadcast
from core.serializers import UserMinSerializer
from users.models import Org

from .models import (
    InvoiceCategory,
    InvoiceEntry,
    InvoiceEntryCategory,
    InvoiceEntryCategoryOwner,
    InvoicePlan,
    InvoicePlanCategory,
    InvoicePlanCategoryOwner,
)


def _validate_pct_list(items, *, key_field, label):
    """Validate one ``contribution_pct`` list.

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
            raise serializers.ValidationError({label: f"each item needs '{key_field}' and 'contribution_pct'"})
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
        raise serializers.ValidationError({label: f"contribution_pct must sum to 100.00 (got {total})"})
    return items


def _validate_categories_with_owners(items, label):
    """Validate ``default_categories`` / ``categories`` payload.

    The outer list's ``contribution_pct`` must sum to 100. Each entry may
    carry an ``owners`` list whose ``contribution_pct`` also sums to 100
    (or is empty — empty owners means "no attribution for this slice",
    same as having no owners on the plan today).
    """
    if not items:
        return []
    _validate_pct_list(items, key_field="category_uid", label=label)
    for cat in items:
        owners = cat.get("owners") or []
        if owners:
            cat_uid = cat.get("category_uid")
            _validate_pct_list(owners, key_field="user_uid", label=f"{label}[{cat_uid}].owners")
    return items


def _serialize_category_links(links):
    """Render category links + their nested owner_links to wire format.

    ``links`` should already be prefetched with ``category`` and
    ``owner_links__user`` to avoid N+1.
    """
    out = []
    for link in links:
        owners = []
        for ol in link.owner_links.all():
            owners.append(
                {
                    "user_uid": str(ol.user.uid),
                    "user_name": ol.user.full_name or ol.user.username,
                    "contribution_pct": str(ol.contribution_pct),
                }
            )
        out.append(
            {
                "category_uid": str(link.category.uid),
                "category_name": link.category.name,
                "color": link.category.color,
                "contribution_pct": str(link.contribution_pct),
                "owners": owners,
            }
        )
    return out


class InvoiceEntrySerializer(serializers.ModelSerializer):
    uploaded_by_detail = UserMinSerializer(source="uploaded_by", read_only=True)
    approved_by_detail = UserMinSerializer(source="approved_by", read_only=True)
    file_url = serializers.SerializerMethodField()
    # Surface the stored basename so the frontend can render a meaningful
    # label. The download URL ends in ``.../download/`` so you can't
    # split-and-pop it to recover the filename client-side.
    file_name = serializers.SerializerMethodField()
    categories = serializers.SerializerMethodField()

    class Meta:
        model = InvoiceEntry
        fields = [
            "id",
            "uid",
            "invoice_month",
            "invoice_date",
            "amount",
            "status",
            "project_status",
            "invoice_number",
            "notes",
            "file",
            "file_url",
            "file_name",
            "rejection_reason",
            "categories",
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
            "categories",
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

    def get_categories(self, obj):
        return _serialize_category_links(
            obj.category_links.select_related("category").prefetch_related("owner_links__user").all()
        )

    def validate(self, attrs):
        attrs = super().validate(attrs)
        cats = self.initial_data.get("categories")
        if cats is not None:
            _validate_categories_with_owners(cats, label="categories")
            attrs["_categories"] = cats
        return attrs

    def _sync_links(self, entry, cats):
        from users.models import User as _User

        if cats is None:
            return
        entry.category_links.all().delete()
        for item in cats:
            cat = InvoiceCategory.objects.get(uid=item["category_uid"])
            link = InvoiceEntryCategory.objects.create(
                entry=entry, category=cat, contribution_pct=Decimal(str(item["contribution_pct"]))
            )
            for owner in item.get("owners") or []:
                user = _User.objects.get(uid=owner["user_uid"])
                InvoiceEntryCategoryOwner.objects.create(
                    entry_category=link,
                    user=user,
                    contribution_pct=Decimal(str(owner["contribution_pct"])),
                )

    def update(self, instance, validated_data):
        cats = validated_data.pop("_categories", None)
        entry = super().update(instance, validated_data)
        self._sync_links(entry, cats)
        return entry

    def create(self, validated_data):
        cats = validated_data.pop("_categories", None)
        entry = super().create(validated_data)
        self._sync_links(entry, cats)
        return entry


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
        return _serialize_category_links(
            obj.category_links.select_related("category").prefetch_related("owner_links__user").all()
        )

    def validate(self, attrs):
        attrs = super().validate(attrs)
        # Pull from initial_data because the SerializerMethodField is
        # read-only — write data lives on initial_data, not attrs.
        cats = self.initial_data.get("default_categories", [])
        _validate_categories_with_owners(cats, label="default_categories")
        attrs["_default_categories"] = cats
        return attrs

    def _sync_links(self, plan, cats):
        from users.models import User as _User

        # Replace-all semantics. CASCADE on InvoicePlanCategory clears
        # nested ``InvoicePlanCategoryOwner`` rows automatically.
        plan.category_links.all().delete()
        for item in cats:
            cat = InvoiceCategory.objects.get(uid=item["category_uid"])
            link = InvoicePlanCategory.objects.create(
                plan=plan, category=cat, contribution_pct=Decimal(str(item["contribution_pct"]))
            )
            for owner in item.get("owners") or []:
                user = _User.objects.get(uid=owner["user_uid"])
                InvoicePlanCategoryOwner.objects.create(
                    plan_category=link,
                    user=user,
                    contribution_pct=Decimal(str(owner["contribution_pct"])),
                )

    def create(self, validated_data):
        cats = validated_data.pop("_default_categories", [])
        plan = super().create(validated_data)
        self._sync_links(plan, cats)
        return plan

    def update(self, instance, validated_data):
        cats = validated_data.pop("_default_categories", None)
        plan = super().update(instance, validated_data)
        # Only sync if the field was provided in the request payload —
        # PATCHes that don't mention attribution leave the existing rows.
        attribution_changed = "default_categories" in self.initial_data
        project_status_changed = "project_status" in self.initial_data
        if attribution_changed:
            self._sync_links(plan, cats or [])
        if attribution_changed or project_status_changed:
            self._propagate_to_safe_entries(
                plan,
                sync_attribution=attribution_changed,
                sync_project_status=project_status_changed,
            )
        return plan

    def _propagate_to_safe_entries(
        self,
        plan,
        *,
        sync_attribution: bool,
        sync_project_status: bool,
    ):
        """Push the plan's current attribution / project_status onto entries.

        - Attribution propagates to **every** entry tied to this plan, regardless
          of status (Pending / Uploaded / Approved / Rejected). When a user edits
          a plan's category & owner mapping, that becomes the new ground truth
          for every invoice in the plan's period — per-entry overrides made via
          ``AmountEditModal`` are intentionally overwritten.
        - project_status only flows to Pending entries (preserves manual
          approval / rejection state on entries that are already past Pending).
        """
        pending_qs = InvoiceEntry.objects.filter(plan=plan, status="Pending")

        if sync_project_status:
            for entry in pending_qs:
                entry.project_status = plan.project_status
                entry.save(update_fields=["project_status"])

        touched: set[int] = set()

        if sync_attribution:
            cat_links = list(plan.category_links.select_related("category").prefetch_related("owner_links__user"))

            for entry in InvoiceEntry.objects.filter(plan=plan):
                entry.category_links.all().delete()
                for plan_link in cat_links:
                    entry_link = InvoiceEntryCategory.objects.create(
                        entry=entry,
                        category=plan_link.category,
                        contribution_pct=plan_link.contribution_pct,
                    )
                    for ol in plan_link.owner_links.all():
                        InvoiceEntryCategoryOwner.objects.create(
                            entry_category=entry_link,
                            user=ol.user,
                            contribution_pct=ol.contribution_pct,
                        )
                touched.add(entry.id)

        if sync_project_status and not sync_attribution:
            # We already saved project_status above; record those as touched
            # so we broadcast them.
            touched.update(e.id for e in pending_qs)

        if touched:
            # Refetch with related data so the broadcast payload is complete.
            broadcast_entries = InvoiceEntry.objects.filter(id__in=touched).select_related("uploaded_by", "approved_by")
            request = self.context.get("request")
            for entry in broadcast_entries:
                broadcast(
                    "invoice-entries",
                    "UPDATE",
                    InvoiceEntrySerializer(entry, context={"request": request}).data,
                )
