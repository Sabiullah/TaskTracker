import datetime
import io
import os
import uuid
from decimal import Decimal

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient, APIRequestFactory

from core.conveyance.models import ConveyanceAttachment, ConveyanceEntry
from core.conveyance.recurrence import period_dates
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


class RecurrenceHelperTests(TestCase):
    def test_one_time_returns_single_date(self):
        result = period_dates("one_time", datetime.date(2026, 4, 1), datetime.date(2026, 4, 1))
        self.assertEqual(result, [datetime.date(2026, 4, 1)])

    def test_monthly_inclusive_range(self):
        result = period_dates("monthly", datetime.date(2026, 1, 1), datetime.date(2026, 12, 1))
        self.assertEqual(len(result), 12)
        self.assertEqual(result[0], datetime.date(2026, 1, 1))
        self.assertEqual(result[-1], datetime.date(2026, 12, 1))
        self.assertEqual(result[3], datetime.date(2026, 4, 1))

    def test_monthly_crosses_year_boundary(self):
        result = period_dates("monthly", datetime.date(2026, 11, 1), datetime.date(2027, 2, 1))
        self.assertEqual(result, [
            datetime.date(2026, 11, 1),
            datetime.date(2026, 12, 1),
            datetime.date(2027, 1, 1),
            datetime.date(2027, 2, 1),
        ])

    def test_half_yearly_step(self):
        result = period_dates("half_yearly", datetime.date(2026, 1, 1), datetime.date(2027, 6, 1))
        self.assertEqual(result, [
            datetime.date(2026, 1, 1),
            datetime.date(2026, 7, 1),
            datetime.date(2027, 1, 1),
        ])

    def test_yearly_step(self):
        result = period_dates("yearly", datetime.date(2026, 1, 1), datetime.date(2028, 12, 1))
        self.assertEqual(result, [
            datetime.date(2026, 1, 1),
            datetime.date(2027, 1, 1),
            datetime.date(2028, 1, 1),
        ])

    def test_end_before_start_returns_empty(self):
        result = period_dates("monthly", datetime.date(2026, 6, 1), datetime.date(2026, 3, 1))
        self.assertEqual(result, [])

    def test_unknown_frequency_raises(self):
        with self.assertRaises(ValueError):
            period_dates("weekly", datetime.date(2026, 1, 1), datetime.date(2026, 2, 1))

    def test_dates_normalised_to_first_of_month(self):
        # Caller may pass any day; helper still steps from the 1st.
        result = period_dates("monthly", datetime.date(2026, 1, 15), datetime.date(2026, 3, 25))
        self.assertEqual(result, [
            datetime.date(2026, 1, 1),
            datetime.date(2026, 2, 1),
            datetime.date(2026, 3, 1),
        ])


class ConveyanceEntryDefaultsTests(TestCase):
    def test_existing_style_create_defaults_to_one_time(self):
        org, user = _make_org_user("emp")
        master = _make_client(org)
        entry = _make_entry(org, user, master, reason="taxi")
        self.assertEqual(entry.frequency, "one_time")
        self.assertIsNone(entry.series_uid)
        self.assertIsNone(entry.start_month)
        self.assertIsNone(entry.end_month)


