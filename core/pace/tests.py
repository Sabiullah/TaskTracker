from datetime import date

from django.db import IntegrityError
from django.test import TestCase
from rest_framework.test import APITestCase

from core.pace.models import OperationalStandup
from users.models import Org, OrgMembership, User


class OperationalStandupModelTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")
        self.user = User.objects.create_user(email="alice@x.com", full_name="Alice")
        OrgMembership.objects.create(user=self.user, org=self.org, role="employee")

    def test_unique_per_org_profile_date(self):
        OperationalStandup.objects.create(
            org=self.org,
            profile=self.user,
            standup_date=date(2026, 5, 4),
        )
        with self.assertRaises(IntegrityError):
            OperationalStandup.objects.create(
                org=self.org,
                profile=self.user,
                standup_date=date(2026, 5, 4),
            )

    def test_default_status_is_pending(self):
        s = OperationalStandup.objects.create(
            org=self.org,
            profile=self.user,
            standup_date=date(2026, 5, 4),
        )
        self.assertEqual(s.status, "Pending")
        self.assertIsNone(s.approved_by)
        self.assertIsNone(s.approved_at)


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
            org=self.org,
            profile=self.alice,
            standup_date=d,
            priorities="A1",
        )
        self.bob_row = OperationalStandup.objects.create(
            org=self.org,
            profile=self.bob,
            standup_date=d,
            priorities="B1",
        )
        self.alice_org2_row = OperationalStandup.objects.create(
            org=self.org2,
            profile=self.alice,
            standup_date=d,
            priorities="A2",
        )

    def test_employee_sees_only_own_rows(self):
        self.client.force_authenticate(self.alice)
        resp = self.client.get("/api/operational_standups/")
        ids = {r["id"] for r in resp.json()}
        self.assertEqual(ids, {self.alice_row.id, self.alice_org2_row.id})

    def test_manager_sees_all_rows_in_their_org(self):
        self.client.force_authenticate(self.bob)
        resp = self.client.get("/api/operational_standups/")
        ids = {r["id"] for r in resp.json()}
        self.assertEqual(ids, {self.alice_row.id, self.bob_row.id})

    def test_admin_sees_all_rows_in_their_org(self):
        self.client.force_authenticate(self.cathy)
        resp = self.client.get("/api/operational_standups/")
        ids = {r["id"] for r in resp.json()}
        self.assertEqual(ids, {self.alice_row.id, self.bob_row.id})

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

    def test_employee_creating_own_row_is_pending(self):
        self.client.force_authenticate(self.alice)
        resp = self.client.post("/api/operational_standups/", self._payload(self.alice.uid))
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.json()["status"], "Pending")

    def test_manager_creating_own_row_is_approved(self):
        self.client.force_authenticate(self.bob)
        resp = self.client.post("/api/operational_standups/", self._payload(self.bob.uid))
        self.assertEqual(resp.status_code, 201, resp.content)
        body = resp.json()
        self.assertEqual(body["status"], "Approved")
        self.assertIsNotNone(body["approved_at"])
        self.assertEqual(body["approved_by_detail"]["uid"], str(self.bob.uid))

    def test_manager_creating_others_row_is_approved(self):
        self.client.force_authenticate(self.bob)
        resp = self.client.post("/api/operational_standups/", self._payload(self.alice.uid))
        self.assertEqual(resp.status_code, 201, resp.content)
        body = resp.json()
        self.assertEqual(body["status"], "Approved")
        self.assertEqual(body["approved_by_detail"]["uid"], str(self.bob.uid))

    def test_admin_creating_others_row_is_approved(self):
        self.client.force_authenticate(self.cathy)
        resp = self.client.post("/api/operational_standups/", self._payload(self.alice.uid))
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.json()["status"], "Approved")

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
            org=self.org,
            profile=self.alice,
            standup_date=_d(2026, 5, 4),
            priorities="orig",
            status="Pending",
        )

    def _patch(self, body):
        return self.client.patch(f"/api/operational_standups/{self.row.uid}/", body, format="json")

    def test_employee_can_edit_own_pending_row(self):
        self.client.force_authenticate(self.alice)
        resp = self._patch({"priorities": "edited"})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.row.refresh_from_db()
        self.assertEqual(self.row.priorities, "edited")

    def test_employee_cannot_edit_own_approved_row(self):
        from django.utils import timezone

        self.row.status = "Approved"
        self.row.approved_by = self.bob
        self.row.approved_at = timezone.now()
        self.row.save()
        self.client.force_authenticate(self.alice)
        resp = self._patch({"priorities": "edited"})
        self.assertEqual(resp.status_code, 403)

    def test_manager_can_edit_approved_row(self):
        from django.utils import timezone

        self.row.status = "Approved"
        self.row.approved_at = timezone.now()
        self.row.save()
        self.client.force_authenticate(self.bob)
        resp = self._patch({"priorities": "manager-edit"})
        self.assertEqual(resp.status_code, 200, resp.content)

    def test_employee_cannot_edit_others_row(self):
        bob_row = OperationalStandup.objects.create(
            org=self.org,
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
            org=self.org,
            profile=self.alice,
            standup_date=_d(2026, 5, 4),
            priorities="A1",
            status="Pending",
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


class OperationalStandupApproveTests(APITestCase):
    def setUp(self):
        from datetime import date as _d

        self.org = Org.objects.create(name="4D")
        self.alice = User.objects.create_user(email="a@x.com", full_name="Alice")
        self.bob = User.objects.create_user(email="b@x.com", full_name="Bob")
        self.cathy = User.objects.create_user(email="c@x.com", full_name="Cathy")
        OrgMembership.objects.create(user=self.alice, org=self.org, role="employee")
        OrgMembership.objects.create(user=self.bob, org=self.org, role="manager")
        OrgMembership.objects.create(user=self.cathy, org=self.org, role="admin")
        self.row1 = OperationalStandup.objects.create(
            org=self.org,
            profile=self.alice,
            standup_date=_d(2026, 5, 4),
            priorities="A1",
            status="Pending",
        )
        self.row2 = OperationalStandup.objects.create(
            org=self.org,
            profile=self.bob,
            standup_date=_d(2026, 5, 4),
            priorities="B1",
            status="Pending",
        )

    def test_manager_can_approve_single_row(self):
        self.client.force_authenticate(self.bob)
        resp = self.client.post(f"/api/operational_standups/{self.row1.uid}/approve/")
        self.assertEqual(resp.status_code, 200, resp.content)
        self.row1.refresh_from_db()
        self.assertEqual(self.row1.status, "Approved")
        self.assertEqual(self.row1.approved_by, self.bob)
        self.assertIsNotNone(self.row1.approved_at)

    def test_employee_cannot_approve(self):
        self.client.force_authenticate(self.alice)
        resp = self.client.post(f"/api/operational_standups/{self.row1.uid}/approve/")
        self.assertEqual(resp.status_code, 403)

    def test_admin_bulk_approve_for_date(self):
        self.client.force_authenticate(self.cathy)
        resp = self.client.post(
            "/api/operational_standups/bulk_approve/",
            {"date": "2026-05-04", "org": str(self.org.uid)},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.row1.refresh_from_db()
        self.row2.refresh_from_db()
        self.assertEqual(self.row1.status, "Approved")
        self.assertEqual(self.row2.status, "Approved")
        self.assertEqual(self.row1.approved_by, self.cathy)
        self.assertEqual(resp.json()["approved_count"], 2)

    def test_bulk_approve_idempotent(self):
        self.row1.status = "Approved"
        self.row1.approved_by = self.bob
        self.row1.save()
        self.client.force_authenticate(self.cathy)
        resp = self.client.post(
            "/api/operational_standups/bulk_approve/",
            {"date": "2026-05-04", "org": str(self.org.uid)},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.row1.refresh_from_db()
        # row1 was already approved by Bob; bulk_approve must not overwrite it.
        self.assertEqual(self.row1.approved_by, self.bob)
        self.assertEqual(resp.json()["approved_count"], 1)

    def test_manager_cannot_bulk_approve(self):
        self.client.force_authenticate(self.bob)
        resp = self.client.post(
            "/api/operational_standups/bulk_approve/",
            {"date": "2026-05-04", "org": str(self.org.uid)},
            format="json",
        )
        self.assertEqual(resp.status_code, 403)


class OperationalStandupPendingCountTests(APITestCase):
    def setUp(self):
        from datetime import date as _d

        self.org = Org.objects.create(name="4D")
        self.alice = User.objects.create_user(email="a@x.com", full_name="Alice")
        self.bob = User.objects.create_user(email="b@x.com", full_name="Bob")
        self.cathy = User.objects.create_user(email="c@x.com", full_name="Cathy")
        OrgMembership.objects.create(user=self.alice, org=self.org, role="employee")
        OrgMembership.objects.create(user=self.bob, org=self.org, role="manager")
        OrgMembership.objects.create(user=self.cathy, org=self.org, role="admin")
        OperationalStandup.objects.create(
            org=self.org,
            profile=self.alice,
            standup_date=_d(2026, 5, 4),
            status="Pending",
        )
        OperationalStandup.objects.create(
            org=self.org,
            profile=self.bob,
            standup_date=_d(2026, 5, 4),
            status="Pending",
        )
        OperationalStandup.objects.create(
            org=self.org,
            profile=self.bob,
            standup_date=_d(2026, 5, 3),
            status="Approved",
        )

    def test_admin_pending_count_is_org_wide(self):
        self.client.force_authenticate(self.cathy)
        resp = self.client.get("/api/operational_standups/pending_count/")
        self.assertEqual(resp.json(), {"count": 2})

    def test_manager_pending_count_is_org_wide(self):
        self.client.force_authenticate(self.bob)
        resp = self.client.get("/api/operational_standups/pending_count/")
        self.assertEqual(resp.json(), {"count": 2})

    def test_employee_pending_count_is_self_only(self):
        self.client.force_authenticate(self.alice)
        resp = self.client.get("/api/operational_standups/pending_count/")
        self.assertEqual(resp.json(), {"count": 1})
