import datetime as dt

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from core.attendance.models import Attendance
from core.leave.models import LeaveRequest
from core.leave.permissions import approver_pool, can_approve
from users.models import Org, OrgMembership, User


class ApproverPoolTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")
        self.admin = User.objects.create_user(email="a@x.com", password="x", full_name="Admin A")
        self.admin2 = User.objects.create_user(email="b@x.com", password="x", full_name="Admin B")
        self.mgr = User.objects.create_user(email="m@x.com", password="x", full_name="Manager M")
        self.emp = User.objects.create_user(email="e@x.com", password="x", full_name="Employee E")
        OrgMembership.objects.create(user=self.admin, org=self.org, role="admin")
        OrgMembership.objects.create(user=self.admin2, org=self.org, role="admin")
        OrgMembership.objects.create(user=self.mgr, org=self.org, role="manager")
        OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")
        self.emp.managers.add(self.mgr)

    def test_admin_pool_is_empty(self):
        self.assertEqual(approver_pool(self.admin, self.org), [])

    def test_manager_pool_excludes_self(self):
        pool = approver_pool(self.mgr, self.org)
        self.assertIn(self.admin.pk, pool)
        self.assertIn(self.admin2.pk, pool)
        self.assertNotIn(self.mgr.pk, pool)

    def test_employee_pool_is_their_managers(self):
        pool = approver_pool(self.emp, self.org)
        self.assertEqual(pool, [self.mgr.pk])

    def test_employee_without_manager_falls_back_to_org_admins(self):
        self.emp.managers.clear()
        pool = approver_pool(self.emp, self.org)
        self.assertSetEqual(set(pool), {self.admin.pk, self.admin2.pk})

    def test_employee_manager_must_be_member_of_request_org(self):
        """A manager who exists but isn't a member of `org` must NOT appear
        in the pool — falls back to the org's admins instead."""
        other_org = Org.objects.create(name="YBV")
        outside_mgr = User.objects.create_user(email="om@x.com", password="x")
        OrgMembership.objects.create(user=outside_mgr, org=other_org, role="manager")
        # Employee's manager is the outside_mgr (no membership in `self.org`).
        self.emp.managers.clear()
        self.emp.managers.add(outside_mgr)
        pool = approver_pool(self.emp, self.org)
        self.assertNotIn(outside_mgr.pk, pool)
        # Falls back to org admins.
        self.assertSetEqual(set(pool), {self.admin.pk, self.admin2.pk})

    def test_can_approve_blocks_self(self):
        self.assertFalse(can_approve(self.admin, self.admin, self.org))

    def test_can_approve_allows_admin_for_manager_request(self):
        self.assertTrue(can_approve(self.admin, self.mgr, self.org))

    def test_can_approve_admin_override_when_employee_has_manager(self):
        """Admin override: the pool routes notifications to the manager,
        but an org admin may still approve the request directly."""
        self.assertEqual(approver_pool(self.emp, self.org), [self.mgr.pk])
        self.assertTrue(can_approve(self.admin, self.emp, self.org))
        self.assertTrue(can_approve(self.admin2, self.emp, self.org))

    def test_can_approve_blocks_unrelated_user(self):
        outsider = User.objects.create_user(email="o@x.com", password="x")
        self.assertFalse(can_approve(outsider, self.emp, self.org))

    def test_can_approve_admin_in_other_org_is_blocked(self):
        """An admin in a different org has no authority over this org's
        leave requests — admin override is org-scoped."""
        other_org = Org.objects.create(name="YBV")
        other_admin = User.objects.create_user(email="oa@x.com", password="x")
        OrgMembership.objects.create(user=other_admin, org=other_org, role="admin")
        self.assertFalse(can_approve(other_admin, self.emp, self.org))


def _future_workdays(count: int) -> list[dt.date]:
    """Return ``count`` consecutive non-Sunday dates starting from tomorrow.

    Used by WFH-materialisation tests so the date range is always in the
    future (employees can't punch in yet) and Sundays don't silently shrink
    the included-dates set under us.
    """
    out: list[dt.date] = []
    cursor = timezone.localdate() + dt.timedelta(days=1)
    while len(out) < count:
        if cursor.weekday() != 6:  # skip Sundays
            out.append(cursor)
        cursor += dt.timedelta(days=1)
    return out