class ConveyanceEntrySerializerRecurringValidationTests(TestCase):
    def setUp(self):
        self.org, self.user = _make_org_user("emp", role="employee")
        self.master = _make_client(self.org)
        self.factory = APIRequestFactory()

    def _ctx(self):
        request = self.factory.post("/")
        request.user = self.user
        return {"request": request}

    def _base_payload(self, **overrides):
        payload = {
            "date": "2026-04-18",
            "client": str(self.master.uid),
            "reason": "taxi",
            "amount": "100.00",
            "claimable": True,
            "frequency": "one_time",
        }
        payload.update(overrides)
        return payload

    def test_one_time_rejects_start_or_end_month(self):
        s = ConveyanceEntrySerializer(
            data=self._base_payload(start_month="2026-04-01"),
            context=self._ctx(),
        )
        self.assertFalse(s.is_valid())
        self.assertIn("start_month", str(s.errors))

    def test_recurring_requires_both_months(self):
        s = ConveyanceEntrySerializer(
            data=self._base_payload(frequency="monthly", start_month="2026-04-01"),
            context=self._ctx(),
        )
        self.assertFalse(s.is_valid())
        self.assertIn("end_month", str(s.errors))

    def test_recurring_rejects_end_before_start(self):
        s = ConveyanceEntrySerializer(
            data=self._base_payload(
                frequency="monthly",
                start_month="2026-06-01",
                end_month="2026-03-01",
            ),
            context=self._ctx(),
        )
        self.assertFalse(s.is_valid())
        self.assertIn("end_month", str(s.errors))

    def test_recurring_normalises_to_first_of_month(self):
        s = ConveyanceEntrySerializer(
            data=self._base_payload(
                frequency="monthly",
                start_month="2026-04-15",
                end_month="2026-06-20",
            ),
            context=self._ctx(),
        )
        self.assertTrue(s.is_valid(), s.errors)
        self.assertEqual(s.validated_data["start_month"], datetime.date(2026, 4, 1))
        self.assertEqual(s.validated_data["end_month"], datetime.date(2026, 6, 1))

    def test_one_time_keeps_future_date_check(self):
        future = (datetime.date.today() + datetime.timedelta(days=30)).isoformat()
        s = ConveyanceEntrySerializer(
            data=self._base_payload(date=future),
            context=self._ctx(),
        )
        self.assertFalse(s.is_valid())
        self.assertIn("date", s.errors)

    def test_recurring_skips_future_date_check(self):
        # Future start_month is the whole point of recurring.
        future = datetime.date.today().replace(day=1) + datetime.timedelta(days=400)
        s = ConveyanceEntrySerializer(
            data=self._base_payload(
                frequency="monthly",
                start_month=future.isoformat(),
                end_month=future.isoformat(),
            ),
            context=self._ctx(),
        )
        self.assertTrue(s.is_valid(), s.errors)

    def test_recurring_missing_both_months(self):
        # When neither start_month nor end_month is provided, both keys
        # appear in the error payload so the frontend can highlight both.
        s = ConveyanceEntrySerializer(
            data=self._base_payload(frequency="monthly"),
            context=self._ctx(),
        )
        self.assertFalse(s.is_valid())
        self.assertIn("start_month", s.errors)
        self.assertIn("end_month", s.errors)

    def test_patch_without_frequency_on_recurring_skips_future_date_check(self):
        # Reproduce the bug fixed in Fix 1: PATCHing a future ``date`` on a
        # persisted recurring row must not 400 just because the payload
        # omits ``frequency``. The serializer should consult ``self.instance``
        # for the persisted frequency.
        org, user = _make_org_user("emp_recur", role="employee")
        master = _make_client(org)
        sid = uuid.uuid4()
        entry = ConveyanceEntry.objects.create(
            org=org,
            employee=user,
            client=master,
            reason="subscription",
            amount="500.00",
            claimable=True,
            date=datetime.date(2026, 1, 1),
            frequency="monthly",
            series_uid=sid,
            start_month=datetime.date(2026, 1, 1),
            end_month=datetime.date(2026, 12, 1),
        )
        future = (datetime.date.today() + datetime.timedelta(days=400)).isoformat()
        request = self.factory.patch("/")
        request.user = user
        s = ConveyanceEntrySerializer(
            instance=entry,
            data={"date": future},
            partial=True,
            context={"request": request},
        )
        self.assertTrue(s.is_valid(), s.errors)

    def test_one_time_date_check_not_bypassed_by_patching_frequency(self):
        # Defence: a PATCH on a one-time entry that spoofs frequency=monthly
        # must not skip the future-date check. The persisted frequency is
        # authoritative; serializer.update() strips frequency anyway.
        org, user = _make_org_user("emp_ot_bypass", role="employee")
        master = _make_client(org)
        entry = ConveyanceEntry.objects.create(
            org=org, employee=user, client=master,
            reason="taxi", amount="50.00",
            date=datetime.date.today(), frequency="one_time",
        )
        future = (datetime.date.today() + datetime.timedelta(days=30)).isoformat()
        request = self.factory.patch("/")
        request.user = user
        s = ConveyanceEntrySerializer(
            instance=entry,
            data={"frequency": "monthly", "date": future},
            partial=True,
            context={"request": request},
        )
        self.assertFalse(s.is_valid())
        self.assertIn("date", s.errors)


