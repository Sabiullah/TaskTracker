from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase
from rest_framework.test import APIClient

from core.employees.models import Employee
from core.masters.models import Master
from users.models import Org, OrgMembership, User

from .models import CostingEntry, EmployeeSeatCost, SeatCostSetting


class CostingEntryModelTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="Org-Costing")
        self.client_master = Master.objects.create(name="Acme", type="client", org=self.org)
        self.designation = Master.objects.create(name="Analyst", type="designation", org=self.org)

    def test_total_is_auto_computed_on_save(self):
        entry = CostingEntry.objects.create(
            org=self.org,
            client=self.client_master,
            designation=self.designation,
            hr_day=Decimal("8"),
            days_working=Decimal("22"),
        )
        self.assertEqual(entry.total, Decimal("176"))

    def test_total_recomputed_on_update(self):
        entry = CostingEntry.objects.create(
            org=self.org,
            client=self.client_master,
            designation=self.designation,
            hr_day=Decimal("8"),
            days_working=Decimal("22"),
        )
        entry.hr_day = Decimal("6")
        entry.save()
        entry.refresh_from_db()
        self.assertEqual(entry.total, Decimal("132"))


class CostingEntryApiTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="Org-Costing-Api")
        self.other_org = Org.objects.create(name="Org-Costing-Other")
        self.client_master = Master.objects.create(name="Acme", type="client", org=self.org)
        self.designation = Master.objects.create(name="Analyst", type="designation", org=self.org)

        self.admin = User.objects.create_user(username="costing-admin", password="pw", full_name="Admin")
        OrgMembership.objects.create(user=self.admin, org=self.org, role="admin")

        self.no_access = User.objects.create_user(username="costing-noaccess", password="pw", full_name="NoAccess")
        OrgMembership.objects.create(user=self.no_access, org=self.org, role="employee")

        self.api = APIClient()

    def test_admin_can_create_and_total_is_computed(self):
        self.api.force_authenticate(user=self.admin)
        res = self.api.post(
            "/api/costing_entries/",
            {
                "org": str(self.org.uid),
                "client": str(self.client_master.uid),
                "designation": str(self.designation.uid),
                "hr_day": "8",
                "days_working": "22",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data["total"], "176.00")

    def test_user_without_costing_access_is_forbidden_on_write(self):
        self.api.force_authenticate(user=self.no_access)
        res = self.api.post(
            "/api/costing_entries/",
            {
                "org": str(self.org.uid),
                "client": str(self.client_master.uid),
                "designation": str(self.designation.uid),
                "hr_day": "8",
                "days_working": "22",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 403)

    def test_entries_scoped_to_caller_org(self):
        entry = CostingEntry.objects.create(
            org=self.org,
            client=self.client_master,
            designation=self.designation,
            hr_day=8,
            days_working=22,
        )
        outsider = User.objects.create_user(username="costing-outsider", password="pw", full_name="Outsider")
        OrgMembership.objects.create(user=outsider, org=self.other_org, role="admin")
        self.api.force_authenticate(user=outsider)
        res = self.api.get("/api/costing_entries/")
        self.assertEqual(res.status_code, 200)
        uids = [row["uid"] for row in res.data]
        self.assertNotIn(str(entry.uid), uids)

    def test_filter_by_client(self):
        self.api.force_authenticate(user=self.admin)
        other_client = Master.objects.create(name="Globex", type="client", org=self.org)
        CostingEntry.objects.create(
            org=self.org,
            client=self.client_master,
            designation=self.designation,
            hr_day=8,
            days_working=22,
        )
        CostingEntry.objects.create(
            org=self.org,
            client=other_client,
            designation=self.designation,
            hr_day=4,
            days_working=10,
        )
        res = self.api.get(f"/api/costing_entries/?client={self.client_master.uid}")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 1)

    def test_create_with_employee_and_org_name_is_returned(self):
        self.api.force_authenticate(user=self.admin)
        employee = Employee.objects.create(org=self.org, employee_name="Priya")
        res = self.api.post(
            "/api/costing_entries/",
            {
                "org": str(self.org.uid),
                "client": str(self.client_master.uid),
                "designation": str(self.designation.uid),
                "employee": str(employee.uid),
                "hr_day": "8",
                "days_working": "22",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data["employee_detail"]["employee_name"], "Priya")
        self.assertEqual(res.data["org_name"], self.org.name)

    def test_create_with_other_org_employee_rejected(self):
        self.api.force_authenticate(user=self.admin)
        other_employee = Employee.objects.create(org=self.other_org, employee_name="Rahul")
        res = self.api.post(
            "/api/costing_entries/",
            {
                "org": str(self.org.uid),
                "client": str(self.client_master.uid),
                "designation": str(self.designation.uid),
                "employee": str(other_employee.uid),
                "hr_day": "8",
                "days_working": "22",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 400, res.data)

    def test_update_employee_to_other_org_rejected(self):
        self.api.force_authenticate(user=self.admin)
        entry = CostingEntry.objects.create(
            org=self.org, client=self.client_master, designation=self.designation, hr_day=8, days_working=22
        )
        other_employee = Employee.objects.create(org=self.other_org, employee_name="Rahul")
        res = self.api.patch(
            f"/api/costing_entries/{entry.uid}/",
            {"employee": str(other_employee.uid)},
            format="json",
        )
        self.assertEqual(res.status_code, 400, res.data)


class SeatCostModelTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="Org-SeatCost")
        self.employee = Employee.objects.create(org=self.org, employee_name="Priya")

    def test_create_org_seat_cost_setting(self):
        setting = SeatCostSetting.objects.create(org=self.org, monthly_amount=Decimal("5000"))
        self.assertEqual(setting.monthly_amount, Decimal("5000"))

    def test_negative_org_seat_cost_rejected(self):
        setting = SeatCostSetting(org=self.org, monthly_amount=Decimal("-100"))
        with self.assertRaises(ValidationError):
            setting.full_clean()

    def test_one_setting_per_org(self):
        SeatCostSetting.objects.create(org=self.org, monthly_amount=Decimal("5000"))
        # org is a OneToOneField — a second row for the same org violates the
        # DB unique constraint. Wrap in atomic() so the broken transaction is
        # contained and the test can continue.
        with self.assertRaises(IntegrityError), transaction.atomic():
            SeatCostSetting.objects.create(org=self.org, monthly_amount=Decimal("6000"))

    def test_create_employee_seat_cost_override(self):
        override = EmployeeSeatCost.objects.create(employee=self.employee, monthly_amount=Decimal("7000"))
        self.assertEqual(override.monthly_amount, Decimal("7000"))

    def test_negative_employee_seat_cost_rejected(self):
        override = EmployeeSeatCost(employee=self.employee, monthly_amount=Decimal("-1"))
        with self.assertRaises(ValidationError):
            override.full_clean()


class SeatCostSettingApiTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="Org-SeatCost-Api")
        self.other_org = Org.objects.create(name="Org-SeatCost-Other")

        self.admin = User.objects.create_user(username="seatcost-admin", password="pw", full_name="Admin")
        OrgMembership.objects.create(user=self.admin, org=self.org, role="admin")

        self.plain = User.objects.create_user(username="seatcost-plain", password="pw", full_name="Plain")
        OrgMembership.objects.create(user=self.plain, org=self.org, role="employee")

        self.api = APIClient()

    def test_admin_can_create_seat_cost_setting(self):
        self.api.force_authenticate(user=self.admin)
        res = self.api.post(
            "/api/seat_cost_settings/",
            {"org": str(self.org.uid), "monthly_amount": "5000"},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data["monthly_amount"], "5000.00")
        self.assertEqual(res.data["org_name"], self.org.name)

    def test_non_admin_forbidden_on_read_and_write(self):
        self.api.force_authenticate(user=self.plain)
        res = self.api.get("/api/seat_cost_settings/")
        self.assertEqual(res.status_code, 403)
        res = self.api.post(
            "/api/seat_cost_settings/",
            {"org": str(self.org.uid), "monthly_amount": "5000"},
            format="json",
        )
        self.assertEqual(res.status_code, 403)

    def test_settings_scoped_to_admin_orgs(self):
        setting = SeatCostSetting.objects.create(org=self.org, monthly_amount=Decimal("5000"))
        outsider_admin = User.objects.create_user(
            username="seatcost-outsider",
            password="pw",
            full_name="Outsider",
        )
        OrgMembership.objects.create(user=outsider_admin, org=self.other_org, role="admin")
        self.api.force_authenticate(user=outsider_admin)
        res = self.api.get("/api/seat_cost_settings/")
        self.assertEqual(res.status_code, 200)
        uids = [row["uid"] for row in res.data]
        self.assertNotIn(str(setting.uid), uids)


class EmployeeSeatCostApiTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="Org-EmpSeatCost")
        self.other_org = Org.objects.create(name="Org-EmpSeatCost-Other")
        self.employee = Employee.objects.create(org=self.org, employee_name="Priya")
        self.other_employee = Employee.objects.create(org=self.other_org, employee_name="Rahul")

        self.admin = User.objects.create_user(username="empseatcost-admin", password="pw", full_name="Admin")
        OrgMembership.objects.create(user=self.admin, org=self.org, role="admin")

        self.plain = User.objects.create_user(username="empseatcost-plain", password="pw", full_name="Plain")
        OrgMembership.objects.create(user=self.plain, org=self.org, role="employee")

        self.api = APIClient()

    def test_admin_can_create_override_for_own_org_employee(self):
        self.api.force_authenticate(user=self.admin)
        res = self.api.post(
            "/api/employee_seat_costs/",
            {"employee": str(self.employee.uid), "monthly_amount": "7000"},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data["employee_detail"]["employee_name"], "Priya")

    def test_admin_cannot_create_override_for_other_org_employee(self):
        self.api.force_authenticate(user=self.admin)
        res = self.api.post(
            "/api/employee_seat_costs/",
            {"employee": str(self.other_employee.uid), "monthly_amount": "7000"},
            format="json",
        )
        self.assertEqual(res.status_code, 400, res.data)

    def test_non_admin_forbidden(self):
        self.api.force_authenticate(user=self.plain)
        res = self.api.post(
            "/api/employee_seat_costs/",
            {"employee": str(self.employee.uid), "monthly_amount": "7000"},
            format="json",
        )
        self.assertEqual(res.status_code, 403)

    def test_entries_scoped_to_admin_orgs(self):
        override = EmployeeSeatCost.objects.create(employee=self.employee, monthly_amount=Decimal("7000"))
        outsider_admin = User.objects.create_user(
            username="empseatcost-outsider",
            password="pw",
            full_name="Outsider",
        )
        OrgMembership.objects.create(user=outsider_admin, org=self.other_org, role="admin")
        self.api.force_authenticate(user=outsider_admin)
        res = self.api.get("/api/employee_seat_costs/")
        self.assertEqual(res.status_code, 200)
        uids = [row["uid"] for row in res.data]
        self.assertNotIn(str(override.uid), uids)
