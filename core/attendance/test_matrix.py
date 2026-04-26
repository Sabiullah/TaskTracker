import datetime as dt

from django.test import TestCase

from core.attendance.matrix import CellInput, derive_cell


def _att(login=None, logout=None, location="Office", approval=None, status="Present"):
    return {
        "login_time": login,
        "logout_time": logout,
        "work_location": location,
        "approval_state": approval,
        "status": status,
        "leave_session": None,
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

    def test_present_at_exactly_85_hours(self):
        cell = derive_cell(CellInput(self.D, False, False, None, _att("09:00", "17:30"), []))
        self.assertEqual(cell["code"], "P")
        self.assertEqual(cell["hours"], 8.5)

    def test_half_day_at_4_hours(self):
        cell = derive_cell(CellInput(self.D, False, False, None, _att("09:00", "13:00"), []))
        self.assertEqual(cell["code"], "H")

    def test_under_4_hours_with_no_explicit_present_becomes_A(self):
        cell = derive_cell(CellInput(self.D, False, False, None, _att("09:00", "12:00", status="Half Day"), []))
        # 3 hours, Half Day status — falls through; status='Present' would force P.
        self.assertEqual(cell["code"], "A")

    def test_full_leave(self):
        cell = derive_cell(CellInput(self.D, False, False, None, None, ["Full"]))
        self.assertEqual(cell["code"], "L")

    def test_half_leave_alone(self):
        cell = derive_cell(CellInput(self.D, False, False, None, None, ["First Half"]))
        self.assertEqual(cell["code"], "L½")

    def test_half_leave_plus_half_work(self):
        cell = derive_cell(CellInput(self.D, False, False, None, _att("13:00", "17:00", status="Half Day"), ["First Half"]))
        self.assertEqual(cell["code"], "L½+H")

    def test_absent_default(self):
        cell = derive_cell(CellInput(self.D, False, False, None, None, []))
        self.assertEqual(cell["code"], "A")
