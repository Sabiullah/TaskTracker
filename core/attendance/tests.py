import datetime as dt

from django.test import TestCase
from rest_framework.test import APIClient

from core.attendance.models import Attendance
from users.models import Org, OrgMembership, User


class WfhApprovalTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")
        self.admin = User.objects.create_user(email="adm@x.com", password="x")
        self.mgr = User.objects.create_user(email="mgr@x.com", password="x")
        self.emp = User.objects.create_user(email="emp@x.com", password="x")
        OrgMembership.objects.create(user=self.admin, org=self.org, role="admin")
        OrgMembership.objects.create(user=self.mgr, org=self.org, role="manager")
        OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")
        self.emp.managers.add(self.mgr)

    def _client(self, user):
        c = APIClient()
        c.force_authenticate(user=user)
        return c

    def test_employee_wfh_starts_pending(self):
        c = self._client(self.emp)
        r = c.post(
            "/api/attendance/",
            {
                "user": str(self.emp.uid),
                "date": "2026-04-25",
                "status": "Present",
                "work_location": "WFH",
                "login_time": "09:00",
                "logout_time": "18:00",
                "org": str(self.org.uid),
            },
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.json())
        row = Attendance.objects.get(uid=r.json()["uid"])
        self.assertEqual(row.approval_state, "Pending")

    def test_admin_wfh_auto_approves(self):
        c = self._client(self.admin)
        r = c.post(
            "/api/attendance/",
            {
                "user": str(self.admin.uid),
                "date": "2026-04-25",
                "status": "Present",
                "work_location": "WFH",
                "login_time": "09:00",
                "logout_time": "18:00",
                "org": str(self.org.uid),
            },
            format="json",
        )
        self.assertEqual(r.status_code, 201)
        row = Attendance.objects.get(uid=r.json()["uid"])
        self.assertEqual(row.approval_state, "Approved")
        self.assertEqual(row.approver, self.admin)
        self.assertIsNotNone(row.approved_at)

    def test_manager_can_approve_employee_wfh(self):
        Attendance.objects.create(
            user=self.emp,
            org=self.org,
            date=dt.date(2026, 4, 25),
            status="Present",
            work_location="WFH",
            login_time=dt.time(9),
            logout_time=dt.time(18),
            approval_state="Pending",
        )
        row = Attendance.objects.get(user=self.emp, date="2026-04-25")
        c = self._client(self.mgr)
        r = c.post(f"/api/attendance/{row.uid}/approve_wfh/")
        self.assertEqual(r.status_code, 200, r.json())
        row.refresh_from_db()
        self.assertEqual(row.approval_state, "Approved")
        self.assertEqual(row.approver, self.mgr)

    def test_employee_cannot_approve_own_wfh(self):
        Attendance.objects.create(
            user=self.emp,
            org=self.org,
            date=dt.date(2026, 4, 26),
            status="Present",
            work_location="WFH",
            login_time=dt.time(9),
            logout_time=dt.time(18),
            approval_state="Pending",
        )
        row = Attendance.objects.get(user=self.emp, date="2026-04-26")
        c = self._client(self.emp)
        r = c.post(f"/api/attendance/{row.uid}/approve_wfh/")
        self.assertEqual(r.status_code, 403)

    def test_reject_requires_reason(self):
        Attendance.objects.create(
            user=self.emp,
            org=self.org,
            date=dt.date(2026, 4, 27),
            status="Present",
            work_location="WFH",
            login_time=dt.time(9),
            logout_time=dt.time(18),
            approval_state="Pending",
        )
        row = Attendance.objects.get(user=self.emp, date="2026-04-27")
        c = self._client(self.mgr)
        r = c.post(f"/api/attendance/{row.uid}/reject_wfh/", {}, format="json")
        self.assertEqual(r.status_code, 400)
        r = c.post(f"/api/attendance/{row.uid}/reject_wfh/", {"reason": "team day"}, format="json")
        self.assertEqual(r.status_code, 200)
        row.refresh_from_db()
        self.assertEqual(row.approval_state, "Rejected")
        self.assertEqual(row.rejection_reason, "team day")

    def test_approvals_pending_for_manager(self):
        # Create one Pending WFH row owned by the employee
        Attendance.objects.create(
            user=self.emp,
            org=self.org,
            date=dt.date(2026, 4, 28),
            status="Present",
            work_location="WFH",
            login_time=dt.time(9),
            logout_time=dt.time(18),
            approval_state="Pending",
        )
        # Manager sees it
        c = self._client(self.mgr)
        r = c.get("/api/attendance/approvals_pending/")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["wfh_count"], 1)
        self.assertEqual(body["leave_count"], 0)
        self.assertEqual(len(body["wfh_uids"]), 1)
        # Employee sees nothing (cannot approve own)
        c2 = self._client(self.emp)
        r2 = c2.get("/api/attendance/approvals_pending/")
        self.assertEqual(r2.json()["wfh_count"], 0)

    def test_patch_cannot_change_approval_state(self):
        # Create a Pending WFH row as employee
        Attendance.objects.create(
            user=self.emp,
            org=self.org,
            date=dt.date(2026, 4, 29),
            status="Present",
            work_location="WFH",
            login_time=dt.time(9),
            logout_time=dt.time(18),
            approval_state="Pending",
        )
        row = Attendance.objects.get(user=self.emp, date="2026-04-29")
        # Attempt to PATCH approval_state directly — should be silently ignored
        c = self._client(self.emp)
        c.patch(f"/api/attendance/{row.uid}/", {"approval_state": "Approved"}, format="json")
        # Patch may succeed but field stays Pending
        row.refresh_from_db()
        self.assertEqual(row.approval_state, "Pending")

    def test_status_auto_flips_to_absent_when_under_4_hours(self):
        # Punch-in followed immediately by punch-out (0 hours) — the row
        # should land as Absent even though the create payload says Present.
        Attendance.objects.create(
            user=self.emp,
            org=self.org,
            date=dt.date(2026, 5, 1),
            status="Present",
            work_location="Office",
            login_time=dt.time(14, 2),
            logout_time=dt.time(14, 2),
        )
        row = Attendance.objects.get(user=self.emp, date="2026-05-1")
        self.assertEqual(row.status, "Absent")
        self.assertEqual(row.worked_minutes, 0)
        self.assertEqual(row.worked_hours, 0.0)

    def test_status_auto_derives_half_day_for_4_to_6_hours(self):
        # 4.5 hours falls inside the Half Day band (4 ≤ h ≤ 6) and should
        # auto-derive to Half Day even when the create payload says Present.
        Attendance.objects.create(
            user=self.emp,
            org=self.org,
            date=dt.date(2026, 5, 2),
            status="Present",
            work_location="Office",
            login_time=dt.time(9),
            logout_time=dt.time(13, 30),
        )
        row = Attendance.objects.get(user=self.emp, date="2026-05-2")
        self.assertEqual(row.status, "Half Day")
        self.assertEqual(row.worked_hours, 4.5)

    def test_status_at_exactly_6_hours_is_half_day(self):
        # Boundary check: "more than 6h" → Present, so exactly 6h is Half Day.
        Attendance.objects.create(
            user=self.emp,
            org=self.org,
            date=dt.date(2026, 5, 12),
            status="Present",
            work_location="Office",
            login_time=dt.time(9),
            logout_time=dt.time(15),
        )
        row = Attendance.objects.get(user=self.emp, date="2026-05-12")
        self.assertEqual(row.status, "Half Day")

    def test_status_just_over_6_hours_is_present(self):
        Attendance.objects.create(
            user=self.emp,
            org=self.org,
            date=dt.date(2026, 5, 13),
            status="Present",
            work_location="Office",
            login_time=dt.time(9),
            logout_time=dt.time(15, 1),  # 6h 1m
        )
        row = Attendance.objects.get(user=self.emp, date="2026-05-13")
        self.assertEqual(row.status, "Present")

    def test_status_derivation_overwrites_half_day_when_hours_disagree(self):
        # Without the manual_status_override flag, Half Day chosen at create
        # time is just a hint — auto-derivation re-computes from hours.
        # 1 hour is Absent under the new rule.
        Attendance.objects.create(
            user=self.emp,
            org=self.org,
            date=dt.date(2026, 5, 3),
            status="Half Day",
            work_location="Office",
            login_time=dt.time(9),
            logout_time=dt.time(10),
        )
        row = Attendance.objects.get(user=self.emp, date="2026-05-3")
        self.assertEqual(row.status, "Absent")

    def test_manual_status_override_pins_status(self):
        # With manual_status_override=True the admin's chosen status sticks
        # even if hours disagree.
        Attendance.objects.create(
            user=self.emp,
            org=self.org,
            date=dt.date(2026, 5, 14),
            status="Half Day",
            work_location="Office",
            login_time=dt.time(9),
            logout_time=dt.time(18),  # 9h would normally → Present
            manual_status_override=True,
        )
        row = Attendance.objects.get(user=self.emp, date="2026-05-14")
        self.assertEqual(row.status, "Half Day")

    def test_admin_can_pin_status_via_patch(self):
        # Admin overrides a 9-hour shift to Half Day via the API. The
        # override flag must persist and the chosen status must stick.
        Attendance.objects.create(
            user=self.emp,
            org=self.org,
            date=dt.date(2026, 5, 15),
            status="Present",
            work_location="Office",
            login_time=dt.time(9),
            logout_time=dt.time(18),
        )
        row = Attendance.objects.get(user=self.emp, date="2026-05-15")
        c = self._client(self.admin)
        r = c.patch(
            f"/api/attendance/{row.uid}/",
            {"status": "Half Day", "manual_status_override": True},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.json())
        row.refresh_from_db()
        self.assertEqual(row.status, "Half Day")
        self.assertTrue(row.manual_status_override)

    def test_employee_cannot_pin_status_via_patch(self):
        # An employee tries to pin Present on a 1-hour shift to escape the
        # auto-flip to Absent. The override flag must be silently dropped.
        Attendance.objects.create(
            user=self.emp,
            org=self.org,
            date=dt.date(2026, 5, 16),
            status="Present",
            work_location="Office",
            login_time=dt.time(9),
            logout_time=dt.time(10),  # 1h → Absent under new rule
        )
        row = Attendance.objects.get(user=self.emp, date="2026-05-16")
        # Sanity: hours-derivation already flipped it to Absent.
        self.assertEqual(row.status, "Absent")
        c = self._client(self.emp)
        r = c.patch(
            f"/api/attendance/{row.uid}/",
            {"status": "Present", "manual_status_override": True},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.json())
        row.refresh_from_db()
        # Override flag was rejected → save() re-derived to Absent.
        self.assertFalse(row.manual_status_override)
        self.assertEqual(row.status, "Absent")

    def test_status_derivation_does_not_overwrite_leave(self):
        Attendance.objects.create(
            user=self.emp,
            org=self.org,
            date=dt.date(2026, 5, 4),
            status="Leave",
        )
        row = Attendance.objects.get(user=self.emp, date="2026-05-4")
        self.assertEqual(row.status, "Leave")

    def test_total_hours_in_serializer_payload(self):
        from core.attendance.serializers import AttendanceSerializer

        row = Attendance.objects.create(
            user=self.emp,
            org=self.org,
            date=dt.date(2026, 5, 5),
            status="Present",
            work_location="Office",
            login_time=dt.time(9),
            logout_time=dt.time(17, 30),
        )
        data = AttendanceSerializer(row).data
        self.assertEqual(data["total_hours"], 8.5)

    def test_patch_office_to_wfh_starts_pending_for_employee(self):
        # Reproduces the bug where an employee punched in Office, then edited
        # the row to WFH, and the row stayed approval_state=null — invisible
        # to the manager's approval queue.
        Attendance.objects.create(
            user=self.emp,
            org=self.org,
            date=dt.date(2026, 5, 6),
            status="Present",
            work_location="Office",
            login_time=dt.time(9),
            logout_time=dt.time(18),
        )
        row = Attendance.objects.get(user=self.emp, date="2026-05-6")
        self.assertIsNone(row.approval_state)
        c = self._client(self.emp)
        r = c.patch(f"/api/attendance/{row.uid}/", {"work_location": "WFH"}, format="json")
        self.assertEqual(r.status_code, 200, r.json())
        row.refresh_from_db()
        self.assertEqual(row.work_location, "WFH")
        self.assertEqual(row.approval_state, "Pending")

    def test_patch_legacy_wfh_with_null_approval_becomes_pending(self):
        # Rows created before the WFH approval feature can have
        # work_location=WFH AND approval_state=None. Editing such a row
        # should re-trigger the approval flow.
        Attendance.objects.create(
            user=self.emp,
            org=self.org,
            date=dt.date(2026, 5, 7),
            status="Present",
            work_location="WFH",
            login_time=dt.time(9),
            logout_time=dt.time(18),
            approval_state=None,
        )
        row = Attendance.objects.get(user=self.emp, date="2026-05-7")
        c = self._client(self.emp)
        r = c.patch(f"/api/attendance/{row.uid}/", {"remarks": "fixing legacy"}, format="json")
        self.assertEqual(r.status_code, 200, r.json())
        row.refresh_from_db()
        self.assertEqual(row.approval_state, "Pending")

    def test_patch_wfh_to_office_clears_approval(self):
        Attendance.objects.create(
            user=self.emp,
            org=self.org,
            date=dt.date(2026, 5, 8),
            status="Present",
            work_location="WFH",
            login_time=dt.time(9),
            logout_time=dt.time(18),
            approval_state="Pending",
        )
        row = Attendance.objects.get(user=self.emp, date="2026-05-8")
        c = self._client(self.emp)
        r = c.patch(f"/api/attendance/{row.uid}/", {"work_location": "Office"}, format="json")
        self.assertEqual(r.status_code, 200, r.json())
        row.refresh_from_db()
        self.assertEqual(row.work_location, "Office")
        self.assertIsNone(row.approval_state)
        self.assertIsNone(row.approver)

    def test_patch_admin_wfh_auto_approves(self):
        Attendance.objects.create(
            user=self.admin,
            org=self.org,
            date=dt.date(2026, 5, 9),
            status="Present",
            work_location="Office",
            login_time=dt.time(9),
            logout_time=dt.time(18),
        )
        row = Attendance.objects.get(user=self.admin, date="2026-05-9")
        c = self._client(self.admin)
        r = c.patch(f"/api/attendance/{row.uid}/", {"work_location": "WFH"}, format="json")
        self.assertEqual(r.status_code, 200)
        row.refresh_from_db()
        self.assertEqual(row.approval_state, "Approved")
        self.assertEqual(row.approver, self.admin)

    def test_bulk_import_wfh_row_starts_pending_for_employee(self):
        c = self._client(self.emp)
        r = c.post(
            "/api/attendance/bulk_import/",
            {
                "rows": [
                    {
                        "user": str(self.emp.uid),
                        "user_uid": str(self.emp.uid),
                        "date": "2026-04-30",
                        "status": "Present",
                        "work_location": "WFH",
                        "login_time": "09:00",
                        "logout_time": "18:00",
                    },
                ],
            },
            format="json",
        )
        self.assertEqual(r.status_code, 207)
        row = Attendance.objects.get(user=self.emp, date="2026-04-30")
        self.assertEqual(row.approval_state, "Pending")
        self.assertIsNone(row.approver)


