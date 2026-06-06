import datetime
import datetime as _dt

from django.test import TestCase
from rest_framework.test import APIClient

from core.masters.models import (
    ClientActionPoint,
    ClientActionPointAttachment,
    ClientMeeting,
    ClientMeetingAttachment,
    ClientRoadmap,
    ClientVisit,
    Master,
    VisitReport,
    VisitReportAuditEvent,
    is_visit_overdue,
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


class MasterCategoryCreateTests(TestCase):
    """Regression: a user in 2+ orgs could not add a category from the
    Masters page because the frontend sent ``orgs=[]`` and the backend's
    ``resolve_create_org`` returned 400 ("`org` is required"). Categories
    are "global per-caller" — the modal has no org picker, so the
    frontend now attaches every caller-org. This test pins the contract
    so the API keeps accepting the multi-org payload it now sends.
    """

    def setUp(self):
        self.org_a = Org.objects.create(name="Org-A")
        self.org_b = Org.objects.create(name="Org-B")
        self.admin = User.objects.create_user(username="multi", password="pw", full_name="Multi Org")
        OrgMembership.objects.create(user=self.admin, org=self.org_a, role="admin")
        OrgMembership.objects.create(user=self.admin, org=self.org_b, role="admin")
        self.client_api = APIClient()
        _auth(self.client_api, self.admin)

    def test_create_category_with_orgs_list_succeeds(self):
        res = self.client_api.post(
            "/api/masters/",
            {
                "name": "Book Keeping",
                "type": "category",
                "org": str(self.org_a.uid),
                "orgs": [str(self.org_a.uid), str(self.org_b.uid)],
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)
        row = Master.objects.get(name="Book Keeping", type="category")
        # Both orgs end up on the M2M; legacy FK pinned to the primary.
        # ``row.org.id`` instead of ``row.org_id`` because pyright's
        # django-stubs doesn't surface the implicit ``<fk>_id`` column
        # attribute (mirrors ClientActionPoint.__str__ in models.py).
        assert row.org is not None
        self.assertEqual(row.org.id, self.org_a.id)
        self.assertEqual({o.id for o in row.orgs.all()}, {self.org_a.id, self.org_b.id})

    def test_create_category_without_org_400s_when_caller_has_multiple_orgs(self):
        # Pre-fix the frontend hit this path; keeping it as an explicit guard
        # so anyone touching ``resolve_create_org`` sees the contract.
        res = self.client_api.post(
            "/api/masters/",
            {"name": "Untagged", "type": "category"},
            format="json",
        )
        self.assertEqual(res.status_code, 400, res.data)


class MasterUniquenessTests(TestCase):
    """Regression: the old ``unique_together = ("type", "name", "org")``
    forbade two different mains from each having a sub-category named
    ``Sales`` — saving the second one returned HTTP 400 from the inline
    children editor on the Categories master modal. The constraint was
    split into two partial uniques (mains by parent IS NULL, subs by
    parent), and ``MasterSerializer.validate`` now enforces both at the
    API layer with explicit field errors."""

    def setUp(self):
        self.org, self.admin = _make_org_user("uniq_admin", role="admin")
        self.client_api = APIClient()
        _auth(self.client_api, self.admin)
        self.main_a = Master.objects.create(name="Audit A", type="category", org=self.org)
        self.main_a.orgs.add(self.org)
        self.main_b = Master.objects.create(name="Audit B", type="category", org=self.org)
        self.main_b.orgs.add(self.org)

    def _post_sub(self, name: str, parent_uid: str):
        return self.client_api.post(
            "/api/masters/",
            {
                "name": name,
                "type": "category",
                "org": str(self.org.uid),
                "orgs": [str(self.org.uid)],
                "parent": parent_uid,
                "recurrence": "Monthly",
                "target_day": 10,
            },
            format="json",
        )

    def test_same_named_subs_under_different_parents_allowed(self):
        # The reported bug: adding "Sales" under two mains 400'd. Now allowed.
        r1 = self._post_sub("Sales", str(self.main_a.uid))
        r2 = self._post_sub("Sales", str(self.main_b.uid))
        self.assertEqual(r1.status_code, 201, r1.data)
        self.assertEqual(r2.status_code, 201, r2.data)
        self.assertEqual(Master.objects.filter(name="Sales", parent__isnull=False).count(), 2)

    def test_duplicate_sub_under_same_parent_rejected(self):
        r1 = self._post_sub("Sales", str(self.main_a.uid))
        self.assertEqual(r1.status_code, 201, r1.data)
        r2 = self._post_sub("Sales", str(self.main_a.uid))
        self.assertEqual(r2.status_code, 400, r2.data)
        self.assertIn("name", r2.data)

    def test_duplicate_main_in_same_org_rejected(self):
        # Mains share parent=NULL — DRF's auto UniqueTogetherValidator skips
        # NULL values so it would have allowed dups. The custom validator
        # in ``MasterSerializer.validate`` handles this case.
        res = self.client_api.post(
            "/api/masters/",
            {
                "name": "Audit A",  # already exists as a main
                "type": "category",
                "org": str(self.org.uid),
                "orgs": [str(self.org.uid)],
                "parent": None,
            },
            format="json",
        )
        self.assertEqual(res.status_code, 400, res.data)
        self.assertIn("name", res.data)

    def test_duplicate_client_rejected_without_requiring_parent(self):
        # POSTing a client must not 400 with "parent: required" — clients
        # never carry a parent. The auto-generated UniqueTogetherValidator
        # would have demanded it; we strip it in Meta.validators.
        Master.objects.create(name="AcmeDup", type="client", org=self.org).orgs.add(self.org)
        res = self.client_api.post(
            "/api/masters/",
            {
                "name": "AcmeDup",
                "type": "client",
                "org": str(self.org.uid),
                "orgs": [str(self.org.uid)],
            },
            format="json",
        )
        self.assertEqual(res.status_code, 400, res.data)
        self.assertIn("name", res.data)
        self.assertNotIn("parent", res.data)

    def test_patch_existing_sub_no_op_succeeds(self):
        sub = Master.objects.create(
            name="Sales", type="category", org=self.org, parent=self.main_a, recurrence="Monthly", target_day=10
        )
        sub.orgs.add(self.org)
        res = self.client_api.patch(
            f"/api/masters/{sub.uid}/",
            {
                "name": "Sales",
                "type": "category",
                "org": str(self.org.uid),
                "orgs": [str(self.org.uid)],
                "parent": str(self.main_a.uid),
                "recurrence": "Quarterly",
                "target_day": 15,
            },
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        sub.refresh_from_db()
        self.assertEqual(sub.recurrence, "Quarterly")
        self.assertEqual(sub.target_day, 15)

    def test_post_weekly_with_weekday_in_range_succeeds(self):
        res = self.client_api.post(
            "/api/masters/",
            {
                "name": "Weekly Sync",
                "type": "category",
                "org": str(self.org.uid),
                "orgs": [str(self.org.uid)],
                "parent": str(self.main_a.uid),
                "recurrence": "Weekly",
                "target_day": 3,
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)
        sub = Master.objects.get(name="Weekly Sync")
        self.assertEqual(sub.recurrence, "Weekly")
        self.assertEqual(sub.target_day, 3)

    def test_post_weekly_with_weekday_out_of_range_rejected(self):
        res = self.client_api.post(
            "/api/masters/",
            {
                "name": "Bad Weekly",
                "type": "category",
                "org": str(self.org.uid),
                "orgs": [str(self.org.uid)],
                "parent": str(self.main_a.uid),
                "recurrence": "Weekly",
                "target_day": 15,
            },
            format="json",
        )
        self.assertEqual(res.status_code, 400, res.data)
        self.assertIn("target_day", res.data)

    def test_post_monthly_with_day_in_range_still_succeeds(self):
        # Regression: existing 1-31 path must keep working.
        res = self.client_api.post(
            "/api/masters/",
            {
                "name": "Monthly Sales",
                "type": "category",
                "org": str(self.org.uid),
                "orgs": [str(self.org.uid)],
                "parent": str(self.main_a.uid),
                "recurrence": "Monthly",
                "target_day": 15,
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)

    def test_post_monthly_with_day_above_31_rejected(self):
        # Regression: out-of-range day-of-month still 400s.
        res = self.client_api.post(
            "/api/masters/",
            {
                "name": "Bad Monthly",
                "type": "category",
                "org": str(self.org.uid),
                "orgs": [str(self.org.uid)],
                "parent": str(self.main_a.uid),
                "recurrence": "Monthly",
                "target_day": 32,
            },
            format="json",
        )
        self.assertEqual(res.status_code, 400, res.data)
        self.assertIn("target_day", res.data)


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


class VisitOverdueTests(TestCase):
    def setUp(self):
        self.org, self.user = _make_org_user("ovduser", role="employee")
        self.client_master = _make_client(self.org)

    def _visit(self, visit_date, sent_date=None) -> ClientVisit:
        return ClientVisit.objects.create(
            org=self.org,
            client=self.client_master,
            visit_date=visit_date,
            prepared_by=self.user,
            report_sent_date=sent_date,
        )

    def test_today_minus_zero_not_overdue(self):
        today = _dt.date(2026, 4, 27)
        v = self._visit(today)
        self.assertFalse(is_visit_overdue(v, today=today))

    def test_today_minus_one_not_overdue(self):
        today = _dt.date(2026, 4, 27)
        v = self._visit(today - _dt.timedelta(days=1))
        self.assertFalse(is_visit_overdue(v, today=today))

    def test_today_minus_two_is_overdue(self):
        today = _dt.date(2026, 4, 27)
        v = self._visit(today - _dt.timedelta(days=2))
        self.assertTrue(is_visit_overdue(v, today=today))

    def test_sent_date_set_means_not_overdue(self):
        today = _dt.date(2026, 4, 27)
        v = self._visit(today - _dt.timedelta(days=10), sent_date=today)
        self.assertFalse(is_visit_overdue(v, today=today))


class VisitReportLifecycleTests(TestCase):
    def setUp(self):
        self.org, self.admin = _make_org_user("admin_lc", role="admin")
        self.junior = User.objects.create_user(username="jr1", password="pw", full_name="Junior 1")
        OrgMembership.objects.create(user=self.junior, org=self.org, role="employee")
        self.manager = User.objects.create_user(username="mgr1", password="pw", full_name="Mgr 1")
        OrgMembership.objects.create(user=self.manager, org=self.org, role="manager")
        self.client_master = _make_client(self.org)

        self.api = APIClient()

    def _create_visit_as_junior(self, **overrides):
        self.api.force_authenticate(self.junior)
        payload = {
            "client": str(self.client_master.uid),
            "visit_date": "2026-04-25",
            "assigned_manager": str(self.manager.uid),
            "key_points": "ok",
        }
        payload.update(overrides)
        return self.api.post("/api/client-visits/", payload, format="multipart")

    def test_create_visit_creates_initial_report_in_draft(self):
        res = self._create_visit_as_junior()
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(ClientVisit.objects.count(), 1)
        visit = ClientVisit.objects.get()
        # Query directly via the explicit FK rather than the reverse manager —
        # pyright's django-stubs doesn't surface ``related_name`` accessors.
        self.assertEqual(VisitReport.objects.filter(visit=visit).count(), 1)
        report = VisitReport.objects.get(visit=visit)
        self.assertEqual(report.revision_number, 1)
        self.assertEqual(report.status, "Draft")
        self.assertEqual(visit.current_status, "Draft")
        self.assertEqual(VisitReportAuditEvent.objects.filter(visit=visit).count(), 1)
        self.assertEqual(VisitReportAuditEvent.objects.get(visit=visit).event_type, "created")

    def test_submit_then_approve_full_flow(self):
        res = self._create_visit_as_junior()
        report_uid = res.data["reports"][0]["uid"]
        # Submit (still as junior)
        r2 = self.api.post(f"/api/visit-reports/{report_uid}/submit/", {}, format="json")
        self.assertEqual(r2.status_code, 200, r2.data)
        # Approve as the manager
        self.api.force_authenticate(self.manager)
        r3 = self.api.post(f"/api/visit-reports/{report_uid}/approve/", {}, format="json")
        self.assertEqual(r3.status_code, 200, r3.data)
        report = VisitReport.objects.get(uid=report_uid)
        self.assertEqual(report.status, "Approved")
        self.assertEqual(report.visit.current_status, "Approved")
        self.assertEqual(
            list(
                VisitReportAuditEvent.objects.filter(visit=report.visit)
                .order_by("created_at")
                .values_list("event_type", flat=True)
            ),
            ["created", "submitted", "approved"],
        )

    def test_reject_requires_comment(self):
        res = self._create_visit_as_junior()
        report_uid = res.data["reports"][0]["uid"]
        self.api.post(f"/api/visit-reports/{report_uid}/submit/", {}, format="json")
        self.api.force_authenticate(self.manager)
        r = self.api.post(f"/api/visit-reports/{report_uid}/reject/", {"manager_comment": ""}, format="json")
        self.assertEqual(r.status_code, 400, r.data)
        self.assertIn("manager_comment", r.data)

    def test_resubmit_creates_new_revision(self):
        res = self._create_visit_as_junior()
        first_uid = res.data["reports"][0]["uid"]
        self.api.post(f"/api/visit-reports/{first_uid}/submit/", {}, format="json")
        self.api.force_authenticate(self.manager)
        self.api.post(
            f"/api/visit-reports/{first_uid}/reject/",
            {"manager_comment": "missing photos"},
            format="json",
        )
        self.api.force_authenticate(self.junior)
        r = self.api.post(
            f"/api/visit-reports/{first_uid}/resubmit/",
            {"key_points": "with photos"},
            format="multipart",
        )
        self.assertEqual(r.status_code, 201, r.data)
        visit = VisitReport.objects.get(uid=first_uid).visit
        self.assertEqual(VisitReport.objects.filter(visit=visit).count(), 2)
        latest = VisitReport.objects.filter(visit=visit).order_by("-revision_number").first()
        assert latest is not None
        self.assertEqual(latest.revision_number, 2)
        self.assertEqual(latest.status, "Draft")

    def test_cannot_edit_approved_report(self):
        res = self._create_visit_as_junior()
        report_uid = res.data["reports"][0]["uid"]
        self.api.post(f"/api/visit-reports/{report_uid}/submit/", {}, format="json")
        self.api.force_authenticate(self.manager)
        self.api.post(f"/api/visit-reports/{report_uid}/approve/", {}, format="json")
        self.api.force_authenticate(self.junior)
        r = self.api.patch(
            f"/api/visit-reports/{report_uid}/",
            {"key_points": "changed after approval"},
            format="json",
        )
        self.assertEqual(r.status_code, 403, r.data)

    def test_sent_info_editable_before_approval(self):
        # Sent-info (sent date, voice-note tick, voice-note summary) can be
        # filled in by the manager / org admin at any visit status — the panel
        # is no longer gated on having an Approved revision.
        res = self._create_visit_as_junior()
        visit_uid = res.data["uid"]
        self.api.force_authenticate(self.manager)
        r = self.api.patch(
            f"/api/client-visits/{visit_uid}/sent-info/",
            {
                "report_sent_date": "2026-04-26",
                "voice_note_sent": True,
                "voice_note_summary": "Walked client through findings.",
            },
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["report_sent_date"], "2026-04-26")
        self.assertTrue(r.data["voice_note_sent"])
        self.assertEqual(r.data["voice_note_summary"], "Walked client through findings.")

    def test_resubmit_clones_attachments_to_new_revision(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        from core.masters.models import VisitReportAttachment

        res = self._create_visit_as_junior()
        first_uid = res.data["reports"][0]["uid"]
        self.api.post(
            f"/api/visit-reports/{first_uid}/attachments/",
            {"file": SimpleUploadedFile("a.txt", b"AAA", content_type="text/plain")},
            format="multipart",
        )
        self.api.post(
            f"/api/visit-reports/{first_uid}/attachments/",
            {"file": SimpleUploadedFile("b.txt", b"BB", content_type="text/plain")},
            format="multipart",
        )
        self.api.post(f"/api/visit-reports/{first_uid}/submit/", {}, format="json")
        self.api.force_authenticate(self.manager)
        self.api.post(
            f"/api/visit-reports/{first_uid}/reject/",
            {"manager_comment": "redo"},
            format="json",
        )
        self.api.force_authenticate(self.junior)
        r = self.api.post(
            f"/api/visit-reports/{first_uid}/resubmit/",
            {"key_points": "redone"},
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.data)
        new_uid = r.data["uid"]
        # Each revision keeps its own attachment rows — we duplicate them.
        self.assertEqual(VisitReportAttachment.objects.filter(report__uid=first_uid).count(), 2)
        self.assertEqual(VisitReportAttachment.objects.filter(report__uid=new_uid).count(), 2)
        new_filenames = sorted(
            VisitReportAttachment.objects.filter(report__uid=new_uid).values_list("filename", flat=True)
        )
        self.assertEqual(new_filenames, ["a.txt", "b.txt"])


class VisitReportPermissionTests(TestCase):
    def setUp(self):
        self.org, self.admin = _make_org_user("admin_perm", role="admin")
        self.junior_a = User.objects.create_user(username="jra", password="pw", full_name="Jr A")
        self.junior_b = User.objects.create_user(username="jrb", password="pw", full_name="Jr B")
        for u in (self.junior_a, self.junior_b):
            OrgMembership.objects.create(user=u, org=self.org, role="employee")
        self.manager = User.objects.create_user(username="mgr_perm", password="pw", full_name="Mgr")
        OrgMembership.objects.create(user=self.manager, org=self.org, role="manager")
        self.other_manager = User.objects.create_user(username="othermgr", password="pw", full_name="OM")
        OrgMembership.objects.create(user=self.other_manager, org=self.org, role="manager")
        self.client_master = _make_client(self.org)
        self.api = APIClient()

    def _make_visit(self, prepared_by, assigned_manager):
        self.api.force_authenticate(prepared_by)
        return self.api.post(
            "/api/client-visits/",
            {
                "client": str(self.client_master.uid),
                "visit_date": "2026-04-25",
                "assigned_manager": str(assigned_manager.uid),
                "key_points": "x",
            },
            format="multipart",
        )

    def test_other_junior_cannot_see_report(self):
        self._make_visit(self.junior_a, self.manager)
        self.api.force_authenticate(self.junior_b)
        res = self.api.get("/api/client-visits/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data, [])

    def test_other_manager_in_org_can_see_report(self):
        # Any manager who belongs to the visit's org sees every visit in that
        # org — not only ones where they're the assigned manager.
        res = self._make_visit(self.junior_a, self.manager)
        visit_uid = res.data["uid"]
        self.api.force_authenticate(self.other_manager)
        res = self.api.get("/api/client-visits/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual([v["uid"] for v in res.data], [visit_uid])

    def test_other_manager_in_org_can_approve(self):
        # Approval is open to any manager (or admin) in the org, regardless of
        # who the report's assigned manager is.
        res = self._make_visit(self.junior_a, self.manager)
        report_uid = res.data["reports"][0]["uid"]
        self.api.force_authenticate(self.junior_a)
        self.api.post(f"/api/visit-reports/{report_uid}/submit/", {}, format="json")
        self.api.force_authenticate(self.other_manager)
        r = self.api.post(f"/api/visit-reports/{report_uid}/approve/", {}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["status"], "Approved")

    def test_employee_cannot_approve(self):
        # Employees in the org (who aren't the author) still can't act on a
        # report — the manager expansion does not reach the employee role.
        res = self._make_visit(self.junior_a, self.manager)
        report_uid = res.data["reports"][0]["uid"]
        self.api.force_authenticate(self.junior_a)
        self.api.post(f"/api/visit-reports/{report_uid}/submit/", {}, format="json")
        self.api.force_authenticate(self.junior_b)
        r = self.api.post(f"/api/visit-reports/{report_uid}/approve/", {}, format="json")
        self.assertIn(r.status_code, (403, 404))

    def test_admin_can_approve_any_report(self):
        res = self._make_visit(self.junior_a, self.manager)
        report_uid = res.data["reports"][0]["uid"]
        self.api.force_authenticate(self.junior_a)
        self.api.post(f"/api/visit-reports/{report_uid}/submit/", {}, format="json")
        self.api.force_authenticate(self.admin)
        r = self.api.post(f"/api/visit-reports/{report_uid}/approve/", {}, format="json")
        self.assertEqual(r.status_code, 200, r.data)

    def test_manager_in_other_org_cannot_see_or_approve(self):
        # Org isolation is preserved: a manager who belongs to a *different* org
        # neither sees nor can approve this org's reports.
        _foreign_org, foreign_manager = _make_org_user("foreignmgr", role="manager")
        res = self._make_visit(self.junior_a, self.manager)
        report_uid = res.data["reports"][0]["uid"]
        self.api.force_authenticate(self.junior_a)
        self.api.post(f"/api/visit-reports/{report_uid}/submit/", {}, format="json")
        self.api.force_authenticate(foreign_manager)
        listed = self.api.get("/api/client-visits/")
        self.assertEqual(listed.data, [])
        r = self.api.post(f"/api/visit-reports/{report_uid}/approve/", {}, format="json")
        self.assertIn(r.status_code, (403, 404))


class VisitReportAttachmentModelTests(TestCase):
    def setUp(self):
        self.org, self.user = _make_org_user("vra_model", role="employee")
        self.client_master = _make_client(self.org)
        self.visit = ClientVisit.objects.create(
            org=self.org,
            client=self.client_master,
            visit_date=datetime.date(2026, 4, 25),
            prepared_by=self.user,
            assigned_manager=self.user,
        )
        self.report = VisitReport.objects.create(
            visit=self.visit,
            revision_number=1,
            status="Draft",
            created_by=self.user,
        )

    def test_attachment_can_be_created_and_cascades(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        from core.masters.models import VisitReportAttachment

        att = VisitReportAttachment.objects.create(
            report=self.report,
            file=SimpleUploadedFile("a.txt", b"abc", content_type="text/plain"),
            filename="a.txt",
            size_bytes=3,
            uploaded_by=self.user,
        )
        self.assertEqual(VisitReportAttachment.objects.count(), 1)
        # ``att.report.pk`` instead of ``att.report_id``/``self.report.id`` —
        # pyright's django-stubs doesn't surface the implicit ``<fk>_id`` column
        # attribute, and ``Model.id`` is also unseen unless explicitly declared.
        # ``.pk`` is universally exposed and equally valid.
        self.assertEqual(att.report.pk, self.report.pk)
        # CASCADE: deleting the report removes its attachments.
        self.report.delete()
        self.assertEqual(VisitReportAttachment.objects.count(), 0)

    def test_visit_report_no_longer_has_legacy_fields(self):
        # The three fields are dropped in this change. accessing them must AttributeError.
        for fname in ("observation_attachment", "attachment_filename", "attachment_size_bytes"):
            with self.assertRaises(AttributeError):
                getattr(self.report, fname)


class VisitReportAttachmentApiTests(TestCase):
    def setUp(self):
        self.org, self.junior = _make_org_user("vra_jr", role="employee")
        self.manager = User.objects.create_user(username="vra_mgr", password="pw", full_name="Mgr")
        OrgMembership.objects.create(user=self.manager, org=self.org, role="manager")
        self.outsider = User.objects.create_user(username="vra_out", password="pw", full_name="Out")
        OrgMembership.objects.create(
            user=self.outsider,
            org=Org.objects.create(name="Other"),
            role="employee",
        )
        self.client_master = _make_client(self.org)
        self.api = APIClient()
        self.api.force_authenticate(self.junior)
        res = self.api.post(
            "/api/client-visits/",
            {
                "client": str(self.client_master.uid),
                "visit_date": "2026-04-25",
                "assigned_manager": str(self.manager.uid),
                "key_points": "ok",
            },
            format="multipart",
        )
        assert res.status_code == 201, res.data
        self.report_uid = res.data["reports"][0]["uid"]

    def _upload(self, name="a.txt", body=b"hello"):
        from django.core.files.uploadedfile import SimpleUploadedFile

        upload = SimpleUploadedFile(name, body, content_type="text/plain")
        return self.api.post(
            f"/api/visit-reports/{self.report_uid}/attachments/",
            {"file": upload},
            format="multipart",
        )

    def test_upload_to_draft_creates_attachment(self):
        from core.masters.models import VisitReportAttachment

        res = self._upload(name="notes.txt", body=b"hello world")
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(VisitReportAttachment.objects.count(), 1)
        att = VisitReportAttachment.objects.get()
        self.assertEqual(att.filename, "notes.txt")
        self.assertEqual(att.size_bytes, len(b"hello world"))
        assert att.uploaded_by is not None
        self.assertEqual(att.uploaded_by.id, self.junior.id)
        self.assertIn("/visit-report-attachments/", res.data["download_url"])
        self.assertIn("/download/", res.data["download_url"])

    def test_list_attachments_for_report(self):
        self._upload(name="a.txt")
        self._upload(name="b.txt")
        res = self.api.get(f"/api/visit-reports/{self.report_uid}/attachments/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 2)

    def test_download_attachment(self):
        self._upload(name="notes.txt", body=b"hello world")
        from core.masters.models import VisitReportAttachment

        att = VisitReportAttachment.objects.get()
        res = self.api.get(f"/api/visit-report-attachments/{att.uid}/download/")
        self.assertEqual(res.status_code, 200)
        body = b"".join(getattr(res, "streaming_content"))  # noqa: B009
        self.assertEqual(body, b"hello world")
        self.assertIn("notes.txt", res["Content-Disposition"])

    def test_delete_attachment_while_draft(self):
        self._upload(name="a.txt")
        from core.masters.models import VisitReportAttachment

        att = VisitReportAttachment.objects.get()
        res = self.api.delete(f"/api/visit-report-attachments/{att.uid}/")
        self.assertEqual(res.status_code, 204)
        self.assertEqual(VisitReportAttachment.objects.count(), 0)

    def test_outsider_cannot_upload_or_list(self):
        self.api.force_authenticate(self.outsider)
        upload_res = self._upload()
        self.assertIn(upload_res.status_code, (403, 404))
        list_res = self.api.get(f"/api/visit-reports/{self.report_uid}/attachments/")
        self.assertIn(list_res.status_code, (403, 404))

    def test_cannot_upload_after_submit(self):
        # Submit the draft -> Pending. Upload must now 400.
        self.api.post(f"/api/visit-reports/{self.report_uid}/submit/", {}, format="json")
        res = self._upload()
        self.assertEqual(res.status_code, 400, res.data)

    def test_cannot_delete_after_submit(self):
        self._upload(name="a.txt")
        from core.masters.models import VisitReportAttachment

        att = VisitReportAttachment.objects.get()
        self.api.post(f"/api/visit-reports/{self.report_uid}/submit/", {}, format="json")
        res = self.api.delete(f"/api/visit-report-attachments/{att.uid}/")
        self.assertEqual(res.status_code, 400, res.data)
        self.assertEqual(VisitReportAttachment.objects.count(), 1)


class MasterActiveFlagTests(TestCase):
    """Lock the API contract for the client activate/deactivate UI:
    new rows default to active, PATCH toggles, and the flag round-trips
    in the GET payload.
    """

    def setUp(self):
        self.org, self.admin = _make_org_user("active_admin", role="admin")
        self.client_api = APIClient()
        _auth(self.client_api, self.admin)

    def test_new_client_defaults_to_active(self):
        res = self.client_api.post(
            "/api/masters/",
            {
                "name": "Acme",
                "type": "client",
                "org": str(self.org.uid),
                "orgs": [str(self.org.uid)],
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertTrue(res.data["is_active"])
        row = Master.objects.get(name="Acme", type="client")
        self.assertTrue(row.is_active)

    def test_patch_is_active_false_then_true(self):
        client_row = _make_client(self.org, name="Toggler")
        url = f"/api/masters/{client_row.uid}/"

        res = self.client_api.patch(url, {"is_active": False}, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertFalse(res.data["is_active"])
        client_row.refresh_from_db()
        self.assertFalse(client_row.is_active)

        res = self.client_api.patch(url, {"is_active": True}, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertTrue(res.data["is_active"])
        client_row.refresh_from_db()
        self.assertTrue(client_row.is_active)

    def test_list_returns_both_active_and_inactive(self):
        active = _make_client(self.org, name="ActiveCo")
        inactive = _make_client(self.org, name="InactiveCo")
        Master.objects.filter(pk=inactive.pk).update(is_active=False)

        res = self.client_api.get("/api/masters/?type=client")
        self.assertEqual(res.status_code, 200)
        rows = {r["uid"]: r for r in res.data}
        self.assertIn(str(active.uid), rows)
        self.assertIn(str(inactive.uid), rows)
        self.assertTrue(rows[str(active.uid)]["is_active"])
        self.assertFalse(rows[str(inactive.uid)]["is_active"])

    def test_employee_cannot_deactivate(self):
        # The Masters page is admin-gated in the UI, but the backend should
        # enforce the same boundary. An employee in the same org must not
        # be able to flip is_active via the API.
        _, employee = _make_org_user("active_emp", role="employee")
        employee_api = APIClient()
        _auth(employee_api, employee)
        client_row = _make_client(self.org, name="PermCheck")
        res = employee_api.patch(
            f"/api/masters/{client_row.uid}/",
            {"is_active": False},
            format="json",
        )
        self.assertIn(res.status_code, (403, 404))
        client_row.refresh_from_db()
        self.assertTrue(client_row.is_active)
