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
    InvoiceEntryCategoryOwner,
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
            for cat_link in plan.category_links.select_related("category").prefetch_related("owner_links__user"):
                entry_cat = InvoiceEntryCategory.objects.create(
                    entry=entry,
                    category=cat_link.category,
                    contribution_pct=cat_link.contribution_pct,
                )
                for owner_link in cat_link.owner_links.all():
                    InvoiceEntryCategoryOwner.objects.create(
                        entry_category=entry_cat,
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
            qs = qs.filter(category_links__owner_links__user__uid__in=owner_uids).distinct()
        if ps:
            qs = qs.filter(project_status=ps)

        qs = qs.select_related("plan", "plan__client").prefetch_related(
            "category_links__category",
            "category_links__owner_links__user",
        )

        # rows[key] = {"label": ..., "monthly": defaultdict(Decimal), "monthly_clients": defaultdict(set), ...}
        rows: dict[str, dict] = {}
        col_totals: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
        col_clients: dict[str, set] = defaultdict(set)
        grand_clients: set = set()

        UNATTRIB_KEY = "Unattributed"

        def _bump(key, label, month_str, value, client_id):
            if key not in rows:
                rows[key] = {
                    "key": key,
                    "label": label,
                    "monthly": defaultdict(lambda: Decimal("0")),
                    "monthly_clients": defaultdict(set),
                    "row_clients": set(),
                    "total": Decimal("0"),
                }
            rows[key]["monthly"][month_str] += value
            rows[key]["total"] += value
            col_totals[month_str] += value
            if client_id is not None:
                rows[key]["monthly_clients"][month_str].add(client_id)
                rows[key]["row_clients"].add(client_id)
                col_clients[month_str].add(client_id)
                grand_clients.add(client_id)

        for entry in qs:
            amt = entry.amount or Decimal("0")
            month_str = entry.invoice_month.strftime("%Y-%m")
            client_id = entry.plan.client_id
            if group_by == "category":
                cat_links = list(entry.category_links.all())
                if not cat_links:
                    _bump(UNATTRIB_KEY, "Unattributed", month_str, amt, client_id)
                else:
                    for cat_link in cat_links:
                        share = amt * cat_link.contribution_pct / Decimal("100")
                        _bump(str(cat_link.category.uid), cat_link.category.name, month_str, share, client_id)
            elif group_by == "owner":
                cat_links = list(entry.category_links.all())
                if not cat_links:
                    # Entry with no category at all → fully unattributed.
                    _bump(UNATTRIB_KEY, "Unattributed", month_str, amt, client_id)
                    continue
                for cat_link in cat_links:
                    cat_share = amt * cat_link.contribution_pct / Decimal("100")
                    owner_links = list(cat_link.owner_links.all())
                    if not owner_links:
                        # Category has no owners — that slice is unattributed.
                        _bump(UNATTRIB_KEY, "Unattributed", month_str, cat_share, client_id)
                    else:
                        for ol in owner_links:
                            share = cat_share * ol.contribution_pct / Decimal("100")
                            label = ol.user.full_name or ol.user.username
                            _bump(str(ol.user.uid), label, month_str, share, client_id)
            elif group_by == "month":
                _bump(month_str, month_str, month_str, amt, client_id)
            elif group_by == "client":
                client = entry.plan.client
                key = str(client.uid) if client else "no-client"
                label = client.name if client else "(no client)"
                _bump(key, label, month_str, amt, client_id)

        # Serialise.
        out_rows = []
        for r in rows.values():
            row_payload = {
                "key": r["key"],
                "label": r["label"],
                "monthly": {m: str(r["monthly"].get(m, Decimal("0"))) for m in months},
                "total": str(r["total"]),
            }
            if group_by != "client":
                row_payload["monthly_clients"] = {m: len(r["monthly_clients"].get(m, set())) for m in months}
                row_payload["total_clients"] = len(r["row_clients"])
            out_rows.append(row_payload)
        out_rows.sort(key=lambda r: (r["key"] == UNATTRIB_KEY, r["label"].lower()))

        totals_payload: dict = {
            **{m: str(col_totals.get(m, Decimal("0"))) for m in months},
            "total": str(sum(col_totals.values()) or Decimal("0")),
        }
        if group_by != "client":
            totals_payload["monthly_clients"] = {m: len(col_clients.get(m, set())) for m in months}
            totals_payload["total_clients"] = len(grand_clients)

        return Response(
            {
                "fy": fy,
                "group_by": group_by,
                "rows": out_rows,
                "totals": totals_payload,
            }
        )


class InvoiceReportCellView(APIView):
    """Drill-down for one cell on the Invoice Report grid. Returns one
    row per (client, category_link, invoice_month) of every entry that
    contributes to the cell. Proportional shares are applied so the sum
    of ``amount`` matches the corresponding cell on the main report.

    Owner mode now drills through *category* — owners are nested under a
    category link, so each contributing slice is
    ``amount × cat% × owner%-within-cat``.
    """

    permission_classes = [permissions.IsAuthenticated]

    TOTAL = "__total__"
    UNCATEGORIZED = "(uncategorized)"
    NO_CLIENT = "(no client)"

    def get(self, request):
        fy = request.query_params.get("fy")
        group_by = request.query_params.get("group_by")
        row_key = request.query_params.get("row_key")
        month = request.query_params.get("month")
        if not fy or group_by not in {"owner", "category", "month"} or not row_key or not month:
            return Response(
                {"error": "fy, group_by (owner|category|month), row_key, month are required"},
                status=400,
            )

        months = _fy_months(fy)
        user = cast(User, request.user)

        qs = InvoiceEntry.objects.filter(plan__org_id__in=user.org_ids())
        qs = qs.filter(invoice_month__gte=f"{months[0]}-01", invoice_month__lte=f"{months[-1]}-31")

        cat_uids = request.query_params.getlist("category")
        owner_uids = request.query_params.getlist("owner")
        ps = request.query_params.get("project_status")
        if cat_uids:
            qs = qs.filter(categories__uid__in=cat_uids).distinct()
        if owner_uids:
            qs = qs.filter(category_links__owner_links__user__uid__in=owner_uids).distinct()
        if ps:
            qs = qs.filter(project_status=ps)

        # Restrict by month unless drilling Total column / grand total.
        if month != self.TOTAL:
            qs = qs.filter(invoice_month=f"{month}-01")

        qs = qs.select_related("plan", "plan__client").prefetch_related(
            "category_links__category",
            "category_links__owner_links__user",
        )

        # Restrict by row identity per group_by, unless drilling TOTAL row / grand total.
        # row_key is a uid string for owner/category, or a "YYYY-MM" string for month mode.
        # ``Unattributed`` is emitted in owner mode for category links with no
        # owners (or entries with no category links), and in category mode for
        # entries with no category links.
        UNATTRIB = "Unattributed"
        if row_key != self.TOTAL:
            if group_by == "owner":
                if row_key != UNATTRIB:
                    qs = qs.filter(category_links__owner_links__user__uid=row_key)
                # ``Unattributed`` mode: entries with no category at all OR
                # category links whose owner_links is empty. Don't pre-filter
                # — let the per-entry loop classify each slice.
            elif group_by == "category":
                if row_key == UNATTRIB:
                    qs = qs.filter(category_links__isnull=True)
                else:
                    qs = qs.filter(category_links__category__uid=row_key)
            elif group_by == "month":
                qs = qs.filter(invoice_month=f"{row_key}-01")

        out_rows: list[dict] = []
        client_ids: set = set()
        total = Decimal("0")

        focus_cat_uid = row_key if (group_by == "category" and row_key not in (self.TOTAL, UNATTRIB)) else None
        focus_owner_uid = row_key if (group_by == "owner" and row_key not in (self.TOTAL, UNATTRIB)) else None
        owner_unattrib = group_by == "owner" and row_key == UNATTRIB

        def _emit(client_label, category_label, month_str, amount, client_pk=None):
            row_amt = amount.quantize(Decimal("0.01"))
            out_rows.append(
                {
                    "client": client_label,
                    "category": category_label,
                    "month": month_str,
                    "amount": str(row_amt),
                }
            )
            if client_pk is not None:
                client_ids.add(client_pk)
            return row_amt

        for entry in qs.distinct():
            amt = entry.amount or Decimal("0")
            month_str = entry.invoice_month.strftime("%Y-%m")
            client = entry.plan.client
            client_label = client.name if client is not None else self.NO_CLIENT
            client_pk = client.pk if client is not None else None

            cat_links = list(entry.category_links.all())

            # ----- OWNER MODE -----
            if group_by == "owner":
                if not cat_links:
                    if owner_unattrib or row_key == self.TOTAL:
                        total += _emit(client_label, self.UNCATEGORIZED, month_str, amt, client_pk)
                    continue
                for cl in cat_links:
                    cat_share = cl.contribution_pct / Decimal("100")
                    slice_amt = amt * cat_share
                    owner_links = list(cl.owner_links.all())
                    if not owner_links:
                        if owner_unattrib or row_key == self.TOTAL:
                            total += _emit(client_label, cl.category.name, month_str, slice_amt, client_pk)
                        continue
                    for ol in owner_links:
                        if focus_owner_uid is not None and str(ol.user.uid) != focus_owner_uid:
                            continue
                        if owner_unattrib:
                            # Owner-attributed slices are not part of the
                            # Unattributed row.
                            continue
                        share = slice_amt * ol.contribution_pct / Decimal("100")
                        total += _emit(client_label, cl.category.name, month_str, share, client_pk)
                continue

            # ----- CATEGORY MODE -----
            if group_by == "category":
                if focus_cat_uid is not None:
                    for cl in cat_links:
                        if str(cl.category.uid) == focus_cat_uid:
                            cat_share = cl.contribution_pct / Decimal("100")
                            total += _emit(
                                client_label, cl.category.name, month_str, amt * cat_share, client_pk
                            )
                            break
                elif not cat_links:
                    total += _emit(client_label, self.UNCATEGORIZED, month_str, amt, client_pk)
                else:
                    for cl in cat_links:
                        cat_share = cl.contribution_pct / Decimal("100")
                        total += _emit(client_label, cl.category.name, month_str, amt * cat_share, client_pk)
                continue

            # ----- MONTH MODE -----
            if not cat_links:
                total += _emit(client_label, self.UNCATEGORIZED, month_str, amt, client_pk)
            else:
                for cl in cat_links:
                    cat_share = cl.contribution_pct / Decimal("100")
                    total += _emit(client_label, cl.category.name, month_str, amt * cat_share, client_pk)

        out_rows.sort(key=lambda r: (r["client"], r["category"], r["month"]))

        return Response(
            {
                "rows": out_rows,
                "total_amount": str(total),
                "client_count": len(client_ids),
            }
        )
