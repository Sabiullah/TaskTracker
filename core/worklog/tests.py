import uuid

from django.test import TestCase
from rest_framework.test import APIClient

from core.worklog.models import WorkPlan
from users.models import Org, OrgMembership, User


def _auth(client: APIClient, user: User) -> None:
    client.force_authenticate(user=user)


class WorkPlanCreateMultiOrgTests(TestCase):
    """Regression: a user in 2+ orgs could not create a work plan from the
    Work Log → Add Plan modal because the frontend did not send an ``org`` and
    ``resolve_create_org`` returned 400 ("`org` is required"). The modal now
    falls back to the header-selected org or the assignee's own org. These
    tests pin both the working and pre-fix paths so the contract is explicit.
    """

    def setUp(self):
        self.org_a = Org.objects.create(name="Org-A")
        self.org_b = Org.objects.create(name="Org-B")
        self.admin = User.objects.create_user(username="multi", password="pw", full_name="Multi Org")
        OrgMembership.objects.create(user=self.admin, org=self.org_a, role="admin")
        OrgMembership.objects.create(user=self.admin, org=self.org_b, role="admin")

        self.assignee = User.objects.create_user(username="emp", password="pw", full_name="Mohamed Ameen")
        OrgMembership.objects.create(user=self.assignee, org=self.org_b, role="employee")

        self.client_api = APIClient()
        _auth(self.client_api, self.admin)

    def _payload(self, **overrides):
        body = {
            "assigned_to": str(self.assignee.uid),
            "date": "2026-05-02",
            "task_description": "ICAI Seminar",
            "planned_hours": "8.00",
        }
        body.update(overrides)
        return body

    def test_create_with_org_succeeds(self):
        res = self.client_api.post(
            "/api/work_plans/",
            self._payload(org=str(self.org_b.uid)),
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)
        row = WorkPlan.objects.get()
        assert row.org is not None
        self.assertEqual(row.org.id, self.org_b.id)
        assert row.assigned_to is not None
        self.assertEqual(row.assigned_to.id, self.assignee.id)

    def test_create_without_org_400s_when_caller_has_multiple_orgs(self):
        # Pre-fix the frontend hit this path; keeping it as an explicit guard
        # so anyone touching ``resolve_create_org`` sees the contract.
        res = self.client_api.post(
            "/api/work_plans/",
            self._payload(),
            format="json",
        )
        self.assertEqual(res.status_code, 400, res.data)
        self.assertEqual(WorkPlan.objects.count(), 0)


class WorkPlanSeriesFieldsTests(TestCase):
    """Pin the read/write contract of series_uid / recurrence / recurrence_end_date.
    POST accepts them; PATCH must ignore them so the series tag can't be
    silently reassigned via the standard update path.
    """

    def setUp(self):
        self.org = Org.objects.create(name="Org-1")
        self.admin = User.objects.create_user(username="adm", password="pw", full_name="Admin")
        OrgMembership.objects.create(user=self.admin, org=self.org, role="admin")
        self.assignee = User.objects.create_user(username="emp1", password="pw", full_name="Emp")
        OrgMembership.objects.create(user=self.assignee, org=self.org, role="employee")
        self.client_api = APIClient()
        _auth(self.client_api, self.admin)

    def _post(self, **overrides):
        body = {
            "assigned_to": str(self.assignee.uid),
            "date": "2026-05-14",
            "task_description": "Audit",
            "planned_hours": "4.00",
            "org": str(self.org.uid),
        }
        body.update(overrides)
        return self.client_api.post("/api/work_plans/", body, format="json")

    def test_post_accepts_and_stores_series_fields(self):
        sid = str(uuid.uuid4())
        res = self._post(
            series_uid=sid,
            recurrence="weekly",
            recurrence_end_date="2026-07-31",
        )
        self.assertEqual(res.status_code, 201, res.data)
        row = WorkPlan.objects.get()
        self.assertEqual(str(row.series_uid), sid)
        self.assertEqual(row.recurrence, "weekly")
        self.assertEqual(str(row.recurrence_end_date), "2026-07-31")

    def test_post_default_blanks_for_one_time(self):
        res = self._post()
        self.assertEqual(res.status_code, 201, res.data)
        row = WorkPlan.objects.get()
        self.assertIsNone(row.series_uid)
        self.assertEqual(row.recurrence, "")
        self.assertIsNone(row.recurrence_end_date)

    def test_patch_ignores_series_fields(self):
        sid = str(uuid.uuid4())
        res = self._post(series_uid=sid, recurrence="weekly", recurrence_end_date="2026-07-31")
        uid = res.data["uid"]
        new_sid = str(uuid.uuid4())
        res2 = self.client_api.patch(
            f"/api/work_plans/{uid}/",
            {
                "series_uid": new_sid,
                "recurrence": "monthly",
                "recurrence_end_date": "2027-01-01",
                "task_description": "Field Audit",
            },
            format="json",
        )
        self.assertEqual(res2.status_code, 200, res2.data)
        row = WorkPlan.objects.get()
        # PATCH-able field changed
        self.assertEqual(row.task_description, "Field Audit")
        # Series fields are immutable on PATCH
        self.assertEqual(str(row.series_uid), sid)
        self.assertEqual(row.recurrence, "weekly")
        self.assertEqual(str(row.recurrence_end_date), "2026-07-31")


class WorkPlanApplyToFollowingTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="Org-1")
        self.admin = User.objects.create_user(username="adm", password="pw", full_name="Admin")
        OrgMembership.objects.create(user=self.admin, org=self.org, role="admin")
        self.assignee = User.objects.create_user(username="emp1", password="pw", full_name="Emp")
        OrgMembership.objects.create(user=self.assignee, org=self.org, role="employee")
        self.client_api = APIClient()
        _auth(self.client_api, self.admin)

        # Build a 4-row weekly series + 1 sibling-series row + 1 one-time row
        self.sid_a = uuid.uuid4()
        self.sid_b = uuid.uuid4()
        dates_a = ["2026-05-07", "2026-05-14", "2026-05-21", "2026-05-28"]
        for d in dates_a:
            WorkPlan.objects.create(
                org=self.org,
                assigned_to=self.assignee,
                date=d,
                task_description="Audit",
                planned_hours="4.00",
                series_uid=self.sid_a,
                recurrence="weekly",
                recurrence_end_date="2026-05-28",
            )
        # A different series; must never be touched
        WorkPlan.objects.create(
            org=self.org,
            assigned_to=self.assignee,
            date="2026-05-14",
            task_description="Other series",
            planned_hours="2.00",
            series_uid=self.sid_b,
            recurrence="weekly",
            recurrence_end_date="2026-06-04",
        )
        # A one-time row on the same date — also must never be touched
        WorkPlan.objects.create(
            org=self.org,
            assigned_to=self.assignee,
            date="2026-05-14",
            task_description="One-off",
            planned_hours="1.00",
        )

    def _middle_row(self):
        return WorkPlan.objects.get(series_uid=self.sid_a, date="2026-05-14")

    def _url(self, row):
        return f"/api/work_plans/{row.uid}/apply_to_following/"

    def test_updates_this_and_later_rows_only(self):
        row = self._middle_row()
        res = self.client_api.post(
            self._url(row),
            {"task_description": "Field Audit", "planned_hours": "6.00"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["updated_count"], 3)

        affected = WorkPlan.objects.filter(
            series_uid=self.sid_a, date__gte="2026-05-14"
        ).order_by("date")
        for r in affected:
            self.assertEqual(r.task_description, "Field Audit")
            self.assertEqual(str(r.planned_hours), "6.00")

        # Earlier row in same series is untouched
        earlier = WorkPlan.objects.get(series_uid=self.sid_a, date="2026-05-07")
        self.assertEqual(earlier.task_description, "Audit")
        self.assertEqual(str(earlier.planned_hours), "4.00")

        # Sibling series untouched
        other = WorkPlan.objects.get(series_uid=self.sid_b)
        self.assertEqual(other.task_description, "Other series")

        # One-time row untouched
        oneoff = WorkPlan.objects.get(series_uid__isnull=True)
        self.assertEqual(oneoff.task_description, "One-off")

    def test_date_shift_applies_delta_to_later_rows(self):
        row = self._middle_row()
        # Shift this row from Thu 2026-05-14 to Fri 2026-05-15: +1 day delta.
        res = self.client_api.post(
            self._url(row),
            {"date": "2026-05-15"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["updated_count"], 3)

        # The row we edited
        self.assertEqual(
            str(WorkPlan.objects.get(pk=row.pk).date), "2026-05-15"
        )
        # The later rows shifted by the same +1 day
        self.assertTrue(
            WorkPlan.objects.filter(series_uid=self.sid_a, date="2026-05-22").exists()
        )
        self.assertTrue(
            WorkPlan.objects.filter(series_uid=self.sid_a, date="2026-05-29").exists()
        )
        # Earlier row is unchanged
        self.assertTrue(
            WorkPlan.objects.filter(series_uid=self.sid_a, date="2026-05-07").exists()
        )

    def test_400_when_source_has_no_series_uid(self):
        oneoff = WorkPlan.objects.get(series_uid__isnull=True)
        res = self.client_api.post(
            self._url(oneoff),
            {"task_description": "X"},
            format="json",
        )
        self.assertEqual(res.status_code, 400, res.data)

    def test_400_when_payload_empty(self):
        row = self._middle_row()
        res = self.client_api.post(self._url(row), {}, format="json")
        self.assertEqual(res.status_code, 400, res.data)

    def test_403_when_caller_lacks_visibility(self):
        # A user in a different org cannot apply to a series they can't see.
        other_org = Org.objects.create(name="Org-2")
        other_user = User.objects.create_user(username="other", password="pw", full_name="Other")
        OrgMembership.objects.create(user=other_user, org=other_org, role="admin")
        cli = APIClient()
        _auth(cli, other_user)
        row = self._middle_row()
        res = cli.post(
            self._url(row),
            {"task_description": "Hack"},
            format="json",
        )
        # Visibility filters this out → 404 (DRF default for "no match in queryset").
        self.assertIn(res.status_code, (403, 404), res.data)

    def test_400_when_planned_hours_out_of_range(self):
        row = self._middle_row()
        res = self.client_api.post(
            self._url(row),
            {"planned_hours": "99.00"},
            format="json",
        )
        self.assertEqual(res.status_code, 400, res.data)
        # Source unchanged
        self.assertEqual(str(WorkPlan.objects.get(pk=row.pk).planned_hours), "4.00")

    def test_400_when_planned_hours_negative(self):
        row = self._middle_row()
        res = self.client_api.post(
            self._url(row),
            {"planned_hours": "-1.00"},
            format="json",
        )
        self.assertEqual(res.status_code, 400, res.data)

    def test_400_when_task_description_whitespace_only(self):
        row = self._middle_row()
        res = self.client_api.post(
            self._url(row),
            {"task_description": "   "},
            format="json",
        )
        self.assertEqual(res.status_code, 400, res.data)
