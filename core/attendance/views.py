import datetime
from typing import cast

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import permissions
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.org_utils import resolve_create_org, visibility_q
from core.pagination import StandardPagination
from core.realtime import broadcast
from users.models import User

from .models import Attendance
from .serializers import AttendanceSerializer


def _raise_from_response(err):
    exc_cls = PermissionDenied if err.status_code == 403 else ValidationError
    raise exc_cls(err.data)


def _attendance_visibility_q(user) -> Q:
    """Per-org role-aware visibility for Attendance rows.

    Mirrors ``_employee_visibility_q`` in ``core/employees/views.py`` and the
    inline rule in ``AttendanceViewSet.matrix``: a manager only sees rows for
    users they directly supervise (plus themselves), not every row in the
    org. The shared ``visibility_q`` helper treats managers like admins,
    which is the right call for Tasks/WorkLog/Leads but too broad for
    Attendance — managers should not be able to inspect peer attendance
    outside their reporting line.

      - admin in an org          → every attendance row in that org
      - employee_access in an org → every attendance row in that org (the
        Matrix + Attendance Log tabs of Employee Management read this endpoint,
        so the flag must grant admin-equivalent breadth here too)
      - manager in an org         → own row + direct reports (``User.subordinates``)
      - employee in an org        → own row only
    """
    admin_org_ids = list(user.memberships.filter(role="admin").values_list("org_id", flat=True))
    access_org_ids = list(user.memberships.filter(employee_access=True).values_list("org_id", flat=True))
    manager_org_ids = list(user.memberships.filter(role="manager").values_list("org_id", flat=True))
    employee_org_ids = list(user.memberships.filter(role="employee").values_list("org_id", flat=True))

    # Admin and employee_access both see every row in their org.
    full_org_ids = list(set(admin_org_ids) | set(access_org_ids))

    visible_user_ids: set[int] = {user.id}
    if manager_org_ids:
        visible_user_ids.update(user.subordinates.values_list("id", flat=True))

    q = Q(pk__in=[])
    if full_org_ids:
        q |= Q(org_id__in=full_org_ids)
    if manager_org_ids:
        q |= Q(org_id__in=manager_org_ids, user_id__in=list(visible_user_ids))
    if employee_org_ids:
        q |= Q(org_id__in=employee_org_ids, user_id=user.id)
    return q


class AttendanceViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = AttendanceSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardPagination

    def _wfh_approval_fields(self, work_location: str | None, row_user, org):
        """Decide initial approval_state / approver / approved_at for a new
        Attendance row. Used by both ``perform_create`` and ``bulk_import`` so
        WFH-pending semantics apply consistently regardless of entry path.

        Returns a tuple ``(approval_state, approver, approved_at)``. For
        non-WFH rows, returns ``(None, None, None)``.
        """
        if work_location != "WFH":
            return None, None, None
        if row_user.is_admin_in(org):
            return "Approved", row_user, timezone.now()
        return "Pending", None, None

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = (
            Attendance.objects.select_related("user", "created_by")
            .filter(_attendance_visibility_q(user))
            .order_by("-date")
        )

        month = self.request.query_params.get("month")
        date = self.request.query_params.get("date")
        user_uid = self.request.query_params.get("user_uid")

        if month:
            qs = qs.filter(date__startswith=month)
        if date:
            qs = qs.filter(date=date)
        if user_uid:
            qs = qs.filter(user__uid=user_uid)
        return qs

    def perform_create(self, serializer):
        org, err = resolve_create_org(self.request)
        if err is not None:
            _raise_from_response(err)
        user = cast(User, self.request.user)
        # Pinning a status (manual_status_override=True) is Admin-only —
        # silently drop the flag for non-admin creates so an employee can't
        # punch in with a fake status that bypasses hours-derivation.
        is_admin = bool(org and user.is_admin_in(org))
        if not is_admin and serializer.validated_data.get("manual_status_override"):
            serializer.validated_data["manual_status_override"] = False
        approval_state, approver_val, approved_at_val = self._wfh_approval_fields(
            serializer.validated_data.get("work_location"),
            user,
            org,
        )
        obj = serializer.save(
            created_by=user,
            org=org,
            approval_state=approval_state,
            approver=approver_val,
            approved_at=approved_at_val,
        )
        broadcast("attendance", "INSERT", AttendanceSerializer(obj).data)
        if approval_state == "Pending":
            from core.leave.permissions import approver_pool

            pool = approver_pool(user, org)
            approver_uids = [str(uid) for uid in User.objects.filter(pk__in=pool).values_list("uid", flat=True)]
            broadcast(
                "attendance.approval",
                "PENDING",
                {
                    **AttendanceSerializer(obj).data,
                    "approver_uids": approver_uids,
                    "kind": "WFH",
                },
            )

    def perform_update(self, serializer):
        # Only Admins may change punch timing. Managers and Employees can
        # still edit Location / Status / Remarks on rows they have access
        # to, but login_time / logout_time are locked — silently revert
        # any incoming change to those fields to the stored values.
        # ``manual_status_override`` is also Admin-only — pinning a status
        # bypasses hours-based auto-derivation, which is a control we only
        # want admins to wield.
        instance = cast(Attendance, serializer.instance)
        actor = cast(User, self.request.user)
        is_admin = bool(instance.org and actor.is_admin_in(instance.org))
        if not is_admin:
            vd = serializer.validated_data
            if "login_time" in vd and vd["login_time"] != instance.login_time:
                vd["login_time"] = instance.login_time
            if "logout_time" in vd and vd["logout_time"] != instance.logout_time:
                vd["logout_time"] = instance.logout_time
            if "manual_status_override" in vd and vd["manual_status_override"] != instance.manual_status_override:
                vd["manual_status_override"] = instance.manual_status_override

        # WFH approval transition. Until this hook existed, a user could punch
        # in from Office and then edit the row to WFH — the row turned WFH
        # but ``approval_state`` stayed null, so the approval queue never
        # surfaced it for the manager. Mirror the create-side rule:
        #   - new WFH (transitioned from non-WFH, OR legacy WFH with null
        #     approval) → run ``_wfh_approval_fields`` (Pending for non-admin,
        #     auto-Approved for admin)
        #   - leaving WFH → clear approval_state / approver / approved_at /
        #     rejection_reason so the row no longer hangs around in approval
        #     queues
        new_loc = serializer.validated_data.get("work_location", instance.work_location)
        old_loc = instance.work_location
        save_kwargs: dict = {}
        becoming_wfh = new_loc == "WFH" and (old_loc != "WFH" or instance.approval_state is None)
        leaving_wfh = old_loc == "WFH" and new_loc != "WFH"
        if becoming_wfh:
            approval_state, approver_val, approved_at_val = self._wfh_approval_fields(
                new_loc,
                instance.user,
                instance.org,
            )
            save_kwargs.update(
                approval_state=approval_state,
                approver=approver_val,
                approved_at=approved_at_val,
                rejection_reason="",
            )
        elif leaving_wfh:
            save_kwargs.update(
                approval_state=None,
                approver=None,
                approved_at=None,
                rejection_reason="",
            )

        obj = serializer.save(**save_kwargs)
        broadcast("attendance", "UPDATE", AttendanceSerializer(obj).data)
        if becoming_wfh and obj.approval_state == "Pending":
            from core.leave.permissions import approver_pool

            pool = approver_pool(obj.user, obj.org)
            approver_uids = [str(uid) for uid in User.objects.filter(pk__in=pool).values_list("uid", flat=True)]
            broadcast(
                "attendance.approval",
                "PENDING",
                {
                    **AttendanceSerializer(obj).data,
                    "approver_uids": approver_uids,
                    "kind": "WFH",
                },
            )

    def perform_destroy(self, instance):
        broadcast("attendance", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()

    @action(detail=False, methods=["post"], url_path="quick_punch")
    def quick_punch(self, request):
        """Toggle today's punch-in/out for the calling user.

        Lands the row in the user's default org. If they have no default,
        use `perform_create`-style flow via the normal POST endpoint with an
        explicit ``org_id``.
        """
        user = cast(User, request.user)
        today = timezone.localdate()
        default_org = user.default_org
        if default_org is None:
            return Response({"error": "User is not a member of any organisation"}, status=400)

        # Optional punch-in context from the client: where the user works
        # from today (e.g. "Client Site") plus a free-text note (the UI
        # sends "Client: <name>"). Both are ignored on punch-out.
        requested_wl_raw = request.data.get("work_location")
        requested_wl: str | None = str(requested_wl_raw) if requested_wl_raw else None
        valid_locations = {choice[0] for choice in Attendance.LOCATION_CHOICES}
        if requested_wl is not None and requested_wl not in valid_locations:
            return Response({"error": "invalid work_location"}, status=400)
        requested_remarks = str(request.data.get("remarks") or "").strip()

        try:
            attendance = Attendance.objects.get(user=user, date=today)
        except Attendance.DoesNotExist:
            default_wl = str(getattr(user, "default_work_location", "Office") or "Office")
            wl: str = requested_wl or default_wl
            approval_state, approver_val, approved_at_val = self._wfh_approval_fields(
                wl,
                user,
                default_org,
            )
            attendance = Attendance.objects.create(
                user=user,
                date=today,
                login_time=timezone.localtime().time(),
                status="Present",
                work_location=wl,
                remarks=requested_remarks,
                approval_state=approval_state,
                approver=approver_val,
                approved_at=approved_at_val,
                created_by=user,
                org=default_org,
            )
            broadcast("attendance", "INSERT", AttendanceSerializer(attendance).data)
            return Response(AttendanceSerializer(attendance).data)

        if attendance.login_time and not attendance.logout_time:
            attendance.logout_time = timezone.localtime().time()
            attendance.save()
            broadcast("attendance", "UPDATE", AttendanceSerializer(attendance).data)
            return Response(AttendanceSerializer(attendance).data)

        if attendance.login_time and attendance.logout_time:
            return Response({"error": "already-punched-out"}, status=400)

        attendance.login_time = timezone.localtime().time()
        if requested_wl:
            attendance.work_location = requested_wl
        if requested_remarks:
            attendance.remarks = requested_remarks
        attendance.save()
        broadcast("attendance", "UPDATE", AttendanceSerializer(attendance).data)
        return Response(AttendanceSerializer(attendance).data)

    @action(detail=False, methods=["post"], url_path="bulk_import")
    def bulk_import(self, request):
        from django.core.cache import cache

        from core.settings_app.models import AppSetting

        user = cast(User, request.user)

        org, err = resolve_create_org(request)
        if err is not None:
            return err

        assert org is not None
        # Per-org backdate limit with a short cache to avoid a DB hit per row.
        cache_key = f"appsetting:{org.id}:attendance_backdate_days"
        backdate_days = cache.get(cache_key)
        if backdate_days is None:
            try:
                backdate_days = int(
                    AppSetting.objects.filter(org=org, key="attendance_backdate_days")
                    .values_list("value", flat=True)
                    .first()
                    or 7
                )
            except (TypeError, ValueError):
                backdate_days = 7
            cache.set(cache_key, backdate_days, timeout=300)

        # Role checks are per-org on the target org.
        is_admin = user.is_admin_in(org)
        is_manager = user.is_manager_in(org)
        can_backdate = is_manager  # admins are managers too

        subordinate_ids: set[int] = set()
        if is_manager and not is_admin:
            subordinate_ids = set(user.subordinates.values_list("id", flat=True))
            subordinate_ids.add(user.id)

        today = timezone.localdate()
        rows = request.data.get("rows", [])
        if not isinstance(rows, list):
            return Response({"error": "Expected rows array"}, status=400)

        created_count = failed_count = 0
        results = []
        for i, row in enumerate(rows):
            date_str = row.get("date")
            if not date_str:
                results.append({"index": i, "status": 400, "error": "date required"})
                failed_count += 1
                continue

            try:
                date = datetime.date.fromisoformat(date_str)
            except ValueError:
                results.append({"index": i, "status": 400, "error": "invalid date"})
                failed_count += 1
                continue

            if not can_backdate and (today - date).days > backdate_days:
                results.append({"index": i, "status": 400, "error": "backdate-violation", "max_days": backdate_days})
                failed_count += 1
                continue

            row_user = user
            target_uid = row.get("user_uid")
            if target_uid:
                candidate = User.objects.filter(uid=target_uid).first()
                if candidate is None:
                    results.append({"index": i, "status": 400, "error": "user not found"})
                    failed_count += 1
                    continue
                if is_admin:
                    row_user = candidate
                elif is_manager:
                    if candidate.id not in subordinate_ids:
                        results.append({"index": i, "status": 403, "error": "not authorized for this user"})
                        failed_count += 1
                        continue
                    row_user = candidate
                elif candidate.id != user.id:
                    results.append({"index": i, "status": 403, "error": "not authorized for this user"})
                    failed_count += 1
                    continue

            s = AttendanceSerializer(data={**row, "date": date_str}, context={"request": request})
            if not s.is_valid():
                results.append({"index": i, "status": 400, "error": str(s.errors)})
                failed_count += 1
                continue

            try:
                with transaction.atomic():
                    approval_state_b, approver_b, approved_at_b = self._wfh_approval_fields(
                        s.validated_data.get("work_location"),
                        row_user,
                        org,
                    )
                    obj = s.save(
                        user=row_user,
                        created_by=user,
                        org=org,
                        approval_state=approval_state_b,
                        approver=approver_b,
                        approved_at=approved_at_b,
                    )
                broadcast("attendance", "INSERT", AttendanceSerializer(obj).data)
                results.append({"index": i, "status": 201, "uid": str(obj.uid)})
                created_count += 1
            except Exception as exc:
                results.append({"index": i, "status": 400, "error": str(exc)})
                failed_count += 1

        return Response(
            {"created": created_count, "failed": failed_count, "results": results},
            status=207,
        )

    @action(detail=False, methods=["post"], url_path="set_status")
    def set_status(self, request):
        """Admin-only: pin a (user, date) cell to a specific status.

        Used by the Matrix view's click-to-edit. Creates the Attendance row
        if it doesn't exist or patches the existing one. ``manual_status_override``
        is set to True so save() won't re-derive the status from hours, and
        the matrix renderer prefers it over the holiday / Sunday rule.

        Body: ``{ "user_uid": str, "date": "YYYY-MM-DD", "status": str }``
        """
        actor = cast(User, request.user)
        user_uid = request.data.get("user_uid")
        date_str = request.data.get("date")
        status = request.data.get("status")

        if not user_uid or not date_str or not status:
            raise ValidationError({"detail": "user_uid, date and status are required"})
        if status not in ("Present", "Absent", "Half Day", "Leave", "Holiday"):
            raise ValidationError({"status": "must be Present / Absent / Half Day / Leave / Holiday"})
        try:
            date = datetime.date.fromisoformat(date_str)
        except ValueError as exc:
            raise ValidationError({"date": "must be YYYY-MM-DD"}) from exc

        target = User.objects.filter(uid=user_uid).first()
        if target is None:
            raise ValidationError({"user_uid": "user not found"})

        # The actor must be admin OR hold employee_access in at least one org
        # the target belongs to — employee_access is admin-equivalent inside
        # the Employee Management module, which is where the matrix lives.
        target_org_ids = set(target.memberships.values_list("org_id", flat=True))
        privileged_org_ids = set(
            actor.memberships.filter(Q(role="admin") | Q(employee_access=True)).values_list("org_id", flat=True)
        )
        shared_orgs = target_org_ids & privileged_org_ids
        if not shared_orgs:
            raise PermissionDenied({"detail": "Admin or employee-access role required in target user's org"})

        # Org assignment: prefer the target's existing default_org if it's
        # one we're privileged in, else any shared org.
        target_default_org_id = getattr(target.default_org, "id", None)
        if target_default_org_id in shared_orgs:
            org_id = target_default_org_id
        else:
            org_id = next(iter(shared_orgs))

        from users.models import Org

        org = Org.objects.get(pk=org_id)

        existing = Attendance.objects.filter(user=target, date=date).first()
        if existing is None:
            row = Attendance(
                user=target,
                date=date,
                org=org,
                status=status,
                manual_status_override=True,
                created_by=actor,
            )
            row.save()
            created = True
        else:
            existing.status = status
            existing.manual_status_override = True
            existing.save(update_fields=["status", "manual_status_override", "updated_at"])
            row = existing
            created = False

        payload = AttendanceSerializer(row).data
        broadcast("attendance", "INSERT" if created else "UPDATE", payload)
        return Response(payload, status=201 if created else 200)

    @action(detail=True, methods=["post"], url_path="approve_wfh")
    def approve_wfh(self, request, uid=None):
        from core.leave.permissions import can_approve

        instance: Attendance = self.get_object()
        if instance.work_location != "WFH" or instance.approval_state != "Pending":
            raise ValidationError({"detail": "Row is not a pending WFH entry"})
        actor = cast(User, request.user)
        if not can_approve(actor, instance.user, instance.org):
            raise PermissionDenied({"detail": "You are not in the approver pool"})
        instance.approval_state = "Approved"
        instance.approver = actor
        instance.approved_at = timezone.now()
        instance.rejection_reason = ""
        instance.save(update_fields=["approval_state", "approver", "approved_at", "rejection_reason", "updated_at"])
        payload = AttendanceSerializer(instance).data
        broadcast("attendance", "UPDATE", payload)
        broadcast("attendance.approval", "DECIDED", {**payload, "decision": "Approved", "kind": "WFH"})
        return Response(payload)

    @action(detail=True, methods=["post"], url_path="reject_wfh")
    def reject_wfh(self, request, uid=None):
        from core.leave.permissions import can_approve

        instance: Attendance = self.get_object()
        if instance.work_location != "WFH" or instance.approval_state != "Pending":
            raise ValidationError({"detail": "Row is not a pending WFH entry"})
        actor = cast(User, request.user)
        if not can_approve(actor, instance.user, instance.org):
            raise PermissionDenied({"detail": "You are not in the approver pool"})
        reason = (request.data.get("reason") or "").strip()
        if not reason:
            raise ValidationError({"reason": "Required when rejecting"})
        instance.approval_state = "Rejected"
        instance.approver = actor
        instance.approved_at = timezone.now()
        instance.rejection_reason = reason
        instance.save(update_fields=["approval_state", "approver", "approved_at", "rejection_reason", "updated_at"])
        payload = AttendanceSerializer(instance).data
        broadcast("attendance", "UPDATE", payload)
        broadcast("attendance.approval", "DECIDED", {**payload, "decision": "Rejected", "kind": "WFH"})
        return Response(payload)

    @action(detail=False, methods=["get"], url_path="approvals_pending")
    def approvals_pending(self, request):
        from core.leave.models import LeaveRequest
        from core.leave.permissions import can_approve

        actor = cast(User, request.user)

        wfh_qs = (
            Attendance.objects.select_related("user", "org")
            .filter(work_location="WFH", approval_state="Pending")
            .filter(_attendance_visibility_q(actor))
        )
        # LeaveRequest still uses the broader visibility_q — leave/Leads policy
        # hasn't been narrowed for managers, and aligning that is a separate
        # decision. ``can_approve`` still gates who can act on each row.
        leave_qs = (
            LeaveRequest.objects.select_related("user", "org")
            .filter(status="Pending")
            .filter(visibility_q(actor, "user"))
        )

        org_filter = request.query_params.get("org_uid")
        if org_filter:
            wfh_qs = wfh_qs.filter(org__uid=org_filter)
            leave_qs = leave_qs.filter(org__uid=org_filter)

        # TODO(perf): The per-row can_approve() filter executes 1-2 DB queries
        # per pending row. For pending queues over ~50 rows, replace with a
        # DB-level approver FK join.
        wfh_items = [r for r in wfh_qs if can_approve(actor, r.user, r.org)]
        leave_items = [r for r in leave_qs if can_approve(actor, r.user, r.org)]
        return Response(
            {
                "wfh_count": len(wfh_items),
                "leave_count": len(leave_items),
                "wfh_uids": [str(r.uid) for r in wfh_items],
                "leave_uids": [str(r.uid) for r in leave_items],
            }
        )

    @action(detail=False, methods=["get"], url_path="matrix")
    def matrix(self, request):
        from datetime import date as date_cls
        from datetime import timedelta

        from core.attendance.matrix import build_matrix
        from core.holidays.models import Holiday
        from core.leave.models import LeaveRequest
        from core.working_days.models import WorkingDayOverride

        actor = cast(User, request.user)
        month = request.query_params.get("month")
        if not month:
            return Response({"error": "month=YYYY-MM is required"}, status=400)
        try:
            year, mo = (int(p) for p in month.split("-"))
            first = date_cls(year, mo, 1)
        except ValueError:
            return Response({"error": "month must be YYYY-MM"}, status=400)
        # Last day of month
        if mo == 12:
            next_first = date_cls(year + 1, 1, 1)
        else:
            next_first = date_cls(year, mo + 1, 1)
        last = next_first - timedelta(days=1)
        dates = [first + timedelta(days=i) for i in range((last - first).days + 1)]

        # Visible employees. admin OR employee_access is admin-equivalent here
        # (employee_access grants admin rights inside Employee Management), so
        # both see every employee in the actor's orgs.
        is_admin_equiv = actor.memberships.filter(Q(role="admin") | Q(employee_access=True)).exists()
        emps = User.objects.filter(memberships__org_id__in=actor.org_ids()).distinct()
        if is_admin_equiv:
            pass  # every employee in the actor's orgs
        elif actor.memberships.filter(role="manager").exists():
            # Manager (not admin / no employee_access): self + direct subordinates.
            sub_ids = list(actor.subordinates.values_list("pk", flat=True))
            emps = emps.filter(pk__in=[*sub_ids, actor.pk])
        else:
            # Plain employee — only themselves.
            emps = emps.filter(pk=actor.pk)

        org_uid = request.query_params.get("org_uid")
        if org_uid:
            emps = emps.filter(memberships__org__uid=org_uid)
        emps = emps.prefetch_related("orgs").distinct()

        emp_ids = list(emps.values_list("pk", flat=True))
        attendance_rows = Attendance.objects.filter(user_id__in=emp_ids, date__range=(first, last))
        leave_rows = LeaveRequest.objects.filter(
            user_id__in=emp_ids,
            status="Approved",
            from_date__lte=last,
            to_date__gte=first,
        )
        holidays = Holiday.objects.filter(date__range=(first, last))
        overrides = WorkingDayOverride.objects.filter(date__range=(first, last))
        if org_uid:
            attendance_rows = attendance_rows.filter(org__uid=org_uid)
            leave_rows = leave_rows.filter(org__uid=org_uid)
            holidays = holidays.filter(org__uid=org_uid)
            overrides = overrides.filter(org__uid=org_uid)

        payload = build_matrix(
            employees=list(emps),
            dates=dates,
            attendance_rows=list(attendance_rows),
            leave_rows=list(leave_rows),
            holidays=list(holidays),
            overrides=list(overrides),
        )
        return Response(payload)
