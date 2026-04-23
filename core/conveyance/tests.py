import datetime
import io

from django.core.files.uploadedfile import SimpleUploadedFile
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


class ConveyanceEntryCreateTests(TestCase):
    def setUp(self):
        self.org, self.emp = _make_org_user("emp", role="employee")
        self.client_master = _make_client(self.org)
        self.api = APIClient()
        _auth(self.api, self.emp)

    def test_employee_can_create_own_pending_entry(self):
        payload = {
            "date": "2026-04-18",
            "client": str(self.client_master.uid),
            "reason": "client site visit - taxi",
            "amount": "1450.00",
            "claimable": True,
        }
        res = self.api.post("/api/conveyance_entries/", payload, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(ConveyanceEntry.objects.count(), 1)
        entry = ConveyanceEntry.objects.get()
        self.assertEqual(entry.status, "pending")
        self.assertEqual(entry.employee_id, self.emp.id)
        self.assertEqual(entry.created_by_id, self.emp.id)
        assert entry.org is not None
        self.assertEqual(entry.org.id, self.org.id)


class ConveyanceEntryAdminOnBehalfTests(TestCase):
    def setUp(self):
        self.org, self.admin = _make_org_user("admin", role="admin")
        self.emp = User.objects.create_user(username="emp", password="pw", full_name="Emp")
        OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")
        self.org_other, self.admin_other = _make_org_user("admin_other", role="admin")
        self.emp_other = User.objects.create_user(username="emp_other", password="pw", full_name="Emp O")
        OrgMembership.objects.create(user=self.emp_other, org=self.org_other, role="employee")
        self.client_master = _make_client(self.org)
        self.api = APIClient()

    def test_admin_can_create_on_behalf_of_same_org_employee(self):
        _auth(self.api, self.admin)
        payload = {
            "date": "2026-04-18",
            "employee_uid": str(self.emp.uid),
            "client": str(self.client_master.uid),
            "reason": "site visit",
            "amount": "500.00",
        }
        res = self.api.post("/api/conveyance_entries/", payload, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        entry = ConveyanceEntry.objects.get()
        self.assertEqual(entry.employee_id, self.emp.id)
        self.assertEqual(entry.created_by_id, self.admin.id)

    def test_non_admin_cannot_pass_employee_uid(self):
        _auth(self.api, self.emp)
        payload = {
            "date": "2026-04-18",
            "employee_uid": str(self.admin.uid),
            "client": str(self.client_master.uid),
            "reason": "bogus",
            "amount": "10.00",
        }
        res = self.api.post("/api/conveyance_entries/", payload, format="json")
        self.assertEqual(res.status_code, 403, res.data)

    def test_admin_cannot_target_user_in_other_org(self):
        _auth(self.api, self.admin)
        payload = {
            "date": "2026-04-18",
            "employee_uid": str(self.emp_other.uid),
            "client": str(self.client_master.uid),
            "reason": "should fail",
            "amount": "10.00",
        }
        res = self.api.post("/api/conveyance_entries/", payload, format="json")
        self.assertEqual(res.status_code, 400, res.data)


class ConveyanceMultiFileCreateTests(TestCase):
    def setUp(self):
        self.org, self.emp = _make_org_user("emp", role="employee")
        self.client_master = _make_client(self.org)
        self.api = APIClient()
        _auth(self.api, self.emp)

    def _file(self, name: str, content: bytes = b"x") -> SimpleUploadedFile:
        return SimpleUploadedFile(name, content, content_type="image/jpeg")

    def test_create_with_three_attachments_and_labels(self):
        payload = {
            "date": "2026-04-18",
            "client": str(self.client_master.uid),
            "reason": "client site visit meals",
            "amount": "1450.00",
            "attachments": [
                self._file("breakfast.jpg"),
                self._file("lunch.jpg"),
                self._file("dinner.jpg"),
            ],
            "attachment_labels": ["Breakfast", "Lunch", "Dinner"],
        }
        res = self.api.post("/api/conveyance_entries/", payload, format="multipart")
        self.assertEqual(res.status_code, 201, res.data)
        entry = ConveyanceEntry.objects.get()
        labels = list(entry.attachments.order_by("created_at").values_list("label", flat=True))
        self.assertEqual(labels, ["Breakfast", "Lunch", "Dinner"])

    def test_create_with_fewer_labels_than_files(self):
        payload = {
            "date": "2026-04-18",
            "client": str(self.client_master.uid),
            "reason": "partial labels",
            "amount": "500.00",
            "attachments": [self._file("a.jpg"), self._file("b.jpg"), self._file("c.jpg")],
            "attachment_labels": ["Only one"],
        }
        res = self.api.post("/api/conveyance_entries/", payload, format="multipart")
        self.assertEqual(res.status_code, 201)
        entry = ConveyanceEntry.objects.get()
        labels = list(entry.attachments.order_by("created_at").values_list("label", flat=True))
        self.assertEqual(labels, ["Only one", "", ""])

    def test_create_with_no_attachments(self):
        payload = {
            "date": "2026-04-18",
            "client": str(self.client_master.uid),
            "reason": "no attachments",
            "amount": "10.00",
        }
        res = self.api.post("/api/conveyance_entries/", payload, format="multipart")
        self.assertEqual(res.status_code, 201)
        entry = ConveyanceEntry.objects.get()
        self.assertEqual(entry.attachments.count(), 0)

    def test_oversize_file_rolls_back_entry_and_all_attachments(self):
        big = io.BytesIO(b"0" * (21 * 1024 * 1024))  # 21 MB — over the 20 MB cap
        over = SimpleUploadedFile("big.jpg", big.getvalue(), content_type="image/jpeg")
        payload = {
            "date": "2026-04-18",
            "client": str(self.client_master.uid),
            "reason": "should rollback",
            "amount": "10.00",
            "attachments": [self._file("ok.jpg"), over],
        }
        res = self.api.post("/api/conveyance_entries/", payload, format="multipart")
        self.assertEqual(res.status_code, 400, res.data)
        self.assertEqual(ConveyanceEntry.objects.count(), 0)
        self.assertEqual(ConveyanceAttachment.objects.count(), 0)


class ConveyanceValidationTests(TestCase):
    def setUp(self):
        self.org, self.emp = _make_org_user("emp", role="employee")
        self.client_master = _make_client(self.org)
        self.api = APIClient()
        _auth(self.api, self.emp)

    def _base_payload(self):
        return {
            "date": "2026-04-18",
            "client": str(self.client_master.uid),
            "reason": "client visit",
            "amount": "100.00",
        }

    def test_future_date_rejected(self):
        p = self._base_payload()
        p["date"] = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
        res = self.api.post("/api/conveyance_entries/", p, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("date", res.data)

    def test_zero_amount_rejected(self):
        p = self._base_payload()
        p["amount"] = "0"
        res = self.api.post("/api/conveyance_entries/", p, format="json")
        self.assertEqual(res.status_code, 400)

    def test_negative_amount_rejected(self):
        p = self._base_payload()
        p["amount"] = "-1.00"
        res = self.api.post("/api/conveyance_entries/", p, format="json")
        self.assertEqual(res.status_code, 400)

    def test_reason_too_short_rejected(self):
        p = self._base_payload()
        p["reason"] = "ab"
        res = self.api.post("/api/conveyance_entries/", p, format="json")
        self.assertEqual(res.status_code, 400)

    def test_client_of_wrong_type_rejected(self):
        non_client = Master.objects.create(name="cat", type="category", org=self.org)
        non_client.orgs.add(self.org)
        p = self._base_payload()
        p["client"] = str(non_client.uid)
        res = self.api.post("/api/conveyance_entries/", p, format="json")
        self.assertEqual(res.status_code, 400)

    def test_client_from_other_org_rejected(self):
        other_org, _ = _make_org_user("admin_b", role="admin")
        other_client = _make_client(other_org, "B-Client")
        p = self._base_payload()
        p["client"] = str(other_client.uid)
        res = self.api.post("/api/conveyance_entries/", p, format="json")
        self.assertEqual(res.status_code, 400)


class ConveyanceEditDeleteGuardTests(TestCase):
    def setUp(self):
        self.org, self.admin = _make_org_user("admin", role="admin")
        self.emp = User.objects.create_user(username="emp", password="pw", full_name="Emp")
        OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")
        self.client_master = _make_client(self.org)
        self.entry = _make_entry(self.org, self.emp, self.client_master)
        self.api = APIClient()

    def test_owner_can_edit_pending(self):
        _auth(self.api, self.emp)
        res = self.api.patch(
            f"/api/conveyance_entries/{self.entry.uid}/",
            {"reason": "updated reason"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.entry.refresh_from_db()
        self.assertEqual(self.entry.reason, "updated reason")

    def test_owner_cannot_edit_approved(self):
        self.entry.status = "approved"
        self.entry.save()
        _auth(self.api, self.emp)
        res = self.api.patch(
            f"/api/conveyance_entries/{self.entry.uid}/",
            {"reason": "nope"},
            format="json",
        )
        self.assertEqual(res.status_code, 403, res.data)

    def test_admin_can_edit_approved(self):
        self.entry.status = "approved"
        self.entry.save()
        _auth(self.api, self.admin)
        res = self.api.patch(
            f"/api/conveyance_entries/{self.entry.uid}/",
            {"reason": "admin fix"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)

    def test_owner_can_delete_pending(self):
        _auth(self.api, self.emp)
        res = self.api.delete(f"/api/conveyance_entries/{self.entry.uid}/")
        self.assertEqual(res.status_code, 204)

    def test_owner_cannot_delete_approved(self):
        self.entry.status = "approved"
        self.entry.save()
        _auth(self.api, self.emp)
        res = self.api.delete(f"/api/conveyance_entries/{self.entry.uid}/")
        self.assertEqual(res.status_code, 403)

    def test_admin_can_delete_approved(self):
        self.entry.status = "approved"
        self.entry.save()
        _auth(self.api, self.admin)
        res = self.api.delete(f"/api/conveyance_entries/{self.entry.uid}/")
        self.assertEqual(res.status_code, 204)


class ConveyanceApproveTests(TestCase):
    def setUp(self):
        self.org, self.admin = _make_org_user("admin", role="admin")
        self.manager = User.objects.create_user(username="mgr", password="pw", full_name="Mgr")
        OrgMembership.objects.create(user=self.manager, org=self.org, role="manager")
        self.emp = User.objects.create_user(username="emp", password="pw", full_name="Emp")
        OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")
        self.client_master = _make_client(self.org)
        self.entry = _make_entry(self.org, self.emp, self.client_master)
        self.api = APIClient()

    def test_manager_can_approve(self):
        _auth(self.api, self.manager)
        res = self.api.post(f"/api/conveyance_entries/{self.entry.uid}/approve/", {}, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        self.entry.refresh_from_db()
        self.assertEqual(self.entry.status, "approved")
        self.assertEqual(self.entry.reviewed_by_id, self.manager.id)
        self.assertIsNotNone(self.entry.reviewed_at)

    def test_employee_cannot_approve(self):
        _auth(self.api, self.emp)
        res = self.api.post(f"/api/conveyance_entries/{self.entry.uid}/approve/", {}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_cannot_review_own_entry(self):
        own = _make_entry(self.org, self.admin, self.client_master, reason="admin expense")
        _auth(self.api, self.admin)
        res = self.api.post(f"/api/conveyance_entries/{own.uid}/approve/", {}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_second_approve_is_conflict(self):
        _auth(self.api, self.admin)
        self.api.post(f"/api/conveyance_entries/{self.entry.uid}/approve/", {}, format="json")
        res = self.api.post(f"/api/conveyance_entries/{self.entry.uid}/approve/", {}, format="json")
        self.assertEqual(res.status_code, 409)

    def test_approve_writes_audit_log(self):
        from core.audit.models import AuditLog

        _auth(self.api, self.admin)
        res = self.api.post(f"/api/conveyance_entries/{self.entry.uid}/approve/", {}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(
            AuditLog.objects.filter(
                action="conveyance.approve", resource_id=str(self.entry.uid)
            ).exists()
        )


class ConveyanceRejectTests(TestCase):
    def setUp(self):
        self.org, self.admin = _make_org_user("admin", role="admin")
        self.emp = User.objects.create_user(username="emp", password="pw", full_name="Emp")
        OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")
        self.client_master = _make_client(self.org)
        self.entry = _make_entry(self.org, self.emp, self.client_master)
        self.api = APIClient()
        _auth(self.api, self.admin)

    def test_reject_requires_review_note(self):
        res = self.api.post(
            f"/api/conveyance_entries/{self.entry.uid}/reject/",
            {},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("review_note", str(res.data))

    def test_reject_short_review_note_rejected(self):
        res = self.api.post(
            f"/api/conveyance_entries/{self.entry.uid}/reject/",
            {"review_note": "no"},
            format="json",
        )
        self.assertEqual(res.status_code, 400)

    def test_admin_can_reject_with_note(self):
        res = self.api.post(
            f"/api/conveyance_entries/{self.entry.uid}/reject/",
            {"review_note": "missing receipts"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.entry.refresh_from_db()
        self.assertEqual(self.entry.status, "rejected")
        self.assertEqual(self.entry.review_note, "missing receipts")
        self.assertEqual(self.entry.reviewed_by_id, self.admin.id)
