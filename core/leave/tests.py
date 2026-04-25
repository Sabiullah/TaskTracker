import datetime as dt
from decimal import Decimal

from django.test import TestCase

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

    def test_can_approve_blocks_self(self):
        self.assertFalse(can_approve(self.admin, self.admin, self.org))

    def test_can_approve_allows_admin_for_manager_request(self):
        self.assertTrue(can_approve(self.admin, self.mgr, self.org))

    def test_can_approve_blocks_unrelated_user(self):
        outsider = User.objects.create_user(email="o@x.com", password="x")
        self.assertFalse(can_approve(outsider, self.emp, self.org))
