"""``employee_access`` grants admin-equivalent rights inside Employee Management.

A user who holds the per-org ``employee_access`` flag should behave like an
admin **inside the Employee Management module** in that org:

  - sees every employee row in the org (Personal Info + Salary), not just self
  - may create / update / delete employee + salary rows

…with one deliberate exclusion: ``employee_access`` does **not** grant
Leave/WFH approval rights (that stays admin/manager-only via ``can_approve``).

These tests pin that contract.
"""

from django.test import TestCase
from rest_framework.test import APIClient

from core.employees.models import Employee, EmployeeSalary
from core.leave.permissions import can_approve
from users.models import Org, OrgMembership, User


def _auth(client: APIClient, user: User) -> None:
    client.force_authenticate(user=user)


class EmployeeAccessFlagTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")

        self.admin_u = User.objects.create_user(email="a@x", password="pw", full_name="Admin A")
        # access_u is a plain *employee* by role, but holds employee_access.
        self.access_u = User.objects.create_user(email="acc@x", password="pw", full_name="Access U")
        self.emp_u = User.objects.create_user(email="e@x", password="pw", full_name="Employee E")
        self.peer_u = User.objects.create_user(email="p@x", password="pw", full_name="Peer P")

        OrgMembership.objects.create(user=self.admin_u, org=self.org, role="admin")
        OrgMembership.objects.create(
            user=self.access_u, org=self.org, role="employee", employee_access=True
        )
        OrgMembership.objects.create(user=self.emp_u, org=self.org, role="employee")
        OrgMembership.objects.create(user=self.peer_u, org=self.org, role="employee")

        self.admin_emp = Employee.objects.create(org=self.org, user=self.admin_u, employee_name="Admin A")
        self.access_emp = Employee.objects.create(org=self.org, user=self.access_u, employee_name="Access U")
        self.emp_emp = Employee.objects.create(org=self.org, user=self.emp_u, employee_name="Employee E")
        self.peer_emp = Employee.objects.create(org=self.org, user=self.peer_u, employee_name="Peer P")

    # ── Visibility: behaves like admin ──────────────────────────────────────

    def test_employee_access_user_sees_every_employee_in_org(self):
        client = APIClient()
        _auth(client, self.access_u)
        resp = client.get("/api/employees/")
        self.assertEqual(resp.status_code, 200)
        names = sorted(row["employee_name"] for row in resp.json())
        self.assertEqual(names, ["Access U", "Admin A", "Employee E", "Peer P"])

    def test_employee_access_user_sees_all_salary(self):
        EmployeeSalary.objects.create(employee=self.admin_emp, effective_from="2026-01-01")
        EmployeeSalary.objects.create(employee=self.access_emp, effective_from="2026-01-01")
        EmployeeSalary.objects.create(employee=self.emp_emp, effective_from="2026-01-01")
        EmployeeSalary.objects.create(employee=self.peer_emp, effective_from="2026-01-01")

        client = APIClient()
        _auth(client, self.access_u)
        resp = client.get("/api/employee_salary/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()), 4)

    def test_plain_employee_still_sees_only_self(self):
        """The flag is opt-in: an employee WITHOUT it keeps the narrow view."""
        client = APIClient()
        _auth(client, self.emp_u)
        resp = client.get("/api/employees/")
        self.assertEqual(resp.status_code, 200)
        names = [row["employee_name"] for row in resp.json()]
        self.assertEqual(names, ["Employee E"])

    # ── Write: behaves like admin ───────────────────────────────────────────

    def test_employee_access_user_can_create_employee(self):
        client = APIClient()
        _auth(client, self.access_u)
        resp = client.post(
            "/api/employees/",
            {"employee_name": "New Hire", "org": str(self.org.uid)},
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.json())

    def test_employee_access_user_can_update_any_employee(self):
        client = APIClient()
        _auth(client, self.access_u)
        resp = client.patch(
            f"/api/employees/{self.peer_emp.uid}/",
            {"phone": "9999999999"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.json())

    def test_plain_employee_cannot_create_employee(self):
        """Writes require admin OR employee_access — a plain employee is denied."""
        client = APIClient()
        _auth(client, self.emp_u)
        resp = client.post(
            "/api/employees/",
            {"employee_name": "Sneaky", "org": str(self.org.uid)},
            format="json",
        )
        self.assertEqual(resp.status_code, 403, resp.json())

    # ── Exclusion: NOT leave/WFH approval ───────────────────────────────────

    def test_employee_access_does_not_grant_leave_approval(self):
        """employee_access is module visibility/CRUD only — never approval."""
        self.assertFalse(can_approve(self.access_u, self.emp_u, self.org))
