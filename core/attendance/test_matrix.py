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
        self.assertEqual(r.json()["dates"][0]["date"], "2026-04-01")
        self.assertEqual(r.json()["dates"][-1]["date"], "2026-04-30")
