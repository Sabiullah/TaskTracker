"""Tests for the Leads attachment feature.

Mirrors the patterns established by ``core/masters/tests.py`` for
``VisitReportAttachment`` — model behaviour, multipart upload, label
validation, list/visibility, delete permissions, and download streaming.
"""

import datetime as _dt

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from core.leads.models import Lead, LeadAttachment, LeadHistory, LeadStatus
from users.models import Org, OrgMembership, User


def _make_org_user(username: str, role: str = "admin") -> tuple[Org, User]:
    org = Org.objects.create(name=f"Org-{username}")
    user = User.objects.create_user(username=username, password="pw", full_name=username.title())
    OrgMembership.objects.create(user=user, org=org, role=role)
    return org, user


def _make_lead(org: Org, owner: User, **overrides) -> Lead:
    status = LeadStatus.objects.create(org=org, name=overrides.pop("status_name", "Open"))
    defaults = dict(
        org=org,
        client_name="Acme Co",
        priority="Medium",
        status=status,
        created_by=owner,
        assigned_to=owner,
        next_step_date=_dt.date(2026, 5, 30),
    )
    defaults.update(overrides)
    return Lead.objects.create(**defaults)


class LeadAttachmentModelTests(TestCase):
    def setUp(self):
        self.org, self.user = _make_org_user("la_model", role="employee")
        self.lead = _make_lead(self.org, self.user)

    def test_create_and_str(self):
        att = LeadAttachment.objects.create(
            lead=self.lead,
            file=SimpleUploadedFile("a.txt", b"abc", content_type="text/plain"),
            filename="a.txt",
            label="Proposal v1",
            size_bytes=3,
            uploaded_by=self.user,
        )
        self.assertEqual(LeadAttachment.objects.count(), 1)
        self.assertEqual(att.lead.pk, self.lead.pk)
        self.assertEqual(str(att), "Proposal v1")

    def test_cascade_on_lead_delete(self):
        LeadAttachment.objects.create(
            lead=self.lead,
            file=SimpleUploadedFile("a.txt", b"abc"),
            filename="a.txt",
            label="x",
            size_bytes=3,
            uploaded_by=self.user,
        )
        self.lead.delete()
        self.assertEqual(LeadAttachment.objects.count(), 0)


