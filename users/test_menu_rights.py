from django.test import TestCase

from users.models import MenuRight, Org, OrgMembership, User


class MenuRightModelTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")
        self.user = User.objects.create_user(email="e@x", password="pw")
        self.m = OrgMembership.objects.create(user=self.user, org=self.org, role="employee")

    def test_edit_forces_view_on_save(self):
        r = MenuRight.objects.create(membership=self.m, menu_code="invoice", can_view=False, can_edit=True)
        r.refresh_from_db()
        self.assertTrue(r.can_view)

    def test_unique_per_membership_and_code(self):
        MenuRight.objects.create(membership=self.m, menu_code="invoice", can_view=True)
        with self.assertRaises(Exception):
            MenuRight.objects.create(membership=self.m, menu_code="invoice", can_view=True)


class MenuRightHelperTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")
        self.emp = User.objects.create_user(email="emp@x", password="pw")
        self.adm = User.objects.create_user(email="adm@x", password="pw")
        self.m = OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")
        OrgMembership.objects.create(user=self.adm, org=self.org, role="admin")
        MenuRight.objects.create(membership=self.m, menu_code="invoice", can_view=True, can_edit=False)
        MenuRight.objects.create(membership=self.m, menu_code="masters", can_view=True, can_edit=True)

    def test_view_and_edit_resolution(self):
        self.assertTrue(self.emp.menu_view_in(self.org, "invoice"))
        self.assertFalse(self.emp.menu_edit_in(self.org, "invoice"))
        self.assertTrue(self.emp.menu_edit_in(self.org, "masters"))
        self.assertFalse(self.emp.menu_view_in(self.org, "leads"))

    def test_admin_overrides_everything(self):
        self.assertTrue(self.adm.menu_view_in(self.org, "leads"))
        self.assertTrue(self.adm.menu_edit_in(self.org, "leads"))

    def test_rights_map_shape(self):
        m = self.emp.menu_rights_map(self.org)
        self.assertEqual(m["invoice"], {"view": True, "edit": False})
        self.assertEqual(m["masters"], {"view": True, "edit": True})
        self.assertNotIn("leads", m)


class LegacyHelperCompatTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")
        self.emp = User.objects.create_user(email="c@x", password="pw")
        self.m = OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")
        # MenuRight is the new source of truth — the legacy boolean is NOT set.
        MenuRight.objects.create(membership=self.m, menu_code="masters", can_view=True, can_edit=True)

    def test_legacy_helper_reads_from_menu_right(self):
        self.assertTrue(self.emp.has_masters_in(self.org))
        self.assertTrue(self.emp.has_masters_in_any())
        self.assertFalse(self.emp.has_invoice_in(self.org))


class MembershipBaselineSeedTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")

    def test_new_employee_gets_always_on_view(self):
        u = User.objects.create_user(email="n@x", password="pw")
        m = OrgMembership.objects.create(user=u, org=self.org, role="employee")
        self.assertTrue(m.menu_rights.filter(menu_code="board", can_view=True).exists())
        self.assertTrue(m.menu_rights.filter(menu_code="dashboard", can_view=True).exists())
        # growthplan/users stay admin-only — never seeded.
        self.assertFalse(m.menu_rights.filter(menu_code="growthplan").exists())
        self.assertFalse(m.menu_rights.filter(menu_code="users").exists())

    def test_create_time_flag_maps_to_view_edit(self):
        u = User.objects.create_user(email="f@x", password="pw")
        m = OrgMembership.objects.create(user=u, org=self.org, role="employee", masters_access=True)
        r = m.menu_rights.get(menu_code="masters")
        self.assertTrue(r.can_view and r.can_edit)

    def test_admin_membership_seeds_nothing(self):
        u = User.objects.create_user(email="ad@x", password="pw")
        m = OrgMembership.objects.create(user=u, org=self.org, role="admin")
        self.assertEqual(m.menu_rights.count(), 0)
