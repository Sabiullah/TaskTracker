"""Role-aware visibility tests for Employee + EmployeeSalary endpoints.

Employee rows carry PII (Aadhaar/PAN/bank) and EmployeeSalary carries comp
data, so the queryset must narrow by per-org role:

  - admin    → every employee row in the org
  - manager  → own row + direct reports (User.subordinates)
  - employee → own row only

These tests pin that contract so a future refactor can't accidentally widen
visibility.
"""

from django.test import TestCase
from rest_framework.test import APIClient

from core.employees.models import Employee, EmployeeSalary
from users.models import Org, OrgMembership, User


def _auth(client: APIClient, user: User) -> None:
    client.force_authenticate(user=user)


class EmployeeVisibilityTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")

        self.admin_u = User.objects.create_user(email="a@x", password="pw", full_name="Admin A")
        self.mgr_u = User.objects.create_user(email="m@x", password="pw", full_name="Manager M")
        self.emp_u = User.objects.create_user(email="e@x", password="pw", full_name="Employee E")
        self.peer_u = User.objects.create_user(email="p@x", password="pw", full_name="Peer P")

        OrgMembership.objects.create(user=self.admin_u, org=self.org, role="admin")
        OrgMembership.objects.create(user=self.mgr_u, org=self.org, role="manager")
        OrgMembership.objects.create(user=self.emp_u, org=self.org, role="employee")
        OrgMembership.objects.create(user=self.peer_u, org=self.org, role="employee")

        # Manager M directly manages Employee E (but not Peer P).
        self.emp_u.managers.add(self.mgr_u)

        self.admin_emp = Employee.objects.create(org=self.org, user=self.admin_u, employee_name="Admin A")
        self.mgr_emp = Employee.objects.create(org=self.org, user=self.mgr_u, employee_name="Manager M")
        self.emp_emp = Employee.objects.create(org=self.org, user=self.emp_u, employee_name="Employee E")
        self.peer_emp = Employee.objects.create(org=self.org, user=self.peer_u, employee_name="Peer P")

    # ── Employee endpoint ──────────────────────────────────────────────────

    def test_admin_sees_every_employee_in_org(self):
        client = APIClient()
        _auth(client, self.admin_u)
        resp = client.get("/api/employees/")
        self.assertEqual(resp.status_code, 200)
        names = sorted(row["employee_name"] for row in resp.json())
        self.assertEqual(names, ["Admin A", "Employee E", "Manager M", "Peer P"])

    def test_manager_sees_self_and_direct_reports_only(self):
        client = APIClient()
        _auth(client, self.mgr_u)
        resp = client.get("/api/employees/")
        self.assertEqual(resp.status_code, 200)
        names = sorted(row["employee_name"] for row in resp.json())
        # Self (Manager M) + direct report (Employee E). Peer P is NOT a
        # report so must not appear; Admin A is a peer, also not visible.
        self.assertEqual(names, ["Employee E", "Manager M"])

    def test_employee_sees_only_self(self):
        client = APIClient()
        _auth(client, self.emp_u)
        resp = client.get("/api/employees/")
        self.assertEqual(resp.status_code, 200)
        names = [row["employee_name"] for row in resp.json()]
        self.assertEqual(names, ["Employee E"])

    def test_peer_employee_cannot_see_other_employees(self):
        """Peer P has no managed reports — they must see only their own row."""
        client = APIClient()
        _auth(client, self.peer_u)
        resp = client.get("/api/employees/")
        self.assertEqual(resp.status_code, 200)
        names = [row["employee_name"] for row in resp.json()]
        self.assertEqual(names, ["Peer P"])

    # ── EmployeeSalary endpoint (mirrors the same scoping via FK join) ────

    def test_employee_salary_endpoint_scopes_through_employee_fk(self):
        EmployeeSalary.objects.create(employee=self.admin_emp, effective_from="2026-01-01")
        EmployeeSalary.objects.create(employee=self.mgr_emp, effective_from="2026-01-01")
        EmployeeSalary.objects.create(employee=self.emp_emp, effective_from="2026-01-01")
        EmployeeSalary.objects.create(employee=self.peer_emp, effective_from="2026-01-01")

        # Plain employee should see only their own salary record.
        client = APIClient()
        _auth(client, self.emp_u)
        resp = client.get("/api/employee_salary/")
        self.assertEqual(resp.status_code, 200)
        rows = resp.json()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["employee"], str(self.emp_emp.uid))

        # Manager should see self + direct report (2 rows).
        _auth(client, self.mgr_u)
        resp = client.get("/api/employee_salary/")
        self.assertEqual(resp.status_code, 200)
        emp_uids = sorted(row["employee"] for row in resp.json())
        self.assertEqual(
            emp_uids,
            sorted([str(self.mgr_emp.uid), str(self.emp_emp.uid)]),
        )

        # Admin sees all.
        _auth(client, self.admin_u)
        resp = client.get("/api/employee_salary/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()), 4)