class WfhRequestMaterialisationTests(TestCase):
    """``request_type='WFH'`` reuses the Leave approval pipeline but
    materialises into ``status=Present + work_location=WFH + approval_state=Approved``
    Attendance rows. These tests pin the wiring end-to-end so a future
    refactor that splits the path doesn't silently break either side."""

    def setUp(self):
        self.org = Org.objects.create(name="4D")
        self.admin = User.objects.create_user(email="a@x.com", password="x", full_name="Admin")
        self.mgr = User.objects.create_user(email="m@x.com", password="x", full_name="Manager")
        self.emp = User.objects.create_user(email="e@x.com", password="x", full_name="Employee")
        OrgMembership.objects.create(user=self.admin, org=self.org, role="admin")
        OrgMembership.objects.create(user=self.mgr, org=self.org, role="manager")
        OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")
        self.emp.managers.add(self.mgr)

    def _file_wfh(self, dates: list[dt.date]) -> LeaveRequest:
        return LeaveRequest.objects.create(
            org=self.org,
            user=self.emp,
            from_date=dates[0],
            to_date=dates[-1],
            reason="Plumber visit",
            request_type="WFH",
            status="Pending",
        )

    def test_request_type_defaults_to_leave(self):
        days = _future_workdays(1)
        req = LeaveRequest.objects.create(
            org=self.org,
            user=self.emp,
            from_date=days[0],
            to_date=days[0],
            reason="x",
        )
        self.assertEqual(req.request_type, "Leave")

    def test_approve_materialises_wfh_attendance_rows(self):
        days = _future_workdays(2)
        req = self._file_wfh(days)

        req.apply_state_transition("Approved", by_user=self.mgr)

        rows = list(Attendance.objects.filter(user=self.emp, date__in=days).order_by("date"))
        self.assertEqual(len(rows), 2)
        for row in rows:
            self.assertEqual(row.status, "Present")
            self.assertEqual(row.work_location, "WFH")
            self.assertEqual(row.approval_state, "Approved")
            assert row.approver is not None
            self.assertEqual(row.approver.pk, self.mgr.pk)
            self.assertIsNone(row.login_time)
            self.assertIsNone(row.logout_time)

    def test_withdraw_demolishes_wfh_rows(self):
        days = _future_workdays(2)
        req = self._file_wfh(days)
        req.apply_state_transition("Approved", by_user=self.mgr)
        self.assertEqual(Attendance.objects.filter(user=self.emp, date__in=days).count(), 2)

        req.apply_state_transition("Withdrawn", by_user=self.emp)

        self.assertEqual(Attendance.objects.filter(user=self.emp, date__in=days).count(), 0)

    def test_leave_path_still_materialises_as_leave(self):
        """Regression guard: existing Leave flow must keep producing
        ``status=Leave`` rows when ``request_type`` is left at its default."""
        days = _future_workdays(1)
        req = LeaveRequest.objects.create(
            org=self.org,
            user=self.emp,
            from_date=days[0],
            to_date=days[0],
            reason="Sick",
        )
        req.apply_state_transition("Approved", by_user=self.mgr)
        row = Attendance.objects.get(user=self.emp, date=days[0])
        self.assertEqual(row.status, "Leave")
        self.assertEqual(row.work_location, "Office")


