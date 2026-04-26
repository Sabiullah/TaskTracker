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
