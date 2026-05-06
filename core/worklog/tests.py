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
