from django.test import TestCase

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

    def test_employee_manager_must_be_member_of_request_org(self):
        """A manager who exists but isn't a member of `org` must NOT appear
        in the pool — falls back to the org's admins instead."""
        other_org = Org.objects.create(name="YBV")
        outside_mgr = User.objects.create_user(email="om@x.com", password="x")
        OrgMembership.objects.create(user=outside_mgr, org=other_org, role="manager")
        # Employee's manager is the outside_mgr (no membership in `self.org`).
        self.emp.managers.clear()
        self.emp.managers.add(outside_mgr)
        pool = approver_pool(self.emp, self.org)
        self.assertNotIn(outside_mgr.pk, pool)
        # Falls back to org admins.
        self.assertSetEqual(set(pool), {self.admin.pk, self.admin2.pk})

    def test_can_approve_blocks_self(self):
        self.assertFalse(can_approve(self.admin, self.admin, self.org))

    def test_can_approve_allows_admin_for_manager_request(self):
        self.assertTrue(can_approve(self.admin, self.mgr, self.org))

    def test_can_approve_blocks_unrelated_user(self):
        outsider = User.objects.create_user(email="o@x.com", password="x")
        self.assertFalse(can_approve(outsider, self.emp, self.org))