class LeadAttachmentApiTests(TestCase):
    def setUp(self):
        # Owner / assignee.
        self.org, self.owner = _make_org_user("la_owner", role="employee")
        # Manager in same org (can also mutate).
        self.manager = User.objects.create_user(username="la_mgr", password="pw", full_name="Mgr")
        OrgMembership.objects.create(user=self.manager, org=self.org, role="manager")
        # Outsider — different org, no access.
        self.outsider = User.objects.create_user(username="la_out", password="pw", full_name="Out")
        OrgMembership.objects.create(
            user=self.outsider,
            org=Org.objects.create(name="Other"),
            role="employee",
        )
        self.lead = _make_lead(self.org, self.owner)
        self.api = APIClient()
        self.api.force_authenticate(self.owner)

    def _upload(self, *, name="a.txt", body=b"hello", label="Doc 1"):
        upload = SimpleUploadedFile(name, body, content_type="text/plain")
        return self.api.post(
            f"/api/leads/{self.lead.uid}/attachments/",
            {"file": upload, "label": label},
            format="multipart",
        )

    def test_upload_creates_attachment_with_label(self):
        res = self._upload(name="quote.pdf", body=b"PDFBYTES", label="Quote rev 1")
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(LeadAttachment.objects.count(), 1)
        att = LeadAttachment.objects.get()
        self.assertEqual(att.filename, "quote.pdf")
        self.assertEqual(att.label, "Quote rev 1")
        self.assertEqual(att.size_bytes, len(b"PDFBYTES"))
        assert att.uploaded_by is not None
        self.assertEqual(att.uploaded_by.id, self.owner.id)
        self.assertIn("/lead-attachments/", res.data["download_url"])
        self.assertIn("/download/", res.data["download_url"])

    def test_upload_requires_file(self):
        res = self.api.post(
            f"/api/leads/{self.lead.uid}/attachments/",
            {"label": "Just a label"},
            format="multipart",
        )
        self.assertEqual(res.status_code, 400, res.data)
        self.assertIn("file", res.data)

    def test_upload_requires_non_blank_label(self):
        upload = SimpleUploadedFile("a.txt", b"hi", content_type="text/plain")
        res = self.api.post(
            f"/api/leads/{self.lead.uid}/attachments/",
            {"file": upload, "label": "   "},
            format="multipart",
        )
        self.assertEqual(res.status_code, 400, res.data)
        self.assertIn("label", res.data)
        self.assertEqual(LeadAttachment.objects.count(), 0)

    def test_list_attachments(self):
        self._upload(name="a.txt", label="A")
        self._upload(name="b.txt", label="B")
        res = self.api.get(f"/api/leads/{self.lead.uid}/attachments/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 2)

    def test_lead_serializer_includes_attachments(self):
        self._upload(name="a.txt", label="A")
        res = self.api.get(f"/api/leads/{self.lead.uid}/")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(len(res.data["attachments"]), 1)
        self.assertEqual(res.data["attachments"][0]["label"], "A")

    def test_outsider_cannot_upload_or_list(self):
        self.api.force_authenticate(self.outsider)
        upload_res = self._upload()
        self.assertIn(upload_res.status_code, (403, 404))
        list_res = self.api.get(f"/api/leads/{self.lead.uid}/attachments/")
        self.assertIn(list_res.status_code, (403, 404))

    def test_manager_can_upload(self):
        self.api.force_authenticate(self.manager)
        res = self._upload(label="From mgr")
        self.assertEqual(res.status_code, 201, res.data)

    def test_employee_who_isnt_owner_cannot_upload(self):
        # Add a new employee in same org, not assigned to this lead.
        other_emp = User.objects.create_user(username="la_emp2", password="pw", full_name="Emp 2")
        OrgMembership.objects.create(user=other_emp, org=self.org, role="employee")
        self.api.force_authenticate(other_emp)
        # Per visibility_q, an employee can only see leads they're assigned to —
        # so the parent get_object() raises 404 before our perm check fires.
        res = self._upload()
        self.assertIn(res.status_code, (403, 404))

    def test_download_attachment(self):
        self._upload(name="notes.txt", body=b"hello world", label="Notes")
        att = LeadAttachment.objects.get()
        res = self.api.get(f"/api/lead-attachments/{att.uid}/download/")
        self.assertEqual(res.status_code, 200)
        body = b"".join(getattr(res, "streaming_content"))  # noqa: B009
        self.assertEqual(body, b"hello world")
        self.assertIn("notes.txt", res["Content-Disposition"])

    def test_delete_attachment(self):
        self._upload(name="a.txt", label="A")
        att = LeadAttachment.objects.get()
        res = self.api.delete(f"/api/lead-attachments/{att.uid}/")
        self.assertEqual(res.status_code, 204)
        self.assertEqual(LeadAttachment.objects.count(), 0)

    def test_outsider_cannot_delete(self):
        self._upload(name="a.txt", label="A")
        att = LeadAttachment.objects.get()
        self.api.force_authenticate(self.outsider)
        res = self.api.delete(f"/api/lead-attachments/{att.uid}/")
        self.assertIn(res.status_code, (403, 404))
        self.assertEqual(LeadAttachment.objects.count(), 1)


class LeadHistoryApiTests(TestCase):
    """Follow-up Log save flow — POST /api/lead_history/ with {lead_uid, note}."""

    def setUp(self):
        self.org, self.user = _make_org_user("lh_user", role="employee")
        self.lead = _make_lead(self.org, self.user)
        self.api = APIClient()
        self.api.force_authenticate(self.user)

    def test_create_with_lead_uid(self):
        res = self.api.post(
            "/api/lead_history/",
            {"lead_uid": str(self.lead.uid), "note": "Called the client"},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)
        entry = LeadHistory.objects.get()
        self.assertEqual(entry.lead_id, self.lead.pk)
        self.assertEqual(entry.note, "Called the client")
        assert entry.created_by is not None
        self.assertEqual(entry.created_by.id, self.user.id)

    def test_create_requires_lead_uid(self):
        res = self.api.post(
            "/api/lead_history/",
            {"note": "no lead"},
            format="json",
        )
        self.assertEqual(res.status_code, 400, res.data)
        self.assertEqual(LeadHistory.objects.count(), 0)

    def test_list_filters_by_lead_uid(self):
        LeadHistory.objects.create(lead=self.lead, note="first", created_by=self.user)
        LeadHistory.objects.create(lead=self.lead, note="second", created_by=self.user)
        res = self.api.get("/api/lead_history/", {"lead_uid": str(self.lead.uid)})
        self.assertEqual(res.status_code, 200)
        notes = sorted(r["note"] for r in res.data)
        self.assertEqual(notes, ["first", "second"])
