from datetime import date

from django.db import IntegrityError
from django.test import TestCase
from rest_framework.test import APITestCase

from core.pace.models import OperationalStandup, OperationalStandupApproval
from users.models import Org, OrgMembership, User


class OperationalStandupApprovalModelTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")
        self.user = User.objects.create_user(email="alice@x.com", full_name="Alice")
        OrgMembership.objects.create(user=self.user, org=self.org, role="employee")
        self.standup = OperationalStandup.objects.create(
            profile=self.user,
            standup_date=date(2026, 5, 4),
        )

    def test_default_status_is_pending(self):
        ap = OperationalStandupApproval.objects.create(standup=self.standup, org=self.org)
        self.assertEqual(ap.status, "Pending")
        self.assertIsNone(ap.approved_by)
        self.assertIsNone(ap.reviewed_at)

    def test_unique_per_standup_org(self):
        OperationalStandupApproval.objects.create(standup=self.standup, org=self.org)
        with self.assertRaises(IntegrityError):
            OperationalStandupApproval.objects.create(standup=self.standup, org=self.org)


class EnsureApprovalsHelperTests(TestCase):
    def setUp(self):
        self.org_4d = Org.objects.create(name="4D")
        self.org_ybv = Org.objects.create(name="YBV")
        self.alice = User.objects.create_user(email="a@x.com", full_name="Alice")
        self.bob = User.objects.create_user(email="b@x.com", full_name="Bob")
        OrgMembership.objects.create(user=self.alice, org=self.org_4d, role="employee")
        OrgMembership.objects.create(user=self.alice, org=self.org_ybv, role="employee")
        OrgMembership.objects.create(user=self.bob, org=self.org_4d, role="manager")
        OrgMembership.objects.create(user=self.bob, org=self.org_ybv, role="manager")
        self.standup = OperationalStandup.objects.create(
            profile=self.alice,
            standup_date=date(2026, 5, 4),
        )

    def test_creates_one_approval_per_profile_org(self):
        from core.pace.services.standup import ensure_approvals_for_standup

        ensure_approvals_for_standup(self.standup)
        statuses = dict(self.standup.approvals.values_list("org__name", "status"))
        self.assertEqual(statuses, {"4D": "Pending", "YBV": "Pending"})

    def test_excludes_opted_out_memberships(self):
        from core.pace.services.standup import ensure_approvals_for_standup

        OrgMembership.objects.filter(user=self.alice, org=self.org_ybv).update(
            exclude_from_operational_standup=True
        )
        ensure_approvals_for_standup(self.standup)
        org_names = set(self.standup.approvals.values_list("org__name", flat=True))
        self.assertEqual(org_names, {"4D"})

    def test_manager_creator_auto_approves_their_orgs(self):
        from core.pace.services.standup import ensure_approvals_for_standup

        ensure_approvals_for_standup(self.standup, creator=self.bob)
        approvals = {a.org.name: a for a in self.standup.approvals.all()}
        self.assertEqual(approvals["4D"].status, "Approved")
        self.assertEqual(approvals["4D"].approved_by, self.bob)
        self.assertEqual(approvals["YBV"].status, "Approved")

    def test_employee_creator_leaves_all_pending(self):
        from core.pace.services.standup import ensure_approvals_for_standup

        ensure_approvals_for_standup(self.standup, creator=self.alice)
        statuses = set(self.standup.approvals.values_list("status", flat=True))
        self.assertEqual(statuses, {"Pending"})

    def test_idempotent_does_not_duplicate(self):
        from core.pace.services.standup import ensure_approvals_for_standup

        ensure_approvals_for_standup(self.standup)
        ensure_approvals_for_standup(self.standup)
        self.assertEqual(self.standup.approvals.count(), 2)


