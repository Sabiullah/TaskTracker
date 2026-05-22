import datetime as dt

from django.test import TestCase
from rest_framework.test import APIClient

from core.attendance.matrix import CellInput, derive_cell
from users.models import Org, OrgMembership, User


def _att(login=None, logout=None, location="Office", approval=None, status="Present", manual_status_override=False):
    return {
        "login_time": login,
        "logout_time": logout,
        "work_location": location,
        "approval_state": approval,
        "status": status,
        "leave_session": None,
        "manual_status_override": manual_status_override,
    }


class DeriveCellTests(TestCase):
    D = dt.date(2026, 4, 23)  # Thursday
    SUN = dt.date(2026, 4, 26)  # Sunday

    def test_open_punch_wins_over_everything(self):
        cell = derive_cell(CellInput(self.D, False, False, None, _att(login="09:00"), []))
        self.assertEqual(cell["code"], "?")

    def test_sunday_renders_HD_when_no_override(self):
        cell = derive_cell(CellInput(self.SUN, False, False, None, None, []))
        self.assertEqual(cell["code"], "HD")

    def test_sunday_with_override_treats_as_workday(self):
        cell = derive_cell(CellInput(self.SUN, False, True, None, None, []))
        self.assertEqual(cell["code"], "A")

    def test_holiday_with_punch_renders_HW(self):
        cell = derive_cell(CellInput(self.D, True, False, "Republic Day", _att("09:00", "18:00"), []))
        self.assertEqual(cell["code"], "HW")
        self.assertEqual(cell["holiday_name"], "Republic Day")

    def test_wfh_pending(self):
        cell = derive_cell(CellInput(self.D, False, False, None, _att("09:00", "18:00", "WFH", "Pending"), []))
        self.assertEqual(cell["code"], "WP")

    def test_wfh_approved_full_day(self):
        cell = derive_cell(CellInput(self.D, False, False, None, _att("09:00", "18:00", "WFH", "Approved"), []))
        self.assertEqual(cell["code"], "WFH")

    def test_wfh_approved_without_punch_renders_as_WFH(self):
        # Future-dated WFH from a LeaveRequest materialisation: row exists
        # with approval_state='Approved' but no login/logout yet. Must render
        # as WFH, not Absent, even though hours is None.
        cell = derive_cell(
            CellInput(self.D, False, False, None, _att(None, None, "WFH", "Approved"), []),
        )
        self.assertEqual(cell["code"], "WFH")

    def test_wfh_approved_with_under_4h_still_falls_through_to_absent(self):
        # Once a punch exists, the >=4h floor applies — < 4h logged on a WFH
        # day means the employee didn't actually work it. Status='Absent' is
        # what the model's _derive_status would produce for a 3h punch.
        cell = derive_cell(
            CellInput(
                self.D,
                False,
                False,
                None,
                _att("09:00", "12:00", "WFH", "Approved", status="Absent"),
                [],
            ),
        )
        self.assertEqual(cell["code"], "A")

    def test_wfh_approved_no_punch_wins_over_leave_session(self):
        # A WFH-typed LeaveRequest materialises an Attendance row AND, if it
        # leaked into ``leave_sessions`` (defensive — build_matrix already
        # filters it out), the WFH branch must still win so we don't
        # double-render as 'L'.
        cell = derive_cell(
            CellInput(self.D, False, False, None, _att(None, None, "WFH", "Approved"), ["Full"]),
        )
        self.assertEqual(cell["code"], "WFH")

    def test_present_when_status_is_present(self):
        # Matrix now reads the stored status (which the model auto-derives
        # from hours: > 6h → Present).
        cell = derive_cell(CellInput(self.D, False, False, None, _att("09:00", "17:30", status="Present"), []))
        self.assertEqual(cell["code"], "P")
        self.assertEqual(cell["hours"], 8.5)

    def test_half_day_when_status_is_half_day(self):
        # 4–6h auto-derives to Half Day on the model; matrix reflects that.
        cell = derive_cell(CellInput(self.D, False, False, None, _att("09:00", "13:00", status="Half Day"), []))
        self.assertEqual(cell["code"], "H")

    def test_absent_when_status_is_absent(self):
        cell = derive_cell(CellInput(self.D, False, False, None, _att("09:00", "12:00", status="Absent"), []))
        self.assertEqual(cell["code"], "A")

    def test_full_leave(self):
        cell = derive_cell(CellInput(self.D, False, False, None, None, ["Full"]))
        self.assertEqual(cell["code"], "L")

    def test_half_leave_alone(self):
        cell = derive_cell(CellInput(self.D, False, False, None, None, ["First Half"]))
        self.assertEqual(cell["code"], "L½")

    def test_half_leave_plus_half_work(self):
        cell = derive_cell(
            CellInput(self.D, False, False, None, _att("13:00", "17:00", status="Half Day"), ["First Half"])
        )
        self.assertEqual(cell["code"], "L½+H")

    def test_absent_default(self):
        cell = derive_cell(CellInput(self.D, False, False, None, None, []))
        self.assertEqual(cell["code"], "A")

    def test_manual_override_beats_sunday_rule(self):
        # Admin pinned Sunday to Present via matrix click — override wins
        # over the Sunday → HD rule.
        a = _att(status="Present", manual_status_override=True)
        cell = derive_cell(CellInput(self.SUN, False, False, None, a, []))
        self.assertEqual(cell["code"], "P")

    def test_manual_override_beats_holiday_rule(self):
        a = _att(status="Absent", manual_status_override=True)
        cell = derive_cell(CellInput(self.D, True, False, "Republic Day", a, []))
        self.assertEqual(cell["code"], "A")

    def test_manual_override_beats_full_leave_session(self):
        a = _att(status="Present", manual_status_override=True)
        cell = derive_cell(CellInput(self.D, False, False, None, a, ["Full"]))
        self.assertEqual(cell["code"], "P")

    def test_open_punch_still_wins_over_override(self):
        # Even with override, an open punch is shown as ? so the admin
        # knows the underlying punch data is incomplete.
        a = _att(login="09:00", status="Present", manual_status_override=True)
        cell = derive_cell(CellInput(self.D, False, False, None, a, []))
        self.assertEqual(cell["code"], "?")


class MatrixVisibilityTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="VerifyOrg")
        self.admin = User.objects.create_user(email="adm@v.com", password="x", full_name="VerifyAdm")
        self.mgr = User.objects.create_user(email="mgr@v.com", password="x", full_name="VerifyMgr")
        self.emp = User.objects.create_user(email="emp@v.com", password="x", full_name="VerifyEmp")
        self.outsider = User.objects.create_user(email="out@v.com", password="x", full_name="VerifyOut")
        OrgMembership.objects.create(user=self.admin, org=self.org, role="admin")
        OrgMembership.objects.create(user=self.mgr, org=self.org, role="manager")
        OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")
        OrgMembership.objects.create(user=self.outsider, org=self.org, role="employee")
        self.emp.managers.add(self.mgr)  # mgr manages emp; outsider is unrelated

    def _client(self, user):
        c = APIClient(HTTP_HOST="localhost")
        c.force_authenticate(user=user)
        return c

    def _names(self, response):
        return sorted(e["full_name"] for e in response.json()["employees"])

    def test_admin_sees_all_employees_in_org(self):
        r = self._client(self.admin).get("/api/attendance/matrix/?month=2026-04")
        self.assertEqual(r.status_code, 200)
        self.assertSetEqual(set(self._names(r)), {"VerifyAdm", "VerifyMgr", "VerifyEmp", "VerifyOut"})

    def test_manager_sees_self_and_subordinates_only(self):
        r = self._client(self.mgr).get("/api/attendance/matrix/?month=2026-04")
        self.assertEqual(r.status_code, 200)
        # mgr + emp (subordinate) only — outsider excluded
        self.assertSetEqual(set(self._names(r)), {"VerifyMgr", "VerifyEmp"})

    def test_employee_sees_only_themselves(self):
        r = self._client(self.emp).get("/api/attendance/matrix/?month=2026-04")
        self.assertEqual(r.status_code, 200)
        self.assertSetEqual(set(self._names(r)), {"VerifyEmp"})

    def test_org_uid_filter_excludes_employees_outside_org(self):
        # Create a 2nd org with a user; admin is member of both.
        other_org = Org.objects.create(name="OtherOrg")
        other_emp = User.objects.create_user(email="other@v.com", password="x", full_name="OtherEmp")
        OrgMembership.objects.create(user=self.admin, org=other_org, role="admin")
        OrgMembership.objects.create(user=other_emp, org=other_org, role="employee")
        # ?org_uid=VerifyOrg → other_emp excluded
        r = self._client(self.admin).get(f"/api/attendance/matrix/?month=2026-04&org_uid={self.org.uid}")
        self.assertEqual(r.status_code, 200)
        names = set(self._names(r))
        self.assertNotIn("OtherEmp", names)
        self.assertIn("VerifyEmp", names)

    def test_payload_includes_30_april_dates(self):
        r = self._client(self.admin).get("/api/attendance/matrix/?month=2026-04")
        self.assertEqual(len(r.json()["dates"]), 30)


class MatrixWfhRenderingTests(TestCase):
    """End-to-end: a future-dated WFH LeaveRequest that's been approved
    must render as a WFH cell (not L) in the monthly matrix, and the
    matching date must NOT appear as a leave-session for the cell."""

    def setUp(self):
        from core.attendance.models import Attendance
        from core.leave.models import LeaveRequest

        self.Attendance = Attendance
        self.LeaveRequest = LeaveRequest

        self.org = Org.objects.create(name="MatrixOrg")
        self.admin = User.objects.create_user(email="a@m.com", password="x", full_name="MAdm")
        self.emp = User.objects.create_user(email="e@m.com", password="x", full_name="MEmp")
        OrgMembership.objects.create(user=self.admin, org=self.org, role="admin")
        OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")

    def _client(self, user):
        c = APIClient(HTTP_HOST="localhost")
        c.force_authenticate(user=user)
        return c

    def _cell_for(self, resp_json, user_uid, date_iso):
        return resp_json["cells"][user_uid][date_iso]

    def test_approved_wfh_request_renders_as_WFH_not_L(self):
        # Pick a Friday in mid-month so we never accidentally land on a Sunday.
        date = dt.date(2026, 5, 29)  # Fri
        req = self.LeaveRequest.objects.create(
            org=self.org,
            user=self.emp,
            from_date=date,
            to_date=date,
            reason="Plumber",
            request_type="WFH",
            status="Pending",
        )
        req.apply_state_transition("Approved", by_user=self.admin)
        # Sanity: materialise produced the Attendance row.
        att = self.Attendance.objects.get(user=self.emp, date=date)
        self.assertEqual(att.work_location, "WFH")
        self.assertEqual(att.approval_state, "Approved")

        r = self._client(self.admin).get(f"/api/attendance/matrix/?month=2026-05&org_uid={self.org.uid}")
        self.assertEqual(r.status_code, 200)
        cell = self._cell_for(r.json(), str(self.emp.uid), date.isoformat())
        self.assertEqual(cell["code"], "WFH")
