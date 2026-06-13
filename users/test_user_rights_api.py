from django.test import TestCase
from rest_framework.test import APIClient

from users.models import MenuRight, Org, OrgMembership, User


class MePayloadTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")
        self.u = User.objects.create_user(email="e@x", password="pw")
        self.m = OrgMembership.objects.create(user=self.u, org=self.org, role="employee")
        MenuRight.objects.create(membership=self.m, menu_code="invoice", can_view=True, can_edit=True)

    def test_me_includes_menu_rights(self):
        c = APIClient()
        c.force_authenticate(user=self.u)
        resp = c.get("/api/auth/me/")
        self.assertEqual(resp.status_code, 200)
        org0 = resp.json()["orgs"][0]
        self.assertEqual(org0["menu_rights"]["invoice"], {"view": True, "edit": True})


class MenuCatalogEndpointTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")
        self.u = User.objects.create_user(email="e@x", password="pw")
        OrgMembership.objects.create(user=self.u, org=self.org, role="employee")

    def test_requires_auth(self):
        self.assertEqual(APIClient().get("/api/menu-catalog/").status_code, 401)

    def test_returns_ordered_tree(self):
        c = APIClient()
        c.force_authenticate(user=self.u)
        resp = c.get("/api/menu-catalog/")
        self.assertEqual(resp.status_code, 200)
        rows = resp.json()
        self.assertEqual(rows[0], {"code": "board", "label": "Board", "parent": None})
        codes = [r["code"] for r in rows]
        self.assertIn("employee.salary", codes)
        self.assertLess(codes.index("employee"), codes.index("employee.salary"))


class UserRightsGetTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")
        self.admin = User.objects.create_user(email="a@x", password="pw")
        self.emp = User.objects.create_user(email="e@x", password="pw")
        OrgMembership.objects.create(user=self.admin, org=self.org, role="admin")
        m = OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")
        MenuRight.objects.create(membership=m, menu_code="invoice", can_view=True)

    def test_non_admin_forbidden(self):
        c = APIClient()
        c.force_authenticate(user=self.emp)
        self.assertEqual(c.get(f"/api/user-rights/?org={self.org.id}").status_code, 403)

    def test_admin_gets_member_rights(self):
        c = APIClient()
        c.force_authenticate(user=self.admin)
        resp = c.get(f"/api/user-rights/?org={self.org.id}")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        users = {u["user_uid"]: u for u in body["users"]}
        self.assertTrue(users[str(self.admin.uid)]["is_admin"])
        self.assertEqual(users[str(self.emp.uid)]["rights"]["invoice"], {"view": True, "edit": False})


class UserRightsPatchTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")
        self.admin = User.objects.create_user(email="a@x", password="pw")
        self.emp = User.objects.create_user(email="e@x", password="pw")
        OrgMembership.objects.create(user=self.admin, org=self.org, role="admin")
        OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")

    def _patch(self, body):
        c = APIClient()
        c.force_authenticate(user=self.admin)
        return c.patch(f"/api/user-rights/?org={self.org.id}", body, format="json")

    def test_grants_and_normalises_edit_implies_view(self):
        resp = self._patch({str(self.emp.uid): {"invoice": {"view": False, "edit": True}}})
        self.assertEqual(resp.status_code, 200)
        m = OrgMembership.objects.get(user=self.emp, org=self.org)
        r = m.menu_rights.get(menu_code="invoice")
        self.assertTrue(r.can_view and r.can_edit)
        self.assertIsNotNone(r.granted_by_id)

    def test_clearing_both_deletes_the_row(self):
        m = OrgMembership.objects.get(user=self.emp, org=self.org)
        MenuRight.objects.create(membership=m, menu_code="invoice", can_view=True)
        self._patch({str(self.emp.uid): {"invoice": {"view": False, "edit": False}}})
        self.assertFalse(m.menu_rights.filter(menu_code="invoice").exists())

    def test_rejects_unknown_code(self):
        self.assertEqual(self._patch({str(self.emp.uid): {"nope": {"view": True}}}).status_code, 400)

    def test_rejects_editing_admin_member(self):
        self.assertEqual(self._patch({str(self.admin.uid): {"invoice": {"view": True}}}).status_code, 400)
