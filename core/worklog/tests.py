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
