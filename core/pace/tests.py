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
