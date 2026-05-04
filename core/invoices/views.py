from collections import defaultdict
from decimal import Decimal
from typing import cast

from django.utils import timezone
from rest_framework import permissions
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.filestore.validators import safe_filename, validate_upload
from core.org_utils import resolve_create_org, scoped
from core.permissions import IsAdmin
from core.realtime import broadcast
from users.models import User

from .models import (
    InvoiceCategory,
    InvoiceEntry,
    InvoiceEntryCategory,
    InvoiceEntryOwner,
    InvoicePlan,
)
from .serializers import InvoiceCategorySerializer, InvoiceEntrySerializer, InvoicePlanSerializer


def _raise_from_response(err):
    exc_cls = PermissionDenied if err.status_code == 403 else ValidationError
    raise exc_cls(err.data)


class InvoicePlanViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = InvoicePlanSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = scoped(
            InvoicePlan.objects.select_related("client", "created_by").prefetch_related("entries"),
            user,
        )
        client_uid = self.request.query_params.get("client_uid")
        if client_uid:
            qs = qs.filter(client__uid=client_uid)
        return qs

    def perform_create(self, serializer):
        org, err = resolve_create_org(self.request)
        if err is not None:
            _raise_from_response(err)
        obj = serializer.save(created_by=self.request.user, org=org)
        broadcast(
            "invoice-plans",
            "INSERT",
            InvoicePlanSerializer(obj, context={"request": self.request}).data,
        )

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast(
            "invoice-plans",
            "UPDATE",
            InvoicePlanSerializer(obj, context={"request": self.request}).data,
        )

    def perform_destroy(self, instance):
        broadcast("invoice-plans", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()


class InvoiceEntryViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = InvoiceEntrySerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = cast(User, self.request.user)
        # Entries inherit org visibility from their parent InvoicePlan.
        qs = InvoiceEntry.objects.select_related("plan", "uploaded_by", "approved_by").filter(
            plan__org_id__in=user.org_ids()
        )
        plan_uid = self.request.query_params.get("plan_uid")
        status = self.request.query_params.get("status")
        month = self.request.query_params.get("month")
        if plan_uid:
            qs = qs.filter(plan__uid=plan_uid)
        if status:
            qs = qs.filter(status=status)
        if month:
            qs = qs.filter(invoice_month__startswith=month)
        project_status = self.request.query_params.get("project_status")
        if project_status:
            qs = qs.filter(project_status=project_status)
        return qs

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "request": self.request}

    def perform_create(self, serializer):
        obj = serializer.save()
        broadcast(
            "invoice-entries",
            "INSERT",
            InvoiceEntrySerializer(obj, context={"request": self.request}).data,
        )

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast(
            "invoice-entries",
            "UPDATE",
            InvoiceEntrySerializer(obj, context={"request": self.request}).data,
        )

    def perform_destroy(self, instance):
        broadcast("invoice-entries", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()

    @action(detail=True, methods=["post"], url_path="upload")
    def upload(self, request, uid=None):
        entry: InvoiceEntry = self.get_object()
        file = request.FILES.get("file")
        if not file:
            return Response({"error": "No file provided"}, status=400)
        validate_upload(file)
        file.name = safe_filename(file.name)
        entry.file = file
        entry.invoice_number = request.data.get("invoice_number", entry.invoice_number)
        entry.notes = request.data.get("notes", entry.notes)
        entry.status = "Uploaded"
        entry.uploaded_by = request.user
        entry.uploaded_at = timezone.now()
        entry.save()
        # One invoice per client+month covers every plan's entry in that
        # group, so a fresh upload must overwrite the invoice_number on
        # sibling entries (same client, same month, different plan).
        # Without this, old numbers linger and the list view surfaces
        # them alongside the current one.
        updated_siblings: list[InvoiceEntry] = []
        if entry.invoice_number and entry.plan.client_id:
            siblings = InvoiceEntry.objects.filter(
                plan__client_id=entry.plan.client_id,
                invoice_month=entry.invoice_month,
            ).exclude(id=entry.id)
            for sib in siblings:
                if sib.invoice_number != entry.invoice_number:
                    sib.invoice_number = entry.invoice_number
                    sib.save(update_fields=["invoice_number", "updated_at"])
                    updated_siblings.append(sib)
        data = InvoiceEntrySerializer(entry, context={"request": request}).data
        broadcast("invoice-entries", "UPDATE", data)
        for sib in updated_siblings:
            broadcast(
                "invoice-entries",
                "UPDATE",
                InvoiceEntrySerializer(sib, context={"request": request}).data,
            )
        return Response(data)

    @action(detail=True, methods=["post"], url_path="approve", permission_classes=[IsAdmin])
    def approve(self, request, uid=None):
        from core.audit.models import log as audit_log

        entry: InvoiceEntry = self.get_object()
        # Approver must be admin in the entry's org, not just any org.
        if not cast(User, request.user).is_admin_in(entry.plan.org_id):
            return Response({"error": "Not an admin of the invoice's organisation"}, status=403)
        entry.status = "Approved"
        entry.approved_by = request.user
        entry.approved_at = timezone.now()
        entry.save()
        audit_log(
            request.user,
            "invoice.approve",
            resource_type="invoice_entry",
            resource_id=entry.uid,
            changes={"status": "Approved"},
            request=request,
        )
        data = InvoiceEntrySerializer(entry, context={"request": request}).data
        broadcast("invoice-entries", "UPDATE", data)
        return Response(data)

    @action(detail=True, methods=["post"], url_path="reject", permission_classes=[IsAdmin])
    def reject(self, request, uid=None):
        from core.audit.models import log as audit_log

        entry: InvoiceEntry = self.get_object()
        if not cast(User, request.user).is_admin_in(entry.plan.org_id):
            return Response({"error": "Not an admin of the invoice's organisation"}, status=403)
        entry.status = "Rejected"
        entry.rejection_reason = request.data.get("reason", "")
        entry.save()
        audit_log(
            request.user,
            "invoice.reject",
            resource_type="invoice_entry",
            resource_id=entry.uid,
            changes={"status": "Rejected", "reason": entry.rejection_reason},
            request=request,
        )
        data = InvoiceEntrySerializer(entry, context={"request": request}).data
        broadcast("invoice-entries", "UPDATE", data)
        return Response(data)

    @action(detail=True, methods=["get"], url_path="download")
    def download(self, request, uid=None):
        """Stream the invoice file to any authenticated user who can see
        the parent plan (queryset already scopes by org). Rendered inline
        so browsers view PDFs in a new tab; ``?download=1`` forces save.
        """
        import mimetypes

        from django.http import FileResponse, Http404

        entry: InvoiceEntry = self.get_object()
        if not entry.file:
            raise Http404("No file attached")
        filename = (entry.file.name or "").split("/")[-1]
        content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        force_download = request.query_params.get("download") in ("1", "true")
        response = FileResponse(
            entry.file.open("rb"),
            filename=filename,
            content_type=content_type,
        )
        disposition = "attachment" if force_download else "inline"
        response["Content-Disposition"] = f'{disposition}; filename="{filename}"'
        return response

    @action(detail=False, methods=["post"], url_path="generate", permission_classes=[IsAdmin])
    def generate(self, request):
        plan_uid = request.data.get("plan_uid")
        if not plan_uid:
            return Response({"error": "plan_uid is required"}, status=400)

        try:
            plan = InvoicePlan.objects.get(uid=plan_uid)
        except InvoicePlan.DoesNotExist:
            return Response({"error": "plan not found"}, status=404)

        caller = cast(User, request.user)
        # ``IsAdmin`` on the view means admin-in-any-org. The stricter
        # org-admin check used to live here, but it 403'd multi-org
        # admins who generate a plan from an org where they're only a
        # member — creation itself is already gated by OrgScopedMixin
        # (caller must be in plan.org), so enforcing admin-of-plan-org
        # at generate time doubles up unnecessarily. We still block
        # cross-tenant generation: the caller has to at least belong
        # to the plan's org.
        if plan.org_id and plan.org_id not in set(caller.org_ids()):
            return Response(
                {"error": "You are not a member of the plan's organisation"},
                status=403,
            )

        if not plan.start_month or not plan.end_month:
            # Both fields are ``NOT NULL`` on the model, but historical
            # rows seeded before that constraint may still exist. Bail
            # out with a clear message instead of an opaque 500.
            return Response(
                {"error": "Plan is missing start_month or end_month"},
                status=400,
            )

        PERIOD_MONTHS = {
            "Monthly": 1,
            "Quarterly": 3,
            "Half-yearly": 6,
            "Yearly": 12,
        }
        step = PERIOD_MONTHS.get(plan.periodicity, 1)

        expected_months = []
        cursor = plan.start_month.replace(day=1)
        end = plan.end_month.replace(day=1)
        while cursor <= end:
            expected_months.append(cursor)
            # Step to the next invoice month. Work in zero-indexed
            # math so the year-rollover arithmetic stays clean, then
            # convert back to 1-indexed on the way out. Previous
            # version used ``(month % 12) or 12`` which mapped
            # Feb → Jan and never advanced the cursor past the start
            # month — the loop ran forever and the worker was killed.
            zero_indexed_next = (cursor.month - 1) + step
            cursor = cursor.replace(
                year=cursor.year + zero_indexed_next // 12,
                month=(zero_indexed_next % 12) + 1,
                day=1,
            )
            # Safety brake — a 50-year plan at monthly cadence is 600
            # entries; anything beyond this is almost certainly a bug
            # in the date math rather than legitimate data.
            if len(expected_months) > 1200:
                return Response(
                    {"error": "Refusing to generate more than 1200 entries"},
                    status=400,
                )

        # Prune Pending entries that fall outside the plan's current
        # range (or off-cadence after a periodicity change). Without this,
        # editing a plan to start later — e.g. shifting start_month from
        # April to May — leaves the old April Pending row in the DB and
        # it keeps surfacing in the Summary/Invoices tabs even though the
        # Schedule tab (which gates by plan range) shows April as empty.
        # Only Pending rows are removed; Uploaded/Approved/Rejected rows
        # represent real user work and stay put even if they fall outside
        # the new range — admins can decide what to do with them manually.
        expected_set = set(expected_months)
        pruned_entries: list[InvoiceEntry] = list(
            InvoiceEntry.objects.filter(plan=plan, status="Pending").exclude(invoice_month__in=expected_set)
        )
        for stale in pruned_entries:
            broadcast(
                "invoice-entries",
                "DELETE",
                {"id": stale.pk, "uid": str(stale.uid)},
            )
            stale.delete()

        existing = set(InvoiceEntry.objects.filter(plan=plan).values_list("invoice_month", flat=True))
        existing_normalized = {d.replace(day=1) for d in existing}

        # Seed each new entry with the plan's ``base_amount`` and an
        # ``invoice_date`` computed from ``invoice_day``. Previously the
        # generate step left ``amount`` empty — admins had to open every
        # generated row and type the same number the plan already
        # carried. ``invoice_day`` clamps to the month's last day so
        # "31" on a February plan doesn't 500.
        import calendar as _cal

        created_entries = []
        skipped = 0
        for month_date in expected_months:
            if month_date in existing_normalized:
                skipped += 1
                continue
            day = min(
                plan.invoice_day or 1,
                _cal.monthrange(month_date.year, month_date.month)[1],
            )
            entry = InvoiceEntry.objects.create(
                plan=plan,
                invoice_month=month_date,
                invoice_date=month_date.replace(day=day),
                status="Pending",
                amount=plan.base_amount,
            )
            # Copy plan attribution defaults onto each new entry. Existing
            # entries are intentionally not retro-updated when plan defaults
            # change — same model as ``base_amount``: the plan supplies the
            # starting value and per-entry edits are the escape hatch.
            entry.project_status = plan.project_status
            entry.save(update_fields=["project_status"])
            for cat_link in plan.category_links.select_related("category"):
                InvoiceEntryCategory.objects.create(
                    entry=entry,
                    category=cat_link.category,
                    contribution_pct=cat_link.contribution_pct,
                )
            for owner_link in plan.owner_links.select_related("user"):
                InvoiceEntryOwner.objects.create(
                    entry=entry,
                    user=owner_link.user,
                    contribution_pct=owner_link.contribution_pct,
                )
            broadcast(
                "invoice-entries",
                "INSERT",
                InvoiceEntrySerializer(entry, context={"request": request}).data,
            )
            created_entries.append(InvoiceEntrySerializer(entry, context={"request": request}).data)

        return Response(
            {
                "plan_uid": str(plan.uid),
                "created": len(created_entries),
                "skipped_existing": skipped,
                "pruned_out_of_range": len(pruned_entries),
                "entries": created_entries,
            }
        )


class InvoiceCategoryViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = InvoiceCategorySerializer

    def get_permissions(self):
        if self.action in {"list", "retrieve"}:
            return [permissions.IsAuthenticated()]
        return [permissions.IsAuthenticated(), IsAdmin()]

    def get_queryset(self):
        user = cast(User, self.request.user)
        return scoped(InvoiceCategory.objects.select_related("org", "created_by"), user)

    def perform_create(self, serializer):
        obj = serializer.save(created_by=self.request.user)
        broadcast(
            "invoice-categories",
            "INSERT",
            InvoiceCategorySerializer(obj, context={"request": self.request}).data,
        )

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast(
            "invoice-categories",
            "UPDATE",
            InvoiceCategorySerializer(obj, context={"request": self.request}).data,
        )

    def perform_destroy(self, instance):
        broadcast("invoice-categories", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()


def _fy_months(fy: str) -> list[str]:
    """Convert ``"2026-27"`` to ``["2026-04", ..., "2027-03"]``."""
    start_year = int(fy.split("-")[0])
    months = []
    for offset in range(12):
        m = 4 + offset
        y = start_year + (m - 1) // 12
        m = ((m - 1) % 12) + 1
        months.append(f"{y:04d}-{m:02d}")
    return months


class InvoiceReportView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        fy = request.query_params.get("fy")
        group_by = request.query_params.get("group_by")
        if not fy or group_by not in {"owner", "category", "month", "client"}:
            return Response(
                {"error": "fy and group_by (owner|category|month|client) are required"},
                status=400,
            )

        months = _fy_months(fy)
        user = cast(User, request.user)

        qs = InvoiceEntry.objects.filter(plan__org_id__in=user.org_ids())
        # FY filter — month string prefix match.
        qs = qs.filter(invoice_month__gte=f"{months[0]}-01", invoice_month__lte=f"{months[-1]}-31")

        cat_uids = request.query_params.getlist("category")
        owner_uids = request.query_params.getlist("owner")
        ps = request.query_params.get("project_status")
        if cat_uids:
            qs = qs.filter(categories__uid__in=cat_uids).distinct()
        if owner_uids:
            qs = qs.filter(owners__uid__in=owner_uids).distinct()
        if ps:
            qs = qs.filter(project_status=ps)

        qs = qs.select_related("plan", "plan__client").prefetch_related("category_links__category", "owner_links__user")

        # rows[key] = {"label": ..., "monthly": defaultdict(Decimal)}
        rows: dict[str, dict] = {}
        col_totals: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))

        UNATTRIB_KEY = "Unattributed"

        def _bump(key, label, month_str, value):
            if key not in rows:
                rows[key] = {
                    "key": key,
                    "label": label,
                    "monthly": defaultdict(lambda: Decimal("0")),
                    "total": Decimal("0"),
                }
            rows[key]["monthly"][month_str] += value
            rows[key]["total"] += value
            col_totals[month_str] += value

        for entry in qs:
            amt = entry.amount or Decimal("0")
            month_str = entry.invoice_month.strftime("%Y-%m")
            if group_by == "category":
                cat_links = list(entry.category_links.all())
                if not cat_links:
                    _bump(UNATTRIB_KEY, "Unattributed", month_str, amt)
                else:
                    for cat_link in cat_links:
                        share = amt * cat_link.contribution_pct / Decimal("100")
                        _bump(str(cat_link.category.uid), cat_link.category.name, month_str, share)
            elif group_by == "owner":
                owner_links = list(entry.owner_links.all())
                if not owner_links:
                    _bump(UNATTRIB_KEY, "Unattributed", month_str, amt)
                else:
                    for owner_link in owner_links:
                        share = amt * owner_link.contribution_pct / Decimal("100")
                        label = owner_link.user.full_name or owner_link.user.username
                        _bump(str(owner_link.user.uid), label, month_str, share)
            elif group_by == "month":
                _bump(month_str, month_str, month_str, amt)
            elif group_by == "client":
                client = entry.plan.client
                key = str(client.uid) if client else "no-client"
                label = client.name if client else "(no client)"
                _bump(key, label, month_str, amt)

        # Serialise Decimals to strings for JSON; flatten monthly dict.
        out_rows = []
        for r in rows.values():
            out_rows.append(
                {
                    "key": r["key"],
                    "label": r["label"],
                    "monthly": {m: str(r["monthly"].get(m, Decimal("0"))) for m in months},
                    "total": str(r["total"]),
                }
            )
        out_rows.sort(key=lambda r: (r["key"] == UNATTRIB_KEY, r["label"].lower()))

        return Response(
            {
                "fy": fy,
                "group_by": group_by,
                "rows": out_rows,
                "totals": {
                    **{m: str(col_totals.get(m, Decimal("0"))) for m in months},
                    "total": str(sum(col_totals.values()) or Decimal("0")),
                },
            }
        )