class ApproveConflictGuardTests(TestCase):
    """Conflict-on-date rules in ``LeaveRequestViewSet.approve``.

    The view-level guard must stay in lockstep with
    ``signals.materialise_attendance``: any pairing the materialiser can
    safely handle should NOT be flagged as a conflict here. Tests cover
    each branch of that contract end-to-end through the HTTP layer.
    """

    def setUp(self):
        self.org = Org.objects.create(name="4D")
        self.admin = User.objects.create_user(email="a@x.com", password="x", full_name="Admin")
        self.mgr = User.objects.create_user(email="m@x.com", password="x", full_name="Manager")
        self.emp = User.objects.create_user(email="e@x.com", password="x", full_name="Employee")
        OrgMembership.objects.create(user=self.admin, org=self.org, role="admin")
        OrgMembership.objects.create(user=self.mgr, org=self.org, role="manager")
        OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")
        self.emp.managers.add(self.mgr)
        # Use a fixed past workday so we can preseed Attendance freely.
        # Saturday 2024-06-01 is non-Sunday, non-Holiday for the test org.
        self.day = dt.date(2024, 6, 1)
        self.client_ = APIClient()
        self.client_.force_authenticate(user=self.admin)

    def _file(self, *, from_session: str, to_session: str) -> LeaveRequest:
        return LeaveRequest.objects.create(
            org=self.org,
            user=self.emp,
            from_date=self.day,
            to_date=self.day,
            from_session=from_session,
            to_session=to_session,
            reason="Family trip",
            status="Pending",
        )

    def _approve(self, req: LeaveRequest):
        return self.client_.post(f"/api/leave-requests/{req.uid}/approve/")

    def test_half_day_attendance_plus_half_session_leave_is_allowed(self):
        """The Akilan case: employee worked first half, then files a
        Second-Half leave. ``materialise_attendance`` annotates the row;
        the view guard must let it through."""
        Attendance.objects.create(
            user=self.emp,
            org=self.org,
            date=self.day,
            login_time=dt.time(9, 0),
            logout_time=dt.time(13, 0),  # ~4h → Half Day
        )
        req = self._file(from_session="Second Half", to_session="Second Half")

        resp = self._approve(req)

        self.assertEqual(resp.status_code, 200, resp.content)
        req.refresh_from_db()
        self.assertEqual(req.status, "Approved")

    def test_half_day_attendance_plus_full_session_leave_is_conflict(self):
        """A Full leave on a Half Day row is genuinely ambiguous — which
        half was worked? Keep it as a conflict for manual review."""
        Attendance.objects.create(
            user=self.emp,
            org=self.org,
            date=self.day,
            login_time=dt.time(9, 0),
            logout_time=dt.time(13, 0),
        )
        req = self._file(from_session="Full", to_session="Full")

        resp = self._approve(req)

        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json().get("detail"), "conflict-on-date")
        self.assertEqual(resp.json().get("dates"), [str(self.day)])

    def test_present_attendance_is_always_conflict(self):
        """A full Present day flatly contradicts any leave on that date."""
        Attendance.objects.create(
            user=self.emp,
            org=self.org,
            date=self.day,
            login_time=dt.time(9, 0),
            logout_time=dt.time(18, 0),  # >6h → Present
        )
        req = self._file(from_session="Second Half", to_session="Second Half")

        resp = self._approve(req)

        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json().get("detail"), "conflict-on-date")

    def test_absent_with_punches_plus_half_session_promotes_to_half_day(self):
        """Real-world case: employee logs ~4h then files a Second-Half leave.
        Even when the hours land just under the threshold (so the row is
        Absent, not Half Day) the leave should approve and the row should be
        promoted to Half Day with a leave annotation."""
        Attendance.objects.create(
            user=self.emp,
            org=self.org,
            date=self.day,
            login_time=dt.time(10, 0),
            logout_time=dt.time(13, 30),  # 3.5h → Absent on save
        )
        req = self._file(from_session="Second Half", to_session="Second Half")

        resp = self._approve(req)

        self.assertEqual(resp.status_code, 200, resp.content)
        row = Attendance.objects.get(user=self.emp, date=self.day)
        self.assertEqual(row.status, "Half Day")
        self.assertTrue(row.manual_status_override)
        self.assertIn("[leave: second half]", row.remarks)
        # Punch times must survive — they're the record of what was worked.
        self.assertEqual(row.login_time, dt.time(10, 0))
        self.assertEqual(row.logout_time, dt.time(13, 30))

    def test_absent_without_login_is_conflict(self):
        """A no-show Absent has no worked hours to anchor — a half-session
        leave is ambiguous (which half?) so it stays a conflict."""
        Attendance.objects.create(
            user=self.emp,
            org=self.org,
            date=self.day,
            status="Absent",
            manual_status_override=True,  # pin so save() doesn't re-derive
        )
        req = self._file(from_session="Second Half", to_session="Second Half")

        resp = self._approve(req)

        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json().get("detail"), "conflict-on-date")

    def test_absent_with_punches_plus_full_leave_is_conflict(self):
        """Full leave on an Absent-with-punches row is still ambiguous — the
        leave covers the whole day, but the employee clearly worked some of
        it. Punt to manual review."""
        Attendance.objects.create(
            user=self.emp,
            org=self.org,
            date=self.day,
            login_time=dt.time(10, 0),
            logout_time=dt.time(13, 30),
        )
        req = self._file(from_session="Full", to_session="Full")

        resp = self._approve(req)

        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json().get("detail"), "conflict-on-date")
