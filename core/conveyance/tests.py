from django.test import TestCase
from rest_framework.test import APIClient, APIRequestFactory

from core.conveyance.models import ConveyanceAttachment, ConveyanceEntry
from core.conveyance.serializers import ConveyanceAttachmentSerializer, ConveyanceEntrySerializer
from core.masters.models import Master
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


def _auth(client: APIClient, user: User) -> None:
    client.force_authenticate(user=user)


def _make_entry(org, employee, client_master, **overrides):
    defaults = dict(
        date="2026-04-18",
        reason="taxi",
        amount="100.00",
        claimable=True,
    )
    defaults.update(overrides)
    return ConveyanceEntry.objects.create(
        org=org, employee=employee, client=client_master, **defaults
    )


class ConveyanceAttachmentSerializerTests(TestCase):
    def test_serializes_uid_label_and_download_url(self):
        org, user = _make_org_user("emp")
        master = _make_client(org)
        entry = ConveyanceEntry.objects.create(
            org=org, employee=user, date="2026-04-18", client=master,
            reason="taxi", amount="100.00",
        )
        # No real file — just the metadata fields.
        att = ConveyanceAttachment.objects.create(entry=entry, label="Breakfast")

        factory = APIRequestFactory()
        request = factory.get("/")
        request.user = user

        data = ConveyanceAttachmentSerializer(att, context={"request": request}).data
        assert data["uid"] == str(att.uid)
        assert data["label"] == "Breakfast"
        # Without a real file, file_url should be None.
        assert data["file_url"] is None
        assert data["filename"] is None


class ConveyanceEntrySerializerTests(TestCase):
    def test_serializes_nested_attachments(self):
        org, user = _make_org_user("emp")
        master = _make_client(org)
        entry = ConveyanceEntry.objects.create(
            org=org, employee=user, date="2026-04-18", client=master,
            reason="taxi", amount="100.00",
        )
        ConveyanceAttachment.objects.create(entry=entry, label="Breakfast")
        ConveyanceAttachment.objects.create(entry=entry, label="Lunch")

        factory = APIRequestFactory()
        request = factory.get("/")
        request.user = user

        data = ConveyanceEntrySerializer(entry, context={"request": request}).data
        assert data["uid"] == str(entry.uid)
        assert data["reason"] == "taxi"
        assert str(data["amount"]) == "100.00"
        assert data["status"] == "pending"
        assert data["claimable"] is True
        assert data["client_detail"]["uid"] == str(master.uid)
        assert data["employee_detail"]["uid"] == str(user.uid)
        labels = [a["label"] for a in data["attachments"]]
        assert labels == ["Breakfast", "Lunch"]


class ConveyanceEntryListVisibilityTests(TestCase):
    def setUp(self):
        self.org_a, self.admin_a = _make_org_user("admin_a", role="admin")
        self.manager_a = User.objects.create_user(username="mgr_a", password="pw", full_name="Mgr A")
        OrgMembership.objects.create(user=self.manager_a, org=self.org_a, role="manager")
        self.emp_a = User.objects.create_user(username="emp_a", password="pw", full_name="Emp A")
        OrgMembership.objects.create(user=self.emp_a, org=self.org_a, role="employee")
        self.other_emp_a = User.objects.create_user(username="other_a", password="pw", full_name="Other A")
        OrgMembership.objects.create(user=self.other_emp_a, org=self.org_a, role="employee")

        self.org_b, self.admin_b = _make_org_user("admin_b", role="admin")

        self.client_a = _make_client(self.org_a, "Acme-A")
        self.client_b = _make_client(self.org_b, "Acme-B")

        self.entry_emp_a = _make_entry(self.org_a, self.emp_a, self.client_a, reason="emp-a taxi")
        self.entry_other_emp_a = _make_entry(self.org_a, self.other_emp_a, self.client_a, reason="other taxi")
        self.entry_org_b = _make_entry(self.org_b, self.admin_b, self.client_b, reason="other-org")

        self.api = APIClient()

    def test_employee_sees_only_own(self):
        _auth(self.api, self.emp_a)
        res = self.api.get("/api/conveyance_entries/")
        self.assertEqual(res.status_code, 200, res.data)
        reasons = {e["reason"] for e in res.data["results"]}
        self.assertEqual(reasons, {"emp-a taxi"})

    def test_manager_sees_all_in_own_org(self):
        _auth(self.api, self.manager_a)
        res = self.api.get("/api/conveyance_entries/")
        self.assertEqual(res.status_code, 200)
        reasons = {e["reason"] for e in res.data["results"]}
        self.assertEqual(reasons, {"emp-a taxi", "other taxi"})

    def test_admin_sees_all_in_own_org_not_other_org(self):
        _auth(self.api, self.admin_a)
        res = self.api.get("/api/conveyance_entries/")
        self.assertEqual(res.status_code, 200)
        reasons = {e["reason"] for e in res.data["results"]}
        self.assertEqual(reasons, {"emp-a taxi", "other taxi"})