class ConveyanceEntryMaterialisationTests(TestCase):
    def setUp(self):
        self.org, self.emp = _make_org_user("emp", role="employee")
        self.client_master = _make_client(self.org)
        self.api = APIClient()
        _auth(self.api, self.emp)

    def test_one_time_create_unchanged(self):
        payload = {
            "date": "2026-04-18",
            "client": str(self.client_master.uid),
            "reason": "taxi",
            "amount": "100.00",
            "claimable": True,
            "frequency": "one_time",
        }
        res = self.api.post("/api/conveyance_entries/", payload, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(ConveyanceEntry.objects.count(), 1)
        entry = ConveyanceEntry.objects.get()
        self.assertEqual(entry.frequency, "one_time")
        self.assertIsNone(entry.series_uid)

    def test_monthly_creates_one_row_per_month(self):
        payload = {
            "client": str(self.client_master.uid),
            "reason": "subscription",
            "amount": "500.00",
            "claimable": True,
            "frequency": "monthly",
            "start_month": "2026-01-01",
            "end_month": "2026-12-01",
            "date": datetime.date.today().isoformat(),
        }
        res = self.api.post("/api/conveyance_entries/", payload, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(ConveyanceEntry.objects.count(), 12)

        rows = ConveyanceEntry.objects.order_by("date")
        self.assertEqual(rows[0].date, datetime.date(2026, 1, 1))
        self.assertEqual(rows[11].date, datetime.date(2026, 12, 1))

        # All siblings share the same series_uid.
        series_uids = {r.series_uid for r in rows}
        self.assertEqual(len(series_uids), 1)
        self.assertIsNotNone(series_uids.pop())

        # Every row has identical core fields.
        for r in rows:
            self.assertEqual(r.frequency, "monthly")
            self.assertEqual(r.reason, "subscription")
            self.assertEqual(str(r.amount), "500.00")
            self.assertEqual(r.start_month, datetime.date(2026, 1, 1))
            self.assertEqual(r.end_month, datetime.date(2026, 12, 1))
            self.assertEqual(r.status, "pending")

    def test_yearly_three_year_window(self):
        payload = {
            "client": str(self.client_master.uid),
            "reason": "renewal",
            "amount": "12000.00",
            "claimable": True,
            "frequency": "yearly",
            "start_month": "2026-01-01",
            "end_month": "2028-01-01",
            "date": datetime.date.today().isoformat(),
        }
        res = self.api.post("/api/conveyance_entries/", payload, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(ConveyanceEntry.objects.count(), 3)
        years = sorted(r.date.year for r in ConveyanceEntry.objects.all())
        self.assertEqual(years, [2026, 2027, 2028])

    def test_recurring_with_attachments_duplicates_per_sibling(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        f = SimpleUploadedFile("receipt.pdf", b"%PDF-1.4 fake", content_type="application/pdf")
        res = self.api.post(
            "/api/conveyance_entries/",
            {
                "client": str(self.client_master.uid),
                "reason": "subscription",
                "amount": "500.00",
                "claimable": "true",
                "frequency": "monthly",
                "start_month": "2026-01-01",
                "end_month": "2026-03-01",
                "date": datetime.date.today().isoformat(),
                "attachments": f,
            },
            format="multipart",
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(ConveyanceEntry.objects.count(), 3)
        # 1 attachment per sibling.
        self.assertEqual(ConveyanceAttachment.objects.count(), 3)
        # Cleanup files we wrote.
        for att in ConveyanceAttachment.objects.all():
            if att.file:
                try:
                    os.remove(att.file.path)
                except FileNotFoundError:
                    pass


class ConveyanceEntrySeriesApproveRejectTests(TestCase):
    def setUp(self):
        self.org, self.admin = _make_org_user("admin", role="admin")
        self.emp = User.objects.create_user(username="emp", password="pw", full_name="Emp")
        OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")
        self.client_master = _make_client(self.org)
        self.api = APIClient()
        _auth(self.api, self.admin)

    def _make_series(self, *, count=3, status="pending"):
        sid = uuid.uuid4()
        rows = []
        for i in range(count):
            rows.append(ConveyanceEntry.objects.create(
                org=self.org,
                employee=self.emp,
                client=self.client_master,
                reason="subscription",
                amount="100.00",
                claimable=True,
                date=datetime.date(2026, 1 + i, 1),
                frequency="monthly",
                series_uid=sid,
                start_month=datetime.date(2026, 1, 1),
                end_month=datetime.date(2026, 1 + count - 1, 1),
                status=status,
            ))
        return rows

    def test_approve_fans_out_across_series(self):
        rows = self._make_series(count=3)
        target_uid = rows[1].uid  # any sibling
        res = self.api.post(f"/api/conveyance_entries/{target_uid}/approve/")
        self.assertEqual(res.status_code, 200, res.data)
        statuses = list(ConveyanceEntry.objects.values_list("status", flat=True))
        self.assertEqual(statuses, ["approved", "approved", "approved"])

    def test_reject_fans_out_with_required_note(self):
        rows = self._make_series(count=2)
        res = self.api.post(
            f"/api/conveyance_entries/{rows[0].uid}/reject/",
            {"review_note": "duplicate of series X"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        for r in ConveyanceEntry.objects.all():
            self.assertEqual(r.status, "rejected")
            self.assertEqual(r.review_note, "duplicate of series X")

    def test_one_time_approve_unchanged(self):
        # Sanity: a one-time entry approves only itself.
        entry = _make_entry(self.org, self.emp, self.client_master, reason="taxi")
        res = self.api.post(f"/api/conveyance_entries/{entry.uid}/approve/")
        self.assertEqual(res.status_code, 200)
        entry.refresh_from_db()
        self.assertEqual(entry.status, "approved")

    def test_approve_skips_terminal_siblings(self):
        rows = self._make_series(count=3)
        # Pretend one is already approved (e.g. via a manual admin override).
        rows[0].status = "approved"
        rows[0].save()
        res = self.api.post(f"/api/conveyance_entries/{rows[2].uid}/approve/")
        self.assertEqual(res.status_code, 200, res.data)
        # All three end up approved (the already-approved row was a no-op).
        self.assertEqual(
            list(ConveyanceEntry.objects.order_by("date").values_list("status", flat=True)),
            ["approved", "approved", "approved"],
        )
        # Audit log row_count counts only the rows actually flipped.
        from core.audit.models import AuditLog
        log = AuditLog.objects.filter(action="conveyance.approve").latest("created_at")
        self.assertEqual(log.changes.get("row_count"), 2)


class ConveyanceEntryScopedEditDeleteTests(TestCase):
    def setUp(self):
        self.org, self.admin = _make_org_user("admin", role="admin")
        self.emp = User.objects.create_user(username="emp", password="pw", full_name="Emp")
        OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")
        self.client_master = _make_client(self.org)
        self.api = APIClient()
        _auth(self.api, self.admin)

        self.sid = uuid.uuid4()
        self.rows = []
        for i in range(4):
            self.rows.append(ConveyanceEntry.objects.create(
                org=self.org,
                employee=self.emp,
                client=self.client_master,
                reason="subscription",
                amount="100.00",
                claimable=True,
                date=datetime.date(2026, 1 + i, 1),
                frequency="monthly",
                series_uid=self.sid,
                start_month=datetime.date(2026, 1, 1),
                end_month=datetime.date(2026, 4, 1),
                status="pending",
            ))

    def test_scope_row_default(self):
        # The middle row's amount changes; siblings unaffected.
        target = self.rows[1]
        res = self.api.patch(
            f"/api/conveyance_entries/{target.uid}/",
            {"amount": "999.00"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        amounts = sorted(str(r.amount) for r in ConveyanceEntry.objects.all())
        self.assertEqual(amounts, ["100.00", "100.00", "100.00", "999.00"])

    def test_scope_series_propagates_to_all(self):
        target = self.rows[2]
        res = self.api.patch(
            f"/api/conveyance_entries/{target.uid}/?scope=series",
            {"amount": "555.00"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        amounts = sorted(str(r.amount) for r in ConveyanceEntry.objects.all())
        self.assertEqual(amounts, ["555.00", "555.00", "555.00", "555.00"])

    def test_scope_series_forward_only_clicked_and_later(self):
        target = self.rows[2]  # March
        res = self.api.patch(
            f"/api/conveyance_entries/{target.uid}/?scope=series_forward",
            {"amount": "777.00"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        rows_by_month = {r.date.month: str(r.amount) for r in ConveyanceEntry.objects.all()}
        self.assertEqual(rows_by_month[1], "100.00")
        self.assertEqual(rows_by_month[2], "100.00")
        self.assertEqual(rows_by_month[3], "777.00")
        self.assertEqual(rows_by_month[4], "777.00")

    def test_scope_series_does_not_propagate_date(self):
        target = self.rows[0]
        res = self.api.patch(
            f"/api/conveyance_entries/{target.uid}/?scope=series",
            {"date": "2026-06-01", "reason": "renamed"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        # Reason changed everywhere; dates are untouched.
        for r in ConveyanceEntry.objects.all().order_by("date"):
            self.assertEqual(r.reason, "renamed")
        months = [r.date.month for r in ConveyanceEntry.objects.order_by("date")]
        self.assertEqual(months, [1, 2, 3, 4])

    def test_scope_invalid_for_one_time(self):
        entry = _make_entry(self.org, self.emp, self.client_master, reason="taxi")
        res = self.api.patch(
            f"/api/conveyance_entries/{entry.uid}/?scope=series",
            {"amount": "200.00"},
            format="json",
        )
        self.assertEqual(res.status_code, 400, res.data)
        self.assertIn("scope", res.data)

    def test_scope_unknown_value_rejected(self):
        target = self.rows[0]
        res = self.api.patch(
            f"/api/conveyance_entries/{target.uid}/?scope=bogus",
            {"amount": "1.00"},
            format="json",
        )
        self.assertEqual(res.status_code, 400, res.data)

    def test_delete_scope_series_removes_all_siblings(self):
        target = self.rows[1]
        res = self.api.delete(f"/api/conveyance_entries/{target.uid}/?scope=series")
        self.assertEqual(res.status_code, 204, getattr(res, "data", None))
        self.assertEqual(ConveyanceEntry.objects.count(), 0)

    def test_delete_scope_series_forward_keeps_earlier(self):
        target = self.rows[2]  # March
        res = self.api.delete(f"/api/conveyance_entries/{target.uid}/?scope=series_forward")
        self.assertEqual(res.status_code, 204)
        remaining_months = sorted(r.date.month for r in ConveyanceEntry.objects.all())
        self.assertEqual(remaining_months, [1, 2])

    def test_immutable_fields_silently_dropped(self):
        target = self.rows[0]
        res = self.api.patch(
            f"/api/conveyance_entries/{target.uid}/?scope=series",
            {"frequency": "yearly", "start_month": "2099-01-01"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        for r in ConveyanceEntry.objects.all():
            self.assertEqual(r.frequency, "monthly")  # unchanged
            self.assertEqual(r.start_month, datetime.date(2026, 1, 1))

    def test_scope_series_patch_with_employee_uid_does_not_500(self):
        # employee_uid is a write_only serializer-only field. For series-scope
        # PATCHes it must be silently dropped before the bulk .update() so
        # the ORM doesn't raise FieldError (no such DB column).
        target = self.rows[0]
        res = self.api.patch(
            f"/api/conveyance_entries/{target.uid}/?scope=series",
            {"amount": "111.00", "employee_uid": str(self.emp.uid)},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        amounts = sorted(str(r.amount) for r in ConveyanceEntry.objects.all())
        self.assertEqual(amounts, ["111.00", "111.00", "111.00", "111.00"])
