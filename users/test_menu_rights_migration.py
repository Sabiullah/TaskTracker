from django.test import TestCase

from users.models import MenuRight, Org, OrgMembership, User

ALWAYS_ON_VIEW = [
    "board",
    "dashboard",
    "calendar",
    "worklog",
    "conveyance",
    "holidays",
    "employee",
    "pace",
    "kaizen",
    "settings",
]


def _seed_rights_for(membership):
    """Mirror of the migration's per-membership logic, callable in tests so we
    assert the SAME rule the migration applies."""
    from users.migrations._menu_backfill import seed_membership_rights

    seed_membership_rights(MenuRight, membership)


class BackfillRuleTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")

    def test_employee_with_masters_flag_gets_view_edit(self):
        u = User.objects.create_user(email="m@x", password="pw")
        m = OrgMembership.objects.create(user=u, org=self.org, role="employee", masters_access=True)
        m.menu_rights.all().delete()
        _seed_rights_for(m)
        r = MenuRight.objects.get(membership=m, menu_code="masters")
        self.assertTrue(r.can_view and r.can_edit)

    def test_always_on_menus_get_view_for_non_admin(self):
        u = User.objects.create_user(email="p@x", password="pw")
        m = OrgMembership.objects.create(user=u, org=self.org, role="employee")
        m.menu_rights.all().delete()
        _seed_rights_for(m)
        for code in ALWAYS_ON_VIEW:
            self.assertTrue(
                m.menu_rights.filter(menu_code=code, can_view=True).exists(),
                f"missing always-on view: {code}",
            )

    def test_admin_seeds_nothing(self):
        u = User.objects.create_user(email="a@x", password="pw")
        m = OrgMembership.objects.create(user=u, org=self.org, role="admin", masters_access=True)
        m.menu_rights.all().delete()
        _seed_rights_for(m)
        self.assertEqual(m.menu_rights.count(), 0)

    def test_growthplan_and_users_not_seeded_for_employee(self):
        u = User.objects.create_user(email="g@x", password="pw")
        m = OrgMembership.objects.create(user=u, org=self.org, role="employee")
        m.menu_rights.all().delete()
        _seed_rights_for(m)
        self.assertFalse(m.menu_rights.filter(menu_code="growthplan").exists())
        self.assertFalse(m.menu_rights.filter(menu_code="users").exists())
