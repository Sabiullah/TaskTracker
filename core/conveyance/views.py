import uuid
from typing import cast

from django.db import transaction
from django.db.models import Exists, OuterRef
from django.utils import timezone
from rest_framework import permissions
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.filestore.validators import validate_upload
from core.org_utils import resolve_create_org, visibility_q
from core.pagination import StandardPagination
from users.models import OrgMembership, User

from .models import ConveyanceAttachment, ConveyanceEntry
from .recurrence import period_dates
from .serializers import ConveyanceAttachmentSerializer, ConveyanceEntrySerializer


def _now_local_date():
    return timezone.localdate()


class ConveyanceEntryViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = ConveyanceEntrySerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardPagination

    def get_queryset(self):
        from django.db.models import Q

        user = cast(User, self.request.user)
        # `conveyance_access` extends visibility per-org: an employee in 4D
        # with the flag sees every 4D entry, but still only their own in YBV
        # if they don't have it there. OR-ed onto the standard role-based
        # visibility filter.
        conveyance_access_org_ids = list(
            user.memberships.filter(conveyance_access=True).values_list("org_id", flat=True)
        )
        visibility = visibility_q(user, "employee")
        if conveyance_access_org_ids:
            visibility = visibility | Q(org_id__in=conveyance_access_org_ids)

        qs = (
            ConveyanceEntry.objects.select_related("employee", "client", "org", "reviewed_by", "created_by")
            .prefetch_related("attachments", "attachments__uploaded_by")
            .filter(visibility)
        )

        # Hide admin-owned entries from orgs where the caller is only a
        # manager. Admins still see everything in orgs where they are admin
        # because OrgMembership has at most one role per (user, org), so a
        # `role="manager"` filter never includes an org where the caller is
        # the admin.
        manager_only_org_ids = list(user.memberships.filter(role="manager").values_list("org_id", flat=True))
        if manager_only_org_ids:
            owner_is_admin_in_entry_org = OrgMembership.objects.filter(
                role="admin",
                org_id=OuterRef("org_id"),
                user_id=OuterRef("employee_id"),
            )
            qs = qs.annotate(_owner_is_admin=Exists(owner_is_admin_in_entry_org)).exclude(
                org_id__in=manager_only_org_ids,
                _owner_is_admin=True,
            )

        employee_uid = self.request.query_params.get("employee_uid")
        client_uid = self.request.query_params.get("client_uid")
        status = self.request.query_params.get("status")
        claimable = self.request.query_params.get("claimable")
        month = self.request.query_params.get("month")
        date_from = self.request.query_params.get("from")
        date_to = self.request.query_params.get("to")
        search = self.request.query_params.get("search")

        if employee_uid:
            qs = qs.filter(employee__uid=employee_uid)
        if client_uid:
            qs = qs.filter(client__uid=client_uid)
        if status in {"pending", "approved", "rejected"}:
            qs = qs.filter(status=status)
        if claimable in {"true", "false"}:
            qs = qs.filter(claimable=(claimable == "true"))
        if month:
            qs = qs.filter(date__startswith=month)
        if date_from:
            qs = qs.filter(date__gte=date_from)
        if date_to:
            qs = qs.filter(date__lte=date_to)
        if search:
            qs = qs.filter(reason__icontains=search)
        return qs

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "request": self.request}

    def perform_create(self, serializer):
        user = cast(User, self.request.user)
        org, err = resolve_create_org(self.request)
        if err is not None:
            exc_cls = PermissionDenied if err.status_code == 403 else ValidationError
            raise exc_cls(err.data)

        target_employee: User = user
        employee_uid = self.request.data.get("employee_uid")
        if employee_uid:
            if not user.is_admin_in(org):
                raise PermissionDenied({"detail": "Only an admin of the target org may set employee_uid"})
            looked_up = User.objects.filter(uid=employee_uid, memberships__org=org).first()
            if looked_up is None:
                raise ValidationError({"employee_uid": "User is not a member of the target organisation"})
            target_employee = looked_up

        files = self.request.FILES.getlist("attachments")
        labels = self.request.POST.getlist("attachment_labels")
        for f in files:
            validate_upload(f)

        frequency = serializer.validated_data.get("frequency", "one_time")

        with transaction.atomic():
            if frequency == "one_time":
                entry = serializer.save(employee=target_employee, created_by=user, org=org)
                self._attach_files(entry, files, labels, user)
                # Pin the saved instance so DRF's response body uses the
                # full object (matches behaviour before the recurring path).
                serializer.instance = entry
                return

            # Recurring: build the period list and create one row per period.
            # The serializer's ``date`` field is intentionally unused here —
            # each sibling's ``date`` comes from ``period_dates(...)`` instead.
            start = serializer.validated_data["start_month"]
            end = serializer.validated_data["end_month"]
            dates = period_dates(frequency, start, end)
            if not dates:
                # Defensive: serializer.validate already enforces end >= start,
                # so this should be unreachable in practice.
                raise ValidationError({"end_month": "End month must be on or after start month."})

            series_uid = uuid.uuid4()
            shared = {
                "client": serializer.validated_data["client"],
                "reason": serializer.validated_data["reason"],
                "amount": serializer.validated_data["amount"],
                "claimable": serializer.validated_data.get("claimable", True),
                "frequency": frequency,
                "start_month": start,
                "end_month": end,
                "series_uid": series_uid,
                "employee": target_employee,
                "created_by": user,
                "org": org,
            }
            siblings = [
                ConveyanceEntry(date=d, **shared)
                for d in dates
            ]
            # ``bulk_create`` returns the same list with PKs populated; ``dates``
            # is already in ascending chronological order, so no re-sort needed.
            siblings = ConveyanceEntry.objects.bulk_create(siblings)
            for sibling in siblings:
                # Per spec §6: each sibling gets its own copy of every file.
                # Re-open each uploaded file from the start so multiple writes
                # of the same source don't share a cursor.
                for f in files:
                    f.seek(0)
                self._attach_files(sibling, files, labels, user)

            # Pick the headline sibling: most recent on-or-before today, else
            # earliest. Drives the 201 response shape.
            today = _now_local_date()
            past = [s for s in siblings if s.date <= today]
            headline = past[-1] if past else siblings[0]
            serializer.instance = headline

    def _attach_files(self, entry, files, labels, user):
        for idx, f in enumerate(files):
            label = labels[idx].strip()[:100] if idx < len(labels) else ""
            ConveyanceAttachment.objects.create(
                entry=entry,
                file=f,
                label=label,
                uploaded_by=user,
            )

    def _caller_is_admin_in_entry_org(self, entry) -> bool:
        user = cast(User, self.request.user)
        return bool(entry.org_id and user.is_admin_in(entry.org_id))

    def _assert_mutable_for_caller(self, entry):
        user = cast(User, self.request.user)
        if self._caller_is_admin_in_entry_org(entry):
            return
        if entry.status != "pending":
            raise PermissionDenied({"detail": "Only pending entries can be modified"})
        if entry.employee_id != user.id:
            raise PermissionDenied({"detail": "You can only modify your own entries"})

    def perform_update(self, serializer):
        self._assert_mutable_for_caller(serializer.instance)
        serializer.save()

    def perform_destroy(self, instance):
        self._assert_mutable_for_caller(instance)
        for attachment in instance.attachments.all():
            if attachment.file:
                attachment.file.delete(save=False)
        instance.delete()

    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request, uid=None):
        from core.audit.models import log as audit_log
        from core.realtime import broadcast

        entry: ConveyanceEntry = self.get_object()
        user = cast(User, request.user)
        is_admin_in_org = user.is_admin_in(entry.org_id)
        if entry.employee_id == user.id and not is_admin_in_org:
            raise PermissionDenied({"detail": "Cannot review your own entry"})
        if not user.is_manager_in(entry.org_id):
            raise PermissionDenied({"detail": "Manager or admin role required in the entry's organisation"})
        if entry.status != "pending" and entry.series_uid is None:
            return Response(
                {"detail": f"Entry is already {entry.status}"},
                status=409,
            )

        # Fan-out across the series (a one-time row's series is itself).
        if entry.series_uid is None:
            rows = [entry]
        else:
            rows = list(
                ConveyanceEntry.objects.filter(
                    series_uid=entry.series_uid,
                    status="pending",
                )
            )
            if not rows:
                return Response(
                    {"detail": "No pending entries in this series"},
                    status=409,
                )

        review_note = (request.data.get("review_note") or "").strip()[:500]
        now = timezone.now()
        flipped = 0
        with transaction.atomic():
            for r in rows:
                r.status = "approved"
                r.reviewed_by = user
                r.reviewed_at = now
                r.review_note = review_note
                r.save()
                flipped += 1

        audit_log(
            user,
            "conveyance.approve",
            resource_type="conveyance_entry",
            resource_id=entry.series_uid or entry.uid,
            changes={
                "status": "approved",
                "row_count": flipped,
                "series_uid": str(entry.series_uid) if entry.series_uid else None,
            },
            request=request,
        )

        # Broadcast every flipped row so open clients get fresh data; the
        # frontend coalesces these via its list reload.
        for r in rows:
            broadcast(
                "conveyance-entries",
                "UPDATE",
                ConveyanceEntrySerializer(r, context={"request": request}).data,
            )
        # 200 body is the entry the caller acted on (matches old behaviour).
        entry.refresh_from_db()
        return Response(ConveyanceEntrySerializer(entry, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="reject")
    def reject(self, request, uid=None):
        from core.audit.models import log as audit_log
        from core.realtime import broadcast

        entry: ConveyanceEntry = self.get_object()
        user = cast(User, request.user)
        note = (request.data.get("review_note") or "").strip()
        if len(note) < 3:
            return Response(
                {"review_note": "A rejection note of at least 3 characters is required"},
                status=400,
            )
        is_admin_in_org = user.is_admin_in(entry.org_id)
        if entry.employee_id == user.id and not is_admin_in_org:
            raise PermissionDenied({"detail": "Cannot review your own entry"})
        if not user.is_manager_in(entry.org_id):
            raise PermissionDenied({"detail": "Manager or admin role required in the entry's organisation"})
        if entry.status != "pending" and entry.series_uid is None:
            return Response(
                {"detail": f"Entry is already {entry.status}"},
                status=409,
            )

        if entry.series_uid is None:
            rows = [entry]
        else:
            rows = list(
                ConveyanceEntry.objects.filter(
                    series_uid=entry.series_uid,
                    status="pending",
                )
            )
            if not rows:
                return Response(
                    {"detail": "No pending entries in this series"},
                    status=409,
                )

        now = timezone.now()
        flipped = 0
        truncated = note[:500]
        with transaction.atomic():
            for r in rows:
                r.status = "rejected"
                r.reviewed_by = user
                r.reviewed_at = now
                r.review_note = truncated
                r.save()
                flipped += 1

        audit_log(
            user,
            "conveyance.reject",
            resource_type="conveyance_entry",
            resource_id=entry.series_uid or entry.uid,
            changes={
                "status": "rejected",
                "reason": truncated,
                "row_count": flipped,
                "series_uid": str(entry.series_uid) if entry.series_uid else None,
            },
            request=request,
        )

        for r in rows:
            broadcast(
                "conveyance-entries",
                "UPDATE",
                ConveyanceEntrySerializer(r, context={"request": request}).data,
            )
        entry.refresh_from_db()
        return Response(ConveyanceEntrySerializer(entry, context={"request": request}).data)

    @action(detail=False, methods=["get"], url_path="summary")
    def summary(self, request):
        import datetime
        from decimal import Decimal

        from django.db.models import Count, Sum
        from django.db.models.functions import TruncMonth

        user = cast(User, request.user)
        group_by = request.query_params.get("group_by")
        if group_by not in {"employee", "client"}:
            return Response({"detail": "group_by must be 'employee' or 'client'"}, status=400)

        mode = request.query_params.get("mode", "single")
        if mode not in {"single", "trailing"}:
            return Response({"detail": "mode must be 'single' or 'trailing'"}, status=400)

        # Orgs where caller can see everyone's conveyance: admin/manager or
        # an employee with conveyance_access granted. Plain-employee orgs
        # without the flag are excluded.
        from django.db.models import Q

        privileged_org_ids = list(
            user.memberships.filter(Q(role__in=["admin", "manager"]) | Q(conveyance_access=True)).values_list(
                "org_id", flat=True
            )
        )
        if not privileged_org_ids:
            raise PermissionDenied({"detail": "Manager, admin, or conveyance_access required"})

        # Employee totals show every approved entry (the company reimburses
        # the employee for all approved conveyance, claimable or not).
        # Client totals only include claimable entries because those are the
        # ones invoiced back to the client.
        base = ConveyanceEntry.objects.filter(
            org_id__in=privileged_org_ids,
            status="approved",
        )
        if group_by == "client":
            base = base.filter(claimable=True)

        key_field = "employee" if group_by == "employee" else "client"
        key_uid_path = f"{key_field}__uid"
        key_label_expr = "employee__full_name" if group_by == "employee" else "client__name"

        if mode == "single":
            month_str = request.query_params.get("month")
            if month_str:
                try:
                    year, month = [int(x) for x in month_str.split("-")]
                    month_start = datetime.date(year, month, 1)
                except (ValueError, TypeError):
                    return Response({"detail": "Invalid month format (expected YYYY-MM)"}, status=400)
            else:
                today = datetime.date.today()
                month_start = today.replace(day=1)
            next_month = (
                month_start.replace(year=month_start.year + 1, month=1)
                if month_start.month == 12
                else month_start.replace(month=month_start.month + 1)
            )

            scoped = base.filter(date__gte=month_start, date__lt=next_month)
            aggregates = (
                scoped.values(key_uid_path, key_label_expr)
                .annotate(total=Sum("amount"), entry_count=Count("id"))
                .order_by("-total")
            )

            rows = []
            grand = Decimal("0.00")
            for row in aggregates:
                uid = row[key_uid_path]
                label = row[key_label_expr] or ""
                total = row["total"] or Decimal("0.00")
                grand += total
                top_qs = scoped.filter(**{key_uid_path: uid}).order_by("-amount")[:3]
                top = [
                    {
                        "uid": str(e.uid),
                        "date": e.date.isoformat(),
                        "reason": (e.reason or "")[:120],
                        "amount": str(e.amount),
                    }
                    for e in top_qs
                ]
                rows.append(
                    {
                        "key_uid": str(uid),
                        "key_label": label,
                        "total": str(total),
                        "entry_count": row["entry_count"],
                        "top_entries": top,
                    }
                )
            return Response(
                {
                    "mode": "single",
                    "month": month_start.isoformat()[:7],
                    "group_by": group_by,
                    "rows": rows,
                    "grand_total": str(grand),
                }
            )

        # Trailing mode
        months_param = request.query_params.get("months", "6")
        try:
            n_months = int(months_param)
        except (TypeError, ValueError):
            n_months = 6
        n_months = max(1, min(12, n_months))

        end_str = request.query_params.get("end")
        if end_str:
            try:
                year, month = [int(x) for x in end_str.split("-")]
                end_month_start = datetime.date(year, month, 1)
            except (ValueError, TypeError):
                return Response({"detail": "Invalid end format (expected YYYY-MM)"}, status=400)
        else:
            today = datetime.date.today()
            end_month_start = today.replace(day=1)

        months = []
        cursor = end_month_start
        for _ in range(n_months):
            months.append(cursor)
            if cursor.month == 1:
                cursor = cursor.replace(year=cursor.year - 1, month=12)
            else:
                cursor = cursor.replace(month=cursor.month - 1)
        months.reverse()

        window_start = months[0]
        window_end_exclusive = (
            end_month_start.replace(year=end_month_start.year + 1, month=1)
            if end_month_start.month == 12
            else end_month_start.replace(month=end_month_start.month + 1)
        )

        scoped = base.filter(date__gte=window_start, date__lt=window_end_exclusive)
        pivot = (
            scoped.annotate(month=TruncMonth("date"))
            .values(key_uid_path, key_label_expr, "month")
            .annotate(total=Sum("amount"))
        )

        months_labels = [m.isoformat()[:7] for m in months]
        by_key: dict[str, dict] = {}
        for row in pivot:
            uid = str(row[key_uid_path])
            label = row[key_label_expr] or ""
            bucket = by_key.setdefault(
                uid,
                {
                    "key_uid": uid,
                    "key_label": label,
                    "monthly": {m: "0.00" for m in months_labels},
                    "total": Decimal("0.00"),
                },
            )
            mstr = row["month"].strftime("%Y-%m")
            bucket["monthly"][mstr] = str(row["total"] or Decimal("0.00"))
            bucket["total"] += row["total"] or Decimal("0.00")

        rows_out = []
        column_totals = {m: Decimal("0.00") for m in months_labels}
        grand = Decimal("0.00")
        for bucket in sorted(by_key.values(), key=lambda b: b["total"], reverse=True):
            for m in months_labels:
                column_totals[m] += Decimal(bucket["monthly"][m])
            grand += bucket["total"]
            bucket["total"] = str(bucket["total"])
            rows_out.append(bucket)

        return Response(
            {
                "mode": "trailing",
                "months": months_labels,
                "group_by": group_by,
                "rows": rows_out,
                "column_totals": {m: str(v) for m, v in column_totals.items()},
                "grand_total": str(grand),
            }
        )


class ConveyanceAttachmentViewSet(UidLookupMixin, ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = ConveyanceAttachmentSerializer
    http_method_names = ["get", "post", "delete", "head", "options"]

    def get_queryset(self):
        user = cast(User, self.request.user)
        visible_entries = ConveyanceEntry.objects.filter(visibility_q(user, "employee"))
        return ConveyanceAttachment.objects.select_related("entry", "entry__employee", "uploaded_by").filter(
            entry__in=visible_entries
        )

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "request": self.request}

    def create(self, request, *args, **kwargs):
        from django.shortcuts import get_object_or_404

        from core.filestore.validators import validate_upload
        from core.realtime import broadcast

        user = cast(User, request.user)
        entry_uid = request.data.get("entry_uid")
        if not entry_uid:
            return Response({"entry_uid": "Required"}, status=400)

        entry_qs = ConveyanceEntry.objects.filter(visibility_q(user, "employee"))
        entry = get_object_or_404(entry_qs, uid=entry_uid)

        is_admin_in_org = bool(entry.org_id and user.is_admin_in(entry.org_id))
        if not is_admin_in_org:
            if entry.employee_id != user.id:
                raise PermissionDenied({"detail": "Not allowed to add attachments to this entry"})
            if entry.status != "pending":
                raise PermissionDenied({"detail": "Only pending entries accept new attachments"})

        uploaded = request.FILES.get("file")
        if not uploaded:
            return Response({"file": "Required"}, status=400)
        validate_upload(uploaded)

        label = (request.data.get("label") or "").strip()[:100]
        attachment = ConveyanceAttachment.objects.create(entry=entry, file=uploaded, label=label, uploaded_by=user)
        broadcast(
            "conveyance-entries",
            "UPDATE",
            ConveyanceEntrySerializer(entry, context={"request": request}).data,
        )
        return Response(
            self.get_serializer(attachment).data,
            status=201,
        )

    def destroy(self, request, *args, **kwargs):
        from core.realtime import broadcast

        attachment = self.get_object()
        entry = attachment.entry
        user = cast(User, request.user)

        is_admin_in_org = bool(entry.org_id and user.is_admin_in(entry.org_id))
        if not is_admin_in_org:
            if entry.employee_id != user.id:
                raise PermissionDenied({"detail": "Not allowed"})
            if entry.status != "pending":
                raise PermissionDenied({"detail": "Only pending entries accept attachment removal"})

        if attachment.file:
            attachment.file.delete(save=False)
        attachment.delete()
        broadcast(
            "conveyance-entries",
            "UPDATE",
            ConveyanceEntrySerializer(entry, context={"request": request}).data,
        )
        return Response(status=204)

    @action(detail=True, methods=["get"], url_path="download")
    def download(self, request, uid=None):
        import mimetypes

        from django.http import FileResponse, Http404

        attachment = self.get_object()
        if not attachment.file:
            raise Http404("No file attached")
        filename = attachment.file.name.rsplit("/", 1)[-1]
        content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        force_download = request.query_params.get("download") in {"1", "true"}
        response = FileResponse(
            attachment.file.open("rb"),
            filename=filename,
            content_type=content_type,
        )
        disposition = "attachment" if force_download else "inline"
        response["Content-Disposition"] = f'{disposition}; filename="{filename}"'
        return response
