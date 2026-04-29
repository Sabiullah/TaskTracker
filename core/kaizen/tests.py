from django.test import TestCase
from rest_framework.test import APIClient

from core.kaizen.models import Kaizen
from core.masters.models import Master
from users.models import Org, OrgMembership, User


def _make_org_user(username: str, role: str = "employee") -> tuple[Org, User]:
    org = Org.objects.create(name=f"Org-{username}")
    user = User.objects.create_user(
        username=username, password="pw", full_name=username.title()
    )
    OrgMembership.objects.create(user=user, org=org, role=role)
    return org, user


def _make_client(org: Org, name: str = "Acme") -> Master:
    m = Master.objects.create(name=name, type="client", org=org)
    m.orgs.add(org)
    return m


class KaizenCreateTests(TestCase):
    def setUp(self):
        self.org, self.user = _make_org_user("emp", role="employee")
        self.client_master = _make_client(self.org, "Acme")
        self.api = APIClient()
        self.api.force_authenticate(self.user)

    def test_create_auto_fills_raised_by_and_entry_date(self):
        resp = self.api.post(
            "/api/kaizens/",
            data={
                "client": str(self.client_master.uid),
                "area": "Internal Audit",
                "description": "details missing",
                "takeaway": "inform clients in advance",
            },
            format="json",
        )
        assert resp.status_code == 201, resp.content
        data = resp.json()
        assert data["status"] == "Pending"
        assert data["raised_by_detail"]["uid"] == str(self.user.uid)
        assert data["entry_date"]  # populated by server
        # Persisted in DB
        kz = Kaizen.objects.get(uid=data["uid"])
        assert kz.raised_by_id == self.user.pk
        assert kz.org_id == self.org.pk
        assert kz.status == "Pending"

    def test_create_requires_client(self):
        resp = self.api.post(
            "/api/kaizens/",
            data={
                "area": "Internal Audit",
                "description": "x",
                "takeaway": "y",
            },
            format="json",
        )
        assert resp.status_code == 400
        assert "client" in resp.json()


class KaizenListVisibilityTests(TestCase):
    """Cross-org visibility: a user in org A can see Kaizen entries from org B."""

    def setUp(self):
        self.org_a, self.user_a = _make_org_user("emp_a", role="employee")
        self.org_b, self.user_b = _make_org_user("emp_b", role="employee")
        self.client_a = _make_client(self.org_a, "Client-A")
        self.client_b = _make_client(self.org_b, "Client-B")

        self.kz_a = Kaizen.objects.create(
            org=self.org_a,
            raised_by=self.user_a,
            entry_date="2026-04-29",
            client=self.client_a,
            area="A",
            description="d",
            takeaway="t",
            status="Approved",
        )
        self.kz_b = Kaizen.objects.create(
            org=self.org_b,
            raised_by=self.user_b,
            entry_date="2026-04-29",
            client=self.client_b,
            area="B",
            description="d",
            takeaway="t",
            status="Approved",
        )
        self.kz_rejected = Kaizen.objects.create(
            org=self.org_b,
            raised_by=self.user_b,
            entry_date="2026-04-29",
            client=self.client_b,
            area="X",
            description="d",
            takeaway="t",
            status="Rejected",
            rejection_reason="not useful",
        )

    def test_user_in_org_a_sees_org_b_entries(self):
        api = APIClient()
        api.force_authenticate(self.user_a)
        resp = api.get("/api/kaizens/")
        assert resp.status_code == 200
        uids = {row["uid"] for row in resp.json()}
        assert str(self.kz_a.uid) in uids
        assert str(self.kz_b.uid) in uids
        # Rejected hidden by default
        assert str(self.kz_rejected.uid) not in uids

    def test_non_admin_cannot_include_rejected(self):
        api = APIClient()
        api.force_authenticate(self.user_a)
        resp = api.get("/api/kaizens/?include_rejected=1")
        assert resp.status_code == 200
        uids = {row["uid"] for row in resp.json()}
        assert str(self.kz_rejected.uid) not in uids

    def test_admin_can_include_rejected(self):
        admin = User.objects.create_user(
            username="admin_a", password="pw", full_name="Admin A"
        )
        OrgMembership.objects.create(user=admin, org=self.org_a, role="admin")
        api = APIClient()
        api.force_authenticate(admin)
        resp = api.get("/api/kaizens/?include_rejected=1")
        assert resp.status_code == 200
        uids = {row["uid"] for row in resp.json()}
        assert str(self.kz_rejected.uid) in uids

    def test_non_admin_cannot_query_rejected_via_status_filter(self):
        """Closes the ?status=Rejected bypass: non-admins should not be able
        to read rejected rows by passing the status query param either."""
        api = APIClient()
        api.force_authenticate(self.user_a)
        resp = api.get("/api/kaizens/?status=Rejected")
        assert resp.status_code == 200
        uids = {row["uid"] for row in resp.json()}
        assert str(self.kz_rejected.uid) not in uids


