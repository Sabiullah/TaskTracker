import datetime
import io
import os
from decimal import Decimal

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
    return ConveyanceEntry.objects.create(org=org, employee=employee, client=client_master, **defaults)


class ConveyanceAttachmentSerializerTests(TestCase):
    def test_serializes_uid_label_and_download_url(self):
        org, user = _make_org_user("emp")
        master = _make_client(org)
        entry = ConveyanceEntry.objects.create(
            org=org,
            employee=user,
            date="2026-04-18",
            client=master,
            reason="taxi",
            amount="100.00",
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
            org=org,
            employee=user,
            date="2026-04-18",
            client=master,
            reason="taxi",
            amount="100.00",
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

    def test_manager_does_not_see_admin_owned_entries(self):
        _make_entry(self.org_a, self.admin_a, self.client_a, reason="admin-a taxi")
        _auth(self.api, self.manager_a)
        res = self.api.get("/api/conveyance_entries/")
        self.assertEqual(res.status_code, 200)
        reasons = {e["reason"] for e in res.data["results"]}
        self.assertEqual(reasons, {"emp-a taxi", "other taxi"})

    def test_admin_sees_admin_owned_entries(self):
        _make_entry(self.org_a, self.admin_a, self.client_a, reason="admin-a taxi")
        _auth(self.api, self.admin_a)
        res = self.api.get("/api/conveyance_entries/")
        self.assertEqual(res.status_code, 200)
        reasons = {e["reason"] for e in res.data["results"]}
        self.assertEqual(reasons, {"emp-a taxi", "other taxi", "admin-a taxi"})


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

    def test_admin_can_approve_own_entry(self):
        own = _make_entry(self.org, self.admin, self.client_master, reason="admin expense")
        _auth(self.api, self.admin)
        res = self.api.post(f"/api/conveyance_entries/{own.uid}/approve/", {}, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        own.refresh_from_db()
        self.assertEqual(own.status, "approved")
        self.assertEqual(own.reviewed_by_id, self.admin.id)

    def test_manager_cannot_approve_own_entry(self):
        own = _make_entry(self.org, self.manager, self.client_master, reason="manager expense")
        _auth(self.api, self.manager)
        res = self.api.post(f"/api/conveyance_entries/{own.uid}/approve/", {}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_admin_can_reject_own_entry_with_note(self):
        own = _make_entry(self.org, self.admin, self.client_master, reason="admin expense")
        _auth(self.api, self.admin)
        res = self.api.post(
            f"/api/conveyance_entries/{own.uid}/reject/",
            {"review_note": "duplicate entry"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        own.refresh_from_db()
        self.assertEqual(own.status, "rejected")
        self.assertEqual(own.review_note, "duplicate entry")

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
        self.assertTrue(AuditLog.objects.filter(action="conveyance.approve", resource_id=str(self.entry.uid)).exists())


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


class ConveyanceAttachmentDownloadTests(TestCase):
    def setUp(self):
        self.org, self.emp = _make_org_user("emp", role="employee")
        self.client_master = _make_client(self.org)
        self.entry = _make_entry(self.org, self.emp, self.client_master)
        self.attachment = ConveyanceAttachment.objects.create(
            entry=self.entry,
            file=SimpleUploadedFile("bill.jpg", b"hello", content_type="image/jpeg"),
            label="Breakfast",
            uploaded_by=self.emp,
        )
        self.api = APIClient()

    def test_owner_can_download(self):
        _auth(self.api, self.emp)
        res = self.api.get(f"/api/conveyance_attachments/{self.attachment.uid}/download/")
        self.assertEqual(res.status_code, 200)

    def test_anonymous_cannot_download(self):
        res = self.api.get(f"/api/conveyance_attachments/{self.attachment.uid}/download/")
        self.assertIn(res.status_code, (401, 403))

    def test_cross_org_user_gets_404(self):
        other_org, other_user = _make_org_user("other_admin", role="admin")
        _auth(self.api, other_user)
        res = self.api.get(f"/api/conveyance_attachments/{self.attachment.uid}/download/")
        self.assertEqual(res.status_code, 404)


class ConveyanceAttachmentCreateTests(TestCase):
    def setUp(self):
        self.org, self.admin = _make_org_user("admin", role="admin")
        self.emp = User.objects.create_user(username="emp", password="pw", full_name="Emp")
        OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")
        self.client_master = _make_client(self.org)
        self.entry = _make_entry(self.org, self.emp, self.client_master)
        self.api = APIClient()

    def _file(self, name="extra.jpg"):
        return SimpleUploadedFile(name, b"x", content_type="image/jpeg")

    def test_owner_adds_attachment_to_pending(self):
        _auth(self.api, self.emp)
        res = self.api.post(
            "/api/conveyance_attachments/",
            {"entry_uid": str(self.entry.uid), "file": self._file(), "label": "Coffee"},
            format="multipart",
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(self.entry.attachments.count(), 1)

    def test_owner_cannot_add_to_approved(self):
        self.entry.status = "approved"
        self.entry.save()
        _auth(self.api, self.emp)
        res = self.api.post(
            "/api/conveyance_attachments/",
            {"entry_uid": str(self.entry.uid), "file": self._file()},
            format="multipart",
        )
        self.assertEqual(res.status_code, 403)

    def test_admin_can_add_to_approved(self):
        self.entry.status = "approved"
        self.entry.save()
        _auth(self.api, self.admin)
        res = self.api.post(
            "/api/conveyance_attachments/",
            {"entry_uid": str(self.entry.uid), "file": self._file()},
            format="multipart",
        )
        self.assertEqual(res.status_code, 201)

    def test_adding_to_invisible_entry_returns_404(self):
        other_org, other_user = _make_org_user("other_admin", role="admin")
        _auth(self.api, other_user)
        res = self.api.post(
            "/api/conveyance_attachments/",
            {"entry_uid": str(self.entry.uid), "file": self._file()},
            format="multipart",
        )
        self.assertEqual(res.status_code, 404)


class ConveyanceAttachmentDestroyTests(TestCase):
    def setUp(self):
        self.org, self.admin = _make_org_user("admin", role="admin")
        self.emp = User.objects.create_user(username="emp", password="pw", full_name="Emp")
        OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")
        self.client_master = _make_client(self.org)
        self.entry = _make_entry(self.org, self.emp, self.client_master)
        self.attachment = ConveyanceAttachment.objects.create(
            entry=self.entry,
            file=SimpleUploadedFile("bill.jpg", b"x", content_type="image/jpeg"),
            uploaded_by=self.emp,
        )
        self.api = APIClient()

    def test_owner_deletes_pending_attachment(self):
        path = self.attachment.file.path
        self.assertTrue(os.path.exists(path))
        _auth(self.api, self.emp)
        res = self.api.delete(f"/api/conveyance_attachments/{self.attachment.uid}/")
        self.assertEqual(res.status_code, 204)
        self.assertFalse(os.path.exists(path))
        self.assertEqual(self.entry.attachments.count(), 0)

    def test_owner_cannot_delete_on_approved_entry(self):
        self.entry.status = "approved"
        self.entry.save()
        _auth(self.api, self.emp)
        res = self.api.delete(f"/api/conveyance_attachments/{self.attachment.uid}/")
        self.assertEqual(res.status_code, 403)

    def test_admin_can_delete_on_approved_entry(self):
        self.entry.status = "approved"
        self.entry.save()
        _auth(self.api, self.admin)
        res = self.api.delete(f"/api/conveyance_attachments/{self.attachment.uid}/")
        self.assertEqual(res.status_code, 204)


class ConveyanceEntryDeleteCascadeTests(TestCase):
    def setUp(self):
        self.org, self.emp = _make_org_user("emp", role="employee")
        self.client_master = _make_client(self.org)
        self.entry = _make_entry(self.org, self.emp, self.client_master)
        self.att1 = ConveyanceAttachment.objects.create(
            entry=self.entry,
            file=SimpleUploadedFile("a.jpg", b"a", content_type="image/jpeg"),
        )
        self.att2 = ConveyanceAttachment.objects.create(
            entry=self.entry,
            file=SimpleUploadedFile("b.jpg", b"b", content_type="image/jpeg"),
        )
        self.api = APIClient()
        _auth(self.api, self.emp)

    def test_entry_delete_removes_attachment_files(self):
        paths = [self.att1.file.path, self.att2.file.path]
        for p in paths:
            self.assertTrue(os.path.exists(p))
        res = self.api.delete(f"/api/conveyance_entries/{self.entry.uid}/")
        self.assertEqual(res.status_code, 204)
        self.assertEqual(ConveyanceAttachment.objects.count(), 0)
        for p in paths:
            self.assertFalse(os.path.exists(p), f"file still exists: {p}")


class ConveyanceSummarySingleModeTests(TestCase):
    def setUp(self):
        self.org, self.admin = _make_org_user("admin", role="admin")
        self.emp_a = User.objects.create_user(username="emp_a", password="pw", full_name="A")
        OrgMembership.objects.create(user=self.emp_a, org=self.org, role="employee")
        self.emp_b = User.objects.create_user(username="emp_b", password="pw", full_name="B")
        OrgMembership.objects.create(user=self.emp_b, org=self.org, role="employee")
        self.client_master = _make_client(self.org)
        self.api = APIClient()
        _auth(self.api, self.admin)

    def _approved(self, emp, date, amount, claimable=True, reason="x"):
        e = _make_entry(
            self.org,
            emp,
            self.client_master,
            date=date,
            amount=amount,
            claimable=claimable,
            reason=reason,
        )
        e.status = "approved"
        e.reviewed_by = self.admin
        e.reviewed_at = "2026-04-20T00:00:00Z"
        e.save()
        return e

    def test_requires_group_by(self):
        res = self.api.get("/api/conveyance_entries/summary/")
        self.assertEqual(res.status_code, 400)

    def test_group_by_employee_single_month_sums(self):
        self._approved(self.emp_a, "2026-04-01", "100.00")
        self._approved(self.emp_a, "2026-04-10", "200.00")
        self._approved(self.emp_b, "2026-04-15", "50.00")
        self._approved(self.emp_a, "2026-03-30", "999.00")  # excluded (wrong month)
        # Non-claimable still counts for employee totals: the company
        # reimburses the employee for every approved entry.
        self._approved(self.emp_a, "2026-04-02", "77.00", claimable=False)
        _make_entry(self.org, self.emp_a, self.client_master, date="2026-04-20", amount="11.00")  # pending

        res = self.api.get("/api/conveyance_entries/summary/?group_by=employee&mode=single&month=2026-04")
        self.assertEqual(res.status_code, 200, res.data)
        rows = {r["key_label"]: r for r in res.data["rows"]}
        self.assertEqual(Decimal(rows["A"]["total"]), Decimal("377.00"))
        self.assertEqual(rows["A"]["entry_count"], 3)
        self.assertEqual(Decimal(rows["B"]["total"]), Decimal("50.00"))
        self.assertEqual(rows["B"]["entry_count"], 1)
        self.assertEqual(Decimal(res.data["grand_total"]), Decimal("427.00"))

    def test_group_by_client_excludes_non_claimable(self):
        # Client totals are the basis for invoicing the client, so only
        # claimable entries roll up.
        self._approved(self.emp_a, "2026-04-01", "100.00")
        self._approved(self.emp_a, "2026-04-02", "77.00", claimable=False)

        res = self.api.get("/api/conveyance_entries/summary/?group_by=client&mode=single&month=2026-04")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(len(res.data["rows"]), 1)
        self.assertEqual(Decimal(res.data["rows"][0]["total"]), Decimal("100.00"))
        self.assertEqual(Decimal(res.data["grand_total"]), Decimal("100.00"))

    def test_top_entries_capped_at_three_ordered_desc(self):
        self._approved(self.emp_a, "2026-04-01", "100.00", reason="r1")
        self._approved(self.emp_a, "2026-04-02", "300.00", reason="r3")
        self._approved(self.emp_a, "2026-04-03", "200.00", reason="r2")
        self._approved(self.emp_a, "2026-04-04", "50.00", reason="r4")
        res = self.api.get("/api/conveyance_entries/summary/?group_by=employee&mode=single&month=2026-04")
        row = res.data["rows"][0]
        amounts = [Decimal(e["amount"]) for e in row["top_entries"]]
        self.assertEqual(amounts, [Decimal("300.00"), Decimal("200.00"), Decimal("100.00")])


class ConveyanceSummaryTrailingAndGuardsTests(TestCase):
    def setUp(self):
        self.org, self.admin = _make_org_user("admin", role="admin")
        self.emp = User.objects.create_user(username="emp", password="pw", full_name="Emp")
        OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")
        self.plain_emp_org, self.plain_emp = _make_org_user("plain", role="employee")
        self.client_master = _make_client(self.org)
        self.api = APIClient()

    def _approved(self, date, amount, reason="r"):
        e = _make_entry(
            self.org,
            self.emp,
            self.client_master,
            date=date,
            amount=amount,
            reason=reason,
        )
        e.status = "approved"
        e.reviewed_by = self.admin
        e.save()
        return e

    def test_plain_employee_forbidden(self):
        _auth(self.api, self.plain_emp)
        res = self.api.get("/api/conveyance_entries/summary/?group_by=employee&mode=single")
        self.assertEqual(res.status_code, 403)

    def test_trailing_mode_zero_fills_months(self):
        _auth(self.api, self.admin)
        self._approved("2026-04-10", "100.00")
        res = self.api.get("/api/conveyance_entries/summary/?group_by=employee&mode=trailing&months=3&end=2026-04")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["months"], ["2026-02", "2026-03", "2026-04"])
        self.assertEqual(len(res.data["rows"]), 1)
        monthly = res.data["rows"][0]["monthly"]
        self.assertEqual(Decimal(monthly["2026-02"]), Decimal("0.00"))
        self.assertEqual(Decimal(monthly["2026-03"]), Decimal("0.00"))
        self.assertEqual(Decimal(monthly["2026-04"]), Decimal("100.00"))
        self.assertEqual(Decimal(res.data["rows"][0]["total"]), Decimal("100.00"))

    def test_trailing_months_clamped_to_one_through_twelve(self):
        _auth(self.api, self.admin)
        self._approved("2026-04-10", "10.00")
        res = self.api.get("/api/conveyance_entries/summary/?group_by=employee&mode=trailing&months=99&end=2026-04")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data["months"]), 12)
        res = self.api.get("/api/conveyance_entries/summary/?group_by=employee&mode=trailing&months=0&end=2026-04")
        self.assertEqual(len(res.data["months"]), 1)
