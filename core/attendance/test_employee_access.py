"""``employee_access`` widens Attendance visibility (Matrix + Attendance Log).

The Matrix and Attendance Log tabs of the Employee Management module read the
Attendance endpoint, so an ``employee_access`` holder must see every
attendance row in the org — same breadth as an admin — even though their role
is only ``employee``.
"""

import datetime as dt

from django.test import TestCase
from rest_framework.test import APIClient

from core.attendance.models import Attendance
from users.models import Org, OrgMembership, User


class AttendanceEmployeeAccessTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")
        self.access_u = User.objects.create_user(email="acc@x", password="pw")
        self.emp_u = User.objects.create_user(email="e@x", password="pw")
        self.peer_u = User.objects.create_user(email="p@x", password="pw")

        OrgMembership.objects.create(
            user=self.access_u, org=self.org, role="employee", employee_access=True
        )
        OrgMembership.objects.create(user=self.emp_u, org=self.org, role="employee")
        OrgMembership.objects.create(user=self.peer_u, org=self.org, role="employee")

        for u in (self.access_u, self.emp_u, self.peer_u):
            Attendance.objects.create(
                user=u, org=self.org, date=dt.date(2026, 4, 25), status="Present"
            )

    def test_employee_access_user_sees_all_attendance(self):
        client = APIClient()
        client.force_authenticate(user=self.access_u)
        resp = client.get("/api/attendance/?month=2026-04")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        rows = body["results"] if isinstance(body, dict) else body
        self.assertEqual(len(rows), 3)

    def test_plain_employee_sees_only_own_attendance(self):
        client = APIClient()
        client.force_authenticate(user=self.emp_u)
        resp = client.get("/api/attendance/?month=2026-04")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        rows = body["results"] if isinstance(body, dict) else body
        self.assertEqual(len(rows), 1)

    def test_employee_access_user_can_set_matrix_status(self):
        """Matrix click-to-edit (set_status) works for employee_access too."""
        client = APIClient()
        client.force_authenticate(user=self.access_u)
        resp = client.post(
            "/api/attendance/set_status/",
            {"user_uid": str(self.peer_u.uid), "date": "2026-04-26", "status": "Present"},
            format="json",
        )
        self.assertIn(resp.status_code, (200, 201), resp.json())

    def test_plain_employee_cannot_set_matrix_status(self):
        client = APIClient()
        client.force_authenticate(user=self.emp_u)
        resp = client.post(
            "/api/attendance/set_status/",
            {"user_uid": str(self.peer_u.uid), "date": "2026-04-26", "status": "Present"},
            format="json",
        )
        self.assertEqual(resp.status_code, 403, resp.json())
