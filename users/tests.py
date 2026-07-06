from django.test import TestCase

from users.models import ACCESS_FEATURES, Org, OrgMembership, User


class CostingAccessTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="Org-Costing-Access")
        self.admin = User.objects.create_user(username="cost-admin", password="pw", full_name="Admin")
        OrgMembership.objects.create(user=self.admin, org=self.org, role="admin")
        self.plain = User.objects.create_user(username="cost-plain", password="pw", full_name="Plain")
        OrgMembership.objects.create(user=self.plain, org=self.org, role="employee")
        self.granted = User.objects.create_user(username="cost-granted", password="pw", full_name="Granted")
        OrgMembership.objects.create(user=self.granted, org=self.org, role="employee", costing_access=True)

    def test_costing_access_in_features_tuple(self):
        self.assertIn("costing_access", ACCESS_FEATURES)

    def test_admin_has_costing_access(self):
        self.assertTrue(self.admin.has_costing_in(self.org))

    def test_plain_employee_lacks_costing_access(self):
        self.assertFalse(self.plain.has_costing_in(self.org))

    def test_granted_employee_has_costing_access(self):
        self.assertTrue(self.granted.has_costing_in(self.org))
        self.assertTrue(self.granted.has_costing_in_any())