class KaizenEditDeleteGateTests(TestCase):
    def setUp(self):
        self.org, self.user = _make_org_user("emp", role="employee")
        self.org2, self.other_user = _make_org_user("other", role="employee")
        self.client_master = _make_client(self.org, "Acme")
        self.kz = Kaizen.objects.create(
            org=self.org,
            raised_by=self.user,
            entry_date="2026-04-29",
            client=self.client_master,
            area="A",
            description="d",
            takeaway="t",
            status="Pending",
        )

    def test_raiser_can_patch_pending(self):
        api = APIClient()
        api.force_authenticate(self.user)
        resp = api.patch(
            f"/api/kaizens/{self.kz.uid}/",
            data={"area": "Updated"},
            format="json",
        )
        assert resp.status_code == 200, resp.content
        self.kz.refresh_from_db()
        assert self.kz.area == "Updated"

    def test_raiser_cannot_patch_after_approval(self):
        self.kz.status = "Approved"
        self.kz.save(update_fields=["status"])
        api = APIClient()
        api.force_authenticate(self.user)
        resp = api.patch(
            f"/api/kaizens/{self.kz.uid}/",
            data={"area": "X"},
            format="json",
        )
        assert resp.status_code == 403

    def test_non_raiser_non_admin_cannot_patch(self):
        api = APIClient()
        api.force_authenticate(self.other_user)
        resp = api.patch(
            f"/api/kaizens/{self.kz.uid}/",
            data={"area": "X"},
            format="json",
        )
        # Either 403 or 404 is acceptable here; both prevent the write.
        assert resp.status_code in (403, 404)


class KaizenApproveRejectTests(TestCase):
    def setUp(self):
        self.org_admin, self.admin = _make_org_user("admin1", role="admin")
        self.org_emp, self.employee = _make_org_user("emp", role="employee")
        self.client_master = _make_client(self.org_emp, "Acme")
        self.kz = Kaizen.objects.create(
            org=self.org_emp,
            raised_by=self.employee,
            entry_date="2026-04-29",
            client=self.client_master,
            area="A",
            description="d",
            takeaway="t",
            status="Pending",
        )

    def test_admin_can_approve(self):
        api = APIClient()
        api.force_authenticate(self.admin)
        resp = api.post(f"/api/kaizens/{self.kz.uid}/approve/", format="json")
        assert resp.status_code == 200, resp.content
        self.kz.refresh_from_db()
        assert self.kz.status == "Approved"
        assert self.kz.reviewed_by_id == self.admin.pk
        assert self.kz.reviewed_at is not None

    def test_non_admin_cannot_approve(self):
        api = APIClient()
        api.force_authenticate(self.employee)
        resp = api.post(f"/api/kaizens/{self.kz.uid}/approve/", format="json")
        assert resp.status_code == 403

    def test_reject_requires_reason(self):
        api = APIClient()
        api.force_authenticate(self.admin)
        resp = api.post(
            f"/api/kaizens/{self.kz.uid}/reject/",
            data={},
            format="json",
        )
        assert resp.status_code == 400
        body = resp.json()
        assert "reason" in body
        # DRF list-shape: {"reason": ["Rejection reason is required"]}
        assert body["reason"] == ["Rejection reason is required"]

    def test_reject_with_reason_persists_and_hides_row(self):
        api = APIClient()
        api.force_authenticate(self.admin)
        resp = api.post(
            f"/api/kaizens/{self.kz.uid}/reject/",
            data={"reason": "duplicate of existing entry"},
            format="json",
        )
        assert resp.status_code == 200, resp.content
        self.kz.refresh_from_db()
        assert self.kz.status == "Rejected"
        assert self.kz.rejection_reason == "duplicate of existing entry"

        # Default list excludes rejected even for admins...
        resp = api.get("/api/kaizens/")
        assert str(self.kz.uid) not in {row["uid"] for row in resp.json()}
        # ...unless they ask for it.
        resp = api.get("/api/kaizens/?include_rejected=1")
        assert str(self.kz.uid) in {row["uid"] for row in resp.json()}

    def test_cannot_approve_already_approved(self):
        self.kz.status = "Approved"
        self.kz.save(update_fields=["status"])
        api = APIClient()
        api.force_authenticate(self.admin)
        resp = api.post(f"/api/kaizens/{self.kz.uid}/approve/", format="json")
        assert resp.status_code == 400

    def test_cannot_reject_already_rejected(self):
        self.kz.status = "Rejected"
        self.kz.save(update_fields=["status"])
        api = APIClient()
        api.force_authenticate(self.admin)
        resp = api.post(
            f"/api/kaizens/{self.kz.uid}/reject/",
            data={"reason": "x"},
            format="json",
        )
        assert resp.status_code == 400
