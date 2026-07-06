from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from core.masters.models import Master
from users.models import Org, OrgMembership, User

from .models import CostingEntry


class CostingEntryModelTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="Org-Costing")
        self.client_master = Master.objects.create(name="Acme", type="client", org=self.org)
        self.designation = Master.objects.create(name="Analyst", type="designation", org=self.org)

    def test_total_is_auto_computed_on_save(self):
        entry = CostingEntry.objects.create(
            org=self.org,
            client=self.client_master,
            designation=self.designation,
            hr_day=Decimal("8"),
            days_working=Decimal("22"),
        )
        self.assertEqual(entry.total, Decimal("176"))

    def test_total_recomputed_on_update(self):
        entry = CostingEntry.objects.create(
            org=self.org,
            client=self.client_master,
            designation=self.designation,
            hr_day=Decimal("8"),
            days_working=Decimal("22"),
        )
        entry.hr_day = Decimal("6")
        entry.save()
        entry.refresh_from_db()
        self.assertEqual(entry.total, Decimal("132"))


class CostingEntryApiTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="Org-Costing-Api")
        self.other_org = Org.objects.create(name="Org-Costing-Other")
        self.client_master = Master.objects.create(name="Acme", type="client", org=self.org)
        self.designation = Master.objects.create(name="Analyst", type="designation", org=self.org)

        self.admin = User.objects.create_user(username="costing-admin", password="pw", full_name="Admin")
        OrgMembership.objects.create(user=self.admin, org=self.org, role="admin")

        self.no_access = User.objects.create_user(username="costing-noaccess", password="pw", full_name="NoAccess")
        OrgMembership.objects.create(user=self.no_access, org=self.org, role="employee")

        self.api = APIClient()

    def test_admin_can_create_and_total_is_computed(self):
        self.api.force_authenticate(user=self.admin)
        res = self.api.post(
            "/api/costing_entries/",
            {
                "org": str(self.org.uid),
                "client": str(self.client_master.uid),
                "designation": str(self.designation.uid),
                "hr_day": "8",
                "days_working": "22",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data["total"], "176.00")

    def test_user_without_costing_access_is_forbidden_on_write(self):
        self.api.force_authenticate(user=self.no_access)
        res = self.api.post(
            "/api/costing_entries/",
            {
                "org": str(self.org.uid),
                "client": str(self.client_master.uid),
                "designation": str(self.designation.uid),
                "hr_day": "8",
                "days_working": "22",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 403)

    def test_entries_scoped_to_caller_org(self):
        entry = CostingEntry.objects.create(
            org=self.org,
            client=self.client_master,
            designation=self.designation,
            hr_day=8,
            days_working=22,
        )
        outsider = User.objects.create_user(username="costing-outsider", password="pw", full_name="Outsider")
        OrgMembership.objects.create(user=outsider, org=self.other_org, role="admin")
        self.api.force_authenticate(user=outsider)
        res = self.api.get("/api/costing_entries/")
        self.assertEqual(res.status_code, 200)
        uids = [row["uid"] for row in res.data]
        self.assertNotIn(str(entry.uid), uids)

    def test_filter_by_client(self):
        self.api.force_authenticate(user=self.admin)
        other_client = Master.objects.create(name="Globex", type="client", org=self.org)
        CostingEntry.objects.create(
            org=self.org,
            client=self.client_master,
            designation=self.designation,
            hr_day=8,
            days_working=22,
        )
        CostingEntry.objects.create(
            org=self.org,
            client=other_client,
            designation=self.designation,
            hr_day=4,
            days_working=10,
        )
        res = self.api.get(f"/api/costing_entries/?client={self.client_master.uid}")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 1)