class OperationalStandupModelTests(TestCase):
    def setUp(self):
        self.alice = User.objects.create_user(email="alice@x.com", full_name="Alice")

    def test_unique_per_profile_date(self):
        OperationalStandup.objects.create(
            profile=self.alice, standup_date=date(2026, 5, 4)
        )
        with self.assertRaises(IntegrityError):
            OperationalStandup.objects.create(
                profile=self.alice, standup_date=date(2026, 5, 4)
            )


class OperationalStandupListEmptyTests(APITestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")
        self.user = User.objects.create_user(email="bob@x.com", full_name="Bob")
        OrgMembership.objects.create(user=self.user, org=self.org, role="employee")
        self.client.force_authenticate(self.user)

    def test_list_returns_200_with_empty_array(self):
        resp = self.client.get("/api/operational_standups/")
        self.assertEqual(resp.status_code, 200)
        # DRF default pagination may wrap; this codebase doesn't use it.
        self.assertEqual(resp.json(), [])


class OperationalStandupVisibilityTests(APITestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")
        self.org2 = Org.objects.create(name="YBV")
        self.alice = User.objects.create_user(email="a@x.com", full_name="Alice")
        self.bob = User.objects.create_user(email="b@x.com", full_name="Bob")
        self.cathy = User.objects.create_user(email="c@x.com", full_name="Cathy")
        OrgMembership.objects.create(user=self.alice, org=self.org, role="employee")
        OrgMembership.objects.create(user=self.bob, org=self.org, role="manager")
        OrgMembership.objects.create(user=self.cathy, org=self.org, role="admin")
        # Alice also in org2 as employee — orgs don't bleed across.
        OrgMembership.objects.create(user=self.alice, org=self.org2, role="employee")

        from datetime import date

        d = date(2026, 5, 4)
        self.alice_row = OperationalStandup.objects.create(
            profile=self.alice, standup_date=d, priorities="A1",
        )
        self.bob_row = OperationalStandup.objects.create(
            profile=self.bob, standup_date=d, priorities="B1",
        )

    def test_filter_by_month(self):
        self.client.force_authenticate(self.cathy)
        resp = self.client.get("/api/operational_standups/?month=2026-05")
        self.assertEqual(len(resp.json()), 2)
        resp = self.client.get("/api/operational_standups/?month=2026-04")
        self.assertEqual(resp.json(), [])

    def test_filter_by_date(self):
        self.client.force_authenticate(self.cathy)
        resp = self.client.get("/api/operational_standups/?date=2026-05-04")
        self.assertEqual(len(resp.json()), 2)


class OperationalStandupCreateTests(APITestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")
        self.alice = User.objects.create_user(email="a@x.com", full_name="Alice")
        self.bob = User.objects.create_user(email="b@x.com", full_name="Bob")
        self.cathy = User.objects.create_user(email="c@x.com", full_name="Cathy")
        OrgMembership.objects.create(user=self.alice, org=self.org, role="employee")
        OrgMembership.objects.create(user=self.bob, org=self.org, role="manager")
        OrgMembership.objects.create(user=self.cathy, org=self.org, role="admin")

    def _payload(self, profile_uid):
        return {
            "profile": str(profile_uid),
            "standup_date": "2026-05-04",
            "breakthrough_type": "Breakthrough",
            "priorities": "Ship the thing",
            "collaboration_need": "",
            "remarks": "",
        }

    def test_employee_creating_own_row_starts_all_pending(self):
        self.client.force_authenticate(self.alice)
        resp = self.client.post("/api/operational_standups/", self._payload(self.alice.uid))
        self.assertEqual(resp.status_code, 201, resp.content)
        standup = OperationalStandup.objects.get(uid=resp.json()["uid"])
        statuses = set(standup.approvals.values_list("status", flat=True))
        self.assertEqual(statuses, {"Pending"})

    def test_manager_creating_own_row_auto_approves(self):
        self.client.force_authenticate(self.bob)
        resp = self.client.post("/api/operational_standups/", self._payload(self.bob.uid))
        self.assertEqual(resp.status_code, 201, resp.content)
        standup = OperationalStandup.objects.get(uid=resp.json()["uid"])
        ap = standup.approvals.get(org=self.org)
        self.assertEqual(ap.status, "Approved")
        self.assertEqual(ap.approved_by, self.bob)

    def test_manager_creating_others_row_auto_approves(self):
        self.client.force_authenticate(self.bob)
        resp = self.client.post("/api/operational_standups/", self._payload(self.alice.uid))
        self.assertEqual(resp.status_code, 201, resp.content)
        standup = OperationalStandup.objects.get(uid=resp.json()["uid"])
        ap = standup.approvals.get(org=self.org)
        self.assertEqual(ap.status, "Approved")
        self.assertEqual(ap.approved_by, self.bob)

    def test_admin_creating_others_row_auto_approves(self):
        self.client.force_authenticate(self.cathy)
        resp = self.client.post("/api/operational_standups/", self._payload(self.alice.uid))
        self.assertEqual(resp.status_code, 201, resp.content)
        standup = OperationalStandup.objects.get(uid=resp.json()["uid"])
        self.assertEqual(standup.approvals.get(org=self.org).status, "Approved")

    def test_employee_cannot_create_for_others(self):
        self.client.force_authenticate(self.alice)
        resp = self.client.post("/api/operational_standups/", self._payload(self.bob.uid))
        self.assertEqual(resp.status_code, 403)

    def test_create_blocked_when_target_user_not_in_caller_org(self):
        other_org = Org.objects.create(name="OTHER")
        outsider = User.objects.create_user(email="out@x.com", full_name="Outsider")
        OrgMembership.objects.create(user=outsider, org=other_org, role="employee")
        self.client.force_authenticate(self.bob)  # manager in self.org only
        resp = self.client.post("/api/operational_standups/", self._payload(outsider.uid))
        self.assertEqual(resp.status_code, 403)

    def test_create_uniqueness_returns_400(self):
        self.client.force_authenticate(self.alice)
        self.client.post("/api/operational_standups/", self._payload(self.alice.uid))
        resp = self.client.post("/api/operational_standups/", self._payload(self.alice.uid))
        self.assertEqual(resp.status_code, 400)

    def test_create_fans_out_approvals_per_profile_org(self):
        org_ybv = Org.objects.create(name="YBV")
        OrgMembership.objects.create(user=self.alice, org=org_ybv, role="employee")
        self.client.force_authenticate(self.alice)
        resp = self.client.post(
            "/api/operational_standups/", self._payload(self.alice.uid)
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        standup = OperationalStandup.objects.get(uid=resp.json()["uid"])
        statuses = dict(
            standup.approvals.values_list("org__name", "status")
        )
        self.assertEqual(statuses, {"4D": "Pending", "YBV": "Pending"})


class OperationalStandupUpdateDeleteTests(APITestCase):
    def setUp(self):
        from datetime import date as _d

        self.org = Org.objects.create(name="4D")
        self.alice = User.objects.create_user(email="a@x.com", full_name="Alice")
        self.bob = User.objects.create_user(email="b@x.com", full_name="Bob")
        self.cathy = User.objects.create_user(email="c@x.com", full_name="Cathy")
        OrgMembership.objects.create(user=self.alice, org=self.org, role="employee")
        OrgMembership.objects.create(user=self.bob, org=self.org, role="manager")
        OrgMembership.objects.create(user=self.cathy, org=self.org, role="admin")
        self.row = OperationalStandup.objects.create(
            profile=self.alice,
            standup_date=_d(2026, 5, 4),
            priorities="orig",
        )

    def _patch(self, body):
        return self.client.patch(f"/api/operational_standups/{self.row.uid}/", body, format="json")

    def test_employee_can_edit_own_pending_row(self):
        self.client.force_authenticate(self.alice)
        resp = self._patch({"priorities": "edited"})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.row.refresh_from_db()
        self.assertEqual(self.row.priorities, "edited")

    def test_employee_cannot_edit_others_row(self):
        bob_row = OperationalStandup.objects.create(
            profile=self.bob,
            standup_date=self.row.standup_date,
        )
        self.client.force_authenticate(self.alice)
        resp = self.client.patch(f"/api/operational_standups/{bob_row.uid}/", {"priorities": "x"}, format="json")
        self.assertEqual(resp.status_code, 403)

    def test_only_admin_can_delete(self):
        self.client.force_authenticate(self.bob)
        resp = self.client.delete(f"/api/operational_standups/{self.row.uid}/")
        self.assertEqual(resp.status_code, 403)
        self.client.force_authenticate(self.cathy)
        resp = self.client.delete(f"/api/operational_standups/{self.row.uid}/")
        self.assertEqual(resp.status_code, 204)


class OperationalStandupRosterTests(APITestCase):
    def setUp(self):
        from datetime import date as _d

        self.org = Org.objects.create(name="4D")
        self.alice = User.objects.create_user(email="a@x.com", full_name="Alice")
        self.bob = User.objects.create_user(email="b@x.com", full_name="Bob")
        self.dave = User.objects.create_user(email="d@x.com", full_name="Dave")
        self.cathy = User.objects.create_user(email="c@x.com", full_name="Cathy")
        OrgMembership.objects.create(user=self.alice, org=self.org, role="employee")
        OrgMembership.objects.create(user=self.bob, org=self.org, role="employee")
        OrgMembership.objects.create(user=self.cathy, org=self.org, role="admin", exclude_from_operational_standup=True)
        OrgMembership.objects.create(user=self.dave, org=self.org, role="employee")
        # Submitted standup for Alice only.
        self.alice_row = OperationalStandup.objects.create(
            profile=self.alice,
            standup_date=_d(2026, 5, 4),
            priorities="A1",
        )

    def test_admin_roster_includes_all_active_non_excluded(self):
        self.client.force_authenticate(self.cathy)
        resp = self.client.get("/api/operational_standups/roster/?date=2026-05-04")
        self.assertEqual(resp.status_code, 200)
        rows = resp.json()
        # Cathy is excluded; Alice/Bob/Dave appear.
        names = {r["profile"]["full_name"] for r in rows}
        self.assertEqual(names, {"Alice", "Bob", "Dave"})

    def test_roster_returns_entry_or_null(self):
        self.client.force_authenticate(self.cathy)
        resp = self.client.get("/api/operational_standups/roster/?date=2026-05-04")
        rows = {r["profile"]["full_name"]: r for r in resp.json()}
        self.assertIsNotNone(rows["Alice"]["entry"])
        self.assertEqual(rows["Alice"]["entry"]["priorities"], "A1")
        self.assertIsNone(rows["Bob"]["entry"])

    def test_employee_roster_only_self(self):
        self.client.force_authenticate(self.alice)
        resp = self.client.get("/api/operational_standups/roster/?date=2026-05-04")
        rows = resp.json()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["profile"]["full_name"], "Alice")

    def test_inactive_user_excluded(self):
        self.dave.is_active = False
        self.dave.save()
        self.client.force_authenticate(self.cathy)
        resp = self.client.get("/api/operational_standups/roster/?date=2026-05-04")
        names = {r["profile"]["full_name"] for r in resp.json()}
        self.assertNotIn("Dave", names)

    def test_roster_requires_date(self):
        self.client.force_authenticate(self.cathy)
        resp = self.client.get("/api/operational_standups/roster/")
        self.assertEqual(resp.status_code, 400)


# OperationalStandupApproveTests / OperationalStandupReviewTests / pending_count
# tests removed during the multi-org refactor — replacements live in tasks 8/9
# of docs/superpowers/plans/2026-05-21-multi-org-daily-standup-approval.md.