class AttendanceLogVisibilityTests(TestCase):
    """Mirror of MatrixVisibilityTests but for the AttendanceViewSet list.

    Bug: a manager was seeing every attendance row in the org instead of
    just their direct reports + themselves. The matrix endpoint already had
    the right scoping; the list endpoint did not because it leaned on the
    shared ``visibility_q`` helper, which (by design) treats managers like
    admins for Tasks/WorkLog/Leads.
    """

    def setUp(self):
        self.org = Org.objects.create(name="VOrg")
        self.admin = User.objects.create_user(email="adm@v.com", password="x", full_name="V_Adm")
        self.mgr = User.objects.create_user(email="mgr@v.com", password="x", full_name="V_Mgr")
        self.emp = User.objects.create_user(email="emp@v.com", password="x", full_name="V_Emp")
        self.outsider = User.objects.create_user(email="out@v.com", password="x", full_name="V_Out")
        OrgMembership.objects.create(user=self.admin, org=self.org, role="admin")
        OrgMembership.objects.create(user=self.mgr, org=self.org, role="manager")
        OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")
        OrgMembership.objects.create(user=self.outsider, org=self.org, role="employee")
        self.emp.managers.add(self.mgr)  # mgr supervises emp; outsider is unrelated

        for u in (self.admin, self.mgr, self.emp, self.outsider):
            Attendance.objects.create(
                user=u,
                org=self.org,
                date=dt.date(2026, 4, 25),
                status="Present",
                work_location="Office",
                login_time=dt.time(9),
                logout_time=dt.time(18),
            )

    def _client(self, user):
        c = APIClient()
        c.force_authenticate(user=user)
        return c

    def _names(self, response):
        return sorted(r["user_detail"]["full_name"] for r in response.json()["results"])

    def test_admin_sees_all_attendance_rows(self):
        r = self._client(self.admin).get("/api/attendance/?date=2026-04-25")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(set(self._names(r)), {"V_Adm", "V_Mgr", "V_Emp", "V_Out"})

    def test_manager_sees_self_and_subordinates_only(self):
        r = self._client(self.mgr).get("/api/attendance/?date=2026-04-25")
        self.assertEqual(r.status_code, 200)
        # mgr + emp (supervised) only — admin and outsider excluded
        self.assertEqual(set(self._names(r)), {"V_Mgr", "V_Emp"})

    def test_employee_sees_only_themselves(self):
        r = self._client(self.emp).get("/api/attendance/?date=2026-04-25")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(set(self._names(r)), {"V_Emp"})

    def test_outsider_employee_only_sees_themselves(self):
        r = self._client(self.outsider).get("/api/attendance/?date=2026-04-25")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(set(self._names(r)), {"V_Out"})

    def test_approvals_pending_excludes_non_subordinate_wfh(self):
        # WFH from outsider (NOT in mgr's reporting line) → mgr must not see
        # it in the approval queue, even though they're a manager in the org.
        Attendance.objects.create(
            user=self.outsider,
            org=self.org,
            date=dt.date(2026, 4, 26),
            status="Present",
            work_location="WFH",
            login_time=dt.time(9),
            logout_time=dt.time(18),
            approval_state="Pending",
        )
        # WFH from emp (mgr's report) → mgr must see it.
        Attendance.objects.create(
            user=self.emp,
            org=self.org,
            date=dt.date(2026, 4, 26),
            status="Present",
            work_location="WFH",
            login_time=dt.time(9),
            logout_time=dt.time(18),
            approval_state="Pending",
        )
        r = self._client(self.mgr).get("/api/attendance/approvals_pending/")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["wfh_count"], 1)
