from django.test import TestCase
from rest_framework.test import APIClient

from core.masters.models import Master
from core.notices.models import Notice
from core.notices.serializers import NoticeSerializer
from users.models import Org, OrgMembership, User


def _make_org_user(username: str, role: str = "admin") -> tuple[Org, User]:
    org = Org.objects.create(name=f"Org-{username}")
    user = User.objects.create_user(username=username, password="pw", full_name=username.title())
    OrgMembership.objects.create(user=user, org=org, role=role)
    return org, user


def _make_client(org: Org, name: str = "Acme") -> Master:
    m = Master.objects.create(name=name, type="client", org=org)
    m.orgs.add(org)
    return m


class NoticeClientNameTests(TestCase):
    """A typed client name must persist even when it is not a registered client.

    Regression for the "client name not saved" bug: the form only had a FK to
    a registered client master, so any free-text name that didn't match an
    existing master was silently dropped.
    """

    def setUp(self):
        self.org, self.user = _make_org_user("admin")
        self.api = APIClient()
        self.api.force_authenticate(user=self.user)

    def test_create_stores_free_text_client_name_without_master(self):
        resp = self.api.post(
            "/api/notices/",
            {"client_name": "Carmel", "dispute_nature": "Notice under 148"},
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.data["client_name"], "Carmel")
        self.assertIsNone(resp.data["client"])

        notice = Notice.objects.get(uid=resp.data["uid"])
        self.assertEqual(notice.client_name, "Carmel")
        self.assertIsNone(notice.client)

    def test_serializer_falls_back_to_master_name_when_free_text_blank(self):
        master = _make_client(self.org, name="Moon Fresh")
        notice = Notice.objects.create(org=self.org, client=master, dispute_nature="x")
        data = NoticeSerializer(notice).data
        # Legacy rows have no free-text name but a registered client FK.
        self.assertEqual(data["client_name"], "")
        self.assertEqual(data["client_detail"]["name"], "Moon Fresh")
