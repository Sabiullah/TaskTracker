from datetime import date

from django.contrib.auth import get_user_model
from django.db import IntegrityError
from django.test import TestCase
from rest_framework.test import APITestCase

from core.pace.models import OperationalStandup
from users.models import Org, OrgMembership

User = get_user_model()


class OperationalStandupModelTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="4D")
        self.user = User.objects.create_user(email="alice@x.com", full_name="Alice")
        OrgMembership.objects.create(user=self.user, org=self.org, role="employee")

    def test_unique_per_org_profile_date(self):
        OperationalStandup.objects.create(
            org=self.org, profile=self.user, standup_date=date(2026, 5, 4),
        )
        with self.assertRaises(IntegrityError):
            OperationalStandup.objects.create(
                org=self.org, profile=self.user, standup_date=date(2026, 5, 4),
            )

    def test_default_status_is_pending(self):
        s = OperationalStandup.objects.create(
            org=self.org, profile=self.user, standup_date=date(2026, 5, 4),
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
            org=self.org, profile=self.alice, standup_date=d, priorities="A1",
        )
        self.bob_row = OperationalStandup.objects.create(
            org=self.org, profile=self.bob, standup_date=d, priorities="B1",
        )
        self.alice_org2_row = OperationalStandup.objects.create(
            org=self.org2, profile=self.alice, standup_date=d, priorities="A2",
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
