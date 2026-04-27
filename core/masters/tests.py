import datetime

from django.test import TestCase
from rest_framework.test import APIClient

from core.masters.models import (
    ClientActionPoint,
    ClientActionPointAttachment,
    ClientMeeting,
    ClientMeetingAttachment,
    ClientRoadmap,
    Master,
)

# Import User concretely (not via ``get_user_model``) so pyright can see
# ``UserManager.create_user``; the generic ``Manager[_UserModel]`` returned
# by ``get_user_model().objects`` hides that helper.
from users.models import Org, OrgMembership, User


def _auth(client: APIClient, user: User) -> None:
    client.force_authenticate(user=user)


def _make_org_user(username: str, role: str = "admin") -> tuple[Org, User]:
    org = Org.objects.create(name=f"Org-{username}")
    user = User.objects.create_user(username=username, password="pw", full_name=username.title())
    OrgMembership.objects.create(user=user, org=org, role=role)
    return org, user


def _make_client(org: Org, name: str = "Acme") -> Master:
    m = Master.objects.create(name=name, type="client", org=org)
    m.orgs.add(org)
    return m


class ClientRoadmapCrudTests(TestCase):
    def setUp(self):
        self.org, self.admin = _make_org_user("admin1", role="admin")
        self.client_api = APIClient()
        _auth(self.client_api, self.admin)
        self.client_master = _make_client(self.org)

    def test_admin_creates_roadmap_item(self):
        payload = {
            "client": str(self.client_master.uid),
            "title": "Launch site",
            "target_date": "2026-06-01",
            "priority": "High",
            "status": "In Progress",
        }
        res = self.client_api.post("/api/client-roadmap/", payload, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(ClientRoadmap.objects.count(), 1)
        row = ClientRoadmap.objects.get()
        # Use the FK objects directly — pyright's django-stubs doesn't expose
        # the implicit ``<fk>_id`` column attribute, but ``<fk>.id`` is
        # equally valid and resolves without a type-ignore.
        assert row.org is not None and row.created_by is not None
        self.assertEqual(row.org.id, self.org.id)
        self.assertEqual(row.created_by.id, self.admin.id)

    def test_employee_cannot_write_roadmap(self):
        _, employee = _make_org_user("emp1", role="employee")
        OrgMembership.objects.filter(user=employee).delete()
        OrgMembership.objects.create(user=employee, org=self.org, role="employee")

        self.client_api.force_authenticate(user=employee)
        res = self.client_api.post(
            "/api/client-roadmap/",
            {"client": str(self.client_master.uid), "title": "Nope"},
            format="json",
        )
        self.assertEqual(res.status_code, 403, res.data)

    def test_employee_can_read_roadmap(self):
        ClientRoadmap.objects.create(org=self.org, client=self.client_master, title="X")
        _, employee = _make_org_user("emp2", role="employee")
        OrgMembership.objects.filter(user=employee).delete()
        OrgMembership.objects.create(user=employee, org=self.org, role="employee")
        self.client_api.force_authenticate(user=employee)
        res = self.client_api.get("/api/client-roadmap/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 1)

    def test_overdue_filter_covers_target_and_expected(self):
        import datetime

        today = datetime.date(2026, 4, 21)  # anchor
        # A: target in past, status Open → overdue by target
        ClientRoadmap.objects.create(
            org=self.org,
            client=self.client_master,
            title="A",
            target_date=datetime.date(2026, 1, 1),
            status="In Progress",
        )
        # B: expected slipped past target, both future → overdue by expected
        ClientRoadmap.objects.create(
            org=self.org,
            client=self.client_master,
            title="B",
            target_date=datetime.date(2099, 1, 1),
            expected_date=datetime.date(2099, 2, 1),
            status="Not Started",
        )
        # C: expected == target, future → NOT overdue
        ClientRoadmap.objects.create(
            org=self.org,
            client=self.client_master,
            title="C",
            target_date=datetime.date(2099, 1, 1),
            expected_date=datetime.date(2099, 1, 1),
            status="Not Started",
        )
        # D: target in past but Achieved → NOT overdue
        ClientRoadmap.objects.create(
            org=self.org,
            client=self.client_master,
            title="D",
            target_date=datetime.date(2026, 1, 1),
            status="Achieved",
        )

        _ = today  # kept for readability; the viewset uses timezone.localdate()
        res = self.client_api.get("/api/client-roadmap/", {"overdue": "true"})
        self.assertEqual(res.status_code, 200)
        titles = sorted(row["title"] for row in res.data)
        self.assertEqual(titles, ["A", "B"])


class ClientMeetingCrudTests(TestCase):
    def setUp(self):
        self.org, self.admin = _make_org_user("madmin", role="admin")
        self.client_api = APIClient()
        _auth(self.client_api, self.admin)
        self.client_master = _make_client(self.org)

    def test_create_meeting_and_add_action_point(self):
        res = self.client_api.post(
            "/api/client-meetings/",
            {
                "client": str(self.client_master.uid),
                "meeting_date": "2026-04-20",
                "meeting_type": "Review",
                "mode": "Video",
                "agenda": "Quarterly review",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)
        meeting_uid = res.data["uid"]
        self.assertEqual(ClientMeeting.objects.count(), 1)

        ap_res = self.client_api.post(
            f"/api/client-meetings/{meeting_uid}/action-points/",
            {
                "description": "Ship analytics dashboard",
                "responsibility": str(self.admin.uid),
                "target_date": "2026-05-15",
                "priority": "High",
            },
            format="json",
        )
        self.assertEqual(ap_res.status_code, 201, ap_res.data)
        self.assertEqual(ClientActionPoint.objects.count(), 1)

    def test_cascade_delete_action_points_with_meeting(self):
        meeting = ClientMeeting.objects.create(
            org=self.org, client=self.client_master, meeting_date=datetime.date(2026, 4, 20)
        )
        ClientActionPoint.objects.create(meeting=meeting, description="A")
        ClientActionPoint.objects.create(meeting=meeting, description="B")
        self.assertEqual(ClientActionPoint.objects.count(), 2)

        res = self.client_api.delete(f"/api/client-meetings/{meeting.uid}/")
        self.assertEqual(res.status_code, 204)
        self.assertEqual(ClientActionPoint.objects.count(), 0)

    def test_overdue_endpoint_lists_overdue_only(self):
        meeting = ClientMeeting.objects.create(
            org=self.org, client=self.client_master, meeting_date=datetime.date(2026, 1, 1)
        )
        # Overdue: target in the past, not Completed/Cancelled
        ClientActionPoint.objects.create(
            meeting=meeting, description="Overdue", target_date=datetime.date(2026, 1, 10), status="Open"
        )
        # Completed in the past: should NOT be overdue
        ClientActionPoint.objects.create(
            meeting=meeting,
            description="Done",
            target_date=datetime.date(2026, 1, 10),
            status="Completed",
            completion_date=datetime.date(2026, 1, 11),
        )
        # Future target
        ClientActionPoint.objects.create(
            meeting=meeting,
            description="Future",
            target_date=datetime.date(2099, 1, 1),
            status="Open",
        )

        res = self.client_api.get("/api/client-action-points/overdue/")
        self.assertEqual(res.status_code, 200)
        descs = sorted(row["description"] for row in res.data)
        self.assertEqual(descs, ["Overdue"])


class ClientActionPointUpdateTests(TestCase):
    def setUp(self):
        self.org, self.admin = _make_org_user("aadmin", role="admin")
        self.client_api = APIClient()
        _auth(self.client_api, self.admin)
        self.client_master = _make_client(self.org)
        self.meeting = ClientMeeting.objects.create(
            org=self.org, client=self.client_master, meeting_date=datetime.date(2026, 4, 20)
        )
        self.ap = ClientActionPoint.objects.create(meeting=self.meeting, description="Initial")

    def test_patch_status_and_completion(self):
        res = self.client_api.patch(
            f"/api/client-action-points/{self.ap.uid}/",
            {"status": "Completed", "completion_date": "2026-04-25"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.ap.refresh_from_db()
        self.assertEqual(self.ap.status, "Completed")
        self.assertEqual(self.ap.completion_date, datetime.date(2026, 4, 25))

    def test_cross_org_user_cannot_patch(self):
        other_org, other_admin = _make_org_user("other", role="admin")
        self.client_api.force_authenticate(user=other_admin)
        res = self.client_api.patch(
            f"/api/client-action-points/{self.ap.uid}/",
            {"status": "Completed"},
            format="json",
        )
        # Object falls outside the caller's org queryset → 404 (not 403) by design:
        # `get_queryset` filters to the caller's orgs, so the object doesn't exist from their perspective.
        self.assertIn(res.status_code, (403, 404))


class AttachmentUploadTests(TestCase):
    def setUp(self):
        self.org, self.admin = _make_org_user("attach", role="admin")
        self.client_api = APIClient()
        _auth(self.client_api, self.admin)
        self.client_master = _make_client(self.org)
        self.meeting = ClientMeeting.objects.create(
            org=self.org, client=self.client_master, meeting_date=datetime.date(2026, 4, 20)
        )

    def test_upload_attachment(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        upload = SimpleUploadedFile("notes.txt", b"hello world", content_type="text/plain")
        res = self.client_api.post(
            f"/api/client-meetings/{self.meeting.uid}/attachments/",
            {"file": upload},
            format="multipart",
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(ClientMeetingAttachment.objects.count(), 1)
        att = ClientMeetingAttachment.objects.get()
        assert att.uploaded_by is not None
        self.assertEqual(att.filename, "notes.txt")
        self.assertEqual(att.size_bytes, len(b"hello world"))
        self.assertEqual(att.uploaded_by.id, self.admin.id)
        # Download URL must point at the auth-gated DRF action, not the raw
        # /media/ path. Without this fix the frontend's openAuthenticatedFile
        # builds a 404'ing /api/media/... URL.
        self.assertIn("/client-attachments/", res.data["download_url"])
        self.assertIn("/download/", res.data["download_url"])

    def test_download_meeting_attachment(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        att = ClientMeetingAttachment.objects.create(
            meeting=self.meeting,
            file=SimpleUploadedFile("notes.txt", b"hello world", content_type="text/plain"),
            filename="notes.txt",
            size_bytes=len(b"hello world"),
            uploaded_by=self.admin,
        )
        res = self.client_api.get(f"/api/client-attachments/{att.uid}/download/")
        self.assertEqual(res.status_code, 200)
        body = b"".join(getattr(res, "streaming_content"))  # noqa: B009
        self.assertEqual(body, b"hello world")
        self.assertIn("notes.txt", res["Content-Disposition"])

    def test_action_point_attachment_upload_and_download(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        ap = ClientActionPoint.objects.create(meeting=self.meeting, description="Send recap")
        upload = SimpleUploadedFile("recap.txt", b"action data", content_type="text/plain")
        res = self.client_api.post(
            f"/api/client-action-points/{ap.uid}/attachments/",
            {"file": upload},
            format="multipart",
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(ClientActionPointAttachment.objects.count(), 1)
        self.assertIn("/client-ap-attachments/", res.data["download_url"])

        att = ClientActionPointAttachment.objects.get()
        download = self.client_api.get(f"/api/client-ap-attachments/{att.uid}/download/")
        self.assertEqual(download.status_code, 200)
        body = b"".join(getattr(download, "streaming_content"))  # noqa: B009
        self.assertEqual(body, b"action data")

    def test_action_point_attachments_in_dto(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        ap = ClientActionPoint.objects.create(meeting=self.meeting, description="Q")
        ClientActionPointAttachment.objects.create(
            action_point=ap,
            file=SimpleUploadedFile("a.txt", b"x", content_type="text/plain"),
            filename="a.txt",
            size_bytes=1,
            uploaded_by=self.admin,
        )
        res = self.client_api.get(f"/api/client-meetings/{self.meeting.uid}/")
        self.assertEqual(res.status_code, 200)
        ap_dto = res.data["action_points"][0]
        self.assertEqual(len(ap_dto["attachments"]), 1)
        self.assertEqual(ap_dto["attachments"][0]["filename"], "a.txt")
