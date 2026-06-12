from django.test import RequestFactory, TestCase

from core.permissions import HasMenuRight
from users.models import MenuRight, Org, OrgMembership, User


class _View:
    menu_code = "invoice"

    def __init__(self, org):
        self._org = org

    def get_menu_org(self, request):
        return self._org


class HasMenuRightTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")
        self.viewer = User.objects.create_user(email="v@x", password="pw")
        self.editor = User.objects.create_user(email="ed@x", password="pw")
        self.admin = User.objects.create_user(email="a@x", password="pw")
        mv = OrgMembership.objects.create(user=self.viewer, org=self.org, role="employee")
        me = OrgMembership.objects.create(user=self.editor, org=self.org, role="employee")
        OrgMembership.objects.create(user=self.admin, org=self.org, role="admin")
        # Clear baseline seed, then set the exact rights under test.
        mv.menu_rights.all().delete()
        me.menu_rights.all().delete()
        MenuRight.objects.create(membership=mv, menu_code="invoice", can_view=True)
        MenuRight.objects.create(membership=me, menu_code="invoice", can_view=True, can_edit=True)
        self.rf = RequestFactory()

    def _check(self, user, method):
        req = getattr(self.rf, method.lower())("/")
        req.user = user
        return HasMenuRight().has_permission(req, _View(self.org))

    def test_view_can_read_not_write(self):
        self.assertTrue(self._check(self.viewer, "GET"))
        self.assertFalse(self._check(self.viewer, "POST"))

    def test_editor_can_write(self):
        self.assertTrue(self._check(self.editor, "POST"))

    def test_admin_overrides(self):
        self.assertTrue(self._check(self.admin, "DELETE"))

    def test_anonymous_denied(self):
        from django.contrib.auth.models import AnonymousUser

        req = self.rf.get("/")
        req.user = AnonymousUser()
        self.assertFalse(HasMenuRight().has_permission(req, _View(self.org)))
