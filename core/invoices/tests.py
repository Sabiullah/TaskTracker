import datetime as _dt

from django.test import TestCase
from rest_framework.test import APIClient

from core.invoices.models import InvoiceEntry, InvoicePlan
from core.masters.models import Master
from users.models import Org, OrgMembership, User


def _auth(client: APIClient, user: User) -> None:
    client.force_authenticate(user=user)


def _make_org_admin(username: str) -> tuple[Org, User]:
    org = Org.objects.create(name=f"Org-{username}")
    user = User.objects.create_user(username=username, password="pw", full_name=username.title())
    OrgMembership.objects.create(user=user, org=org, role="admin")
    return org, user


class GeneratePrunesOutOfRangePendingTests(TestCase):
    """When a plan's date range or periodicity changes, calling
    ``/invoice_entries/generate/`` again must prune Pending entries that
    no longer fall inside the new range. Touched entries (Uploaded,
    Approved, Rejected) must survive because they represent real work."""

    def setUp(self):
        self.org, self.admin = _make_org_admin("inv_admin")
        self.client_master = Master.objects.create(name="Apparel Kingdom", type="client", org=self.org)
        self.client_master.orgs.add(self.org)
        self.api = APIClient()
        _auth(self.api, self.admin)

        # Plan starts April, ends March next year — twelve months.
        self.plan = InvoicePlan.objects.create(
            org=self.org,
            client=self.client_master,
            job_description="Internal Audit",
            periodicity="Monthly",
            start_month=_dt.date(2026, 4, 1),
            end_month=_dt.date(2027, 3, 1),
            invoice_day=10,
            base_amount=50000,
        )
        # Seed the original twelve entries via the same code path.
        res = self.api.post(
            "/api/invoice_entries/generate/",
            {"plan_uid": str(self.plan.uid)},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(InvoiceEntry.objects.filter(plan=self.plan).count(), 12)

    def test_pending_entries_outside_new_range_are_pruned(self):
        # Shift start to May — April should be pruned.
        self.plan.start_month = _dt.date(2026, 5, 1)
        self.plan.save()
        res = self.api.post(
            "/api/invoice_entries/generate/",
            {"plan_uid": str(self.plan.uid)},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["pruned_out_of_range"], 1)
        months = sorted(InvoiceEntry.objects.filter(plan=self.plan).values_list("invoice_month", flat=True))
        self.assertNotIn(_dt.date(2026, 4, 1), months)
        self.assertEqual(len(months), 11)

    def test_uploaded_or_approved_entries_outside_range_are_kept(self):
        # The April entry has been uploaded — must survive a range change.
        april = InvoiceEntry.objects.get(plan=self.plan, invoice_month=_dt.date(2026, 4, 1))
        april.status = "Uploaded"
        april.invoice_number = "AK-04"
        april.save()

        self.plan.start_month = _dt.date(2026, 5, 1)
        self.plan.save()
        res = self.api.post(
            "/api/invoice_entries/generate/",
            {"plan_uid": str(self.plan.uid)},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["pruned_out_of_range"], 0)
        self.assertTrue(InvoiceEntry.objects.filter(plan=self.plan, invoice_month=_dt.date(2026, 4, 1)).exists())

    def test_periodicity_change_prunes_off_cadence_pending(self):
        # Switch Monthly → Quarterly — only Apr/Jul/Oct/Jan remain.
        self.plan.periodicity = "Quarterly"
        self.plan.save()
        res = self.api.post(
            "/api/invoice_entries/generate/",
            {"plan_uid": str(self.plan.uid)},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["pruned_out_of_range"], 8)
        months = sorted(InvoiceEntry.objects.filter(plan=self.plan).values_list("invoice_month", flat=True))
        self.assertEqual(
            months,
            [
                _dt.date(2026, 4, 1),
                _dt.date(2026, 7, 1),
                _dt.date(2026, 10, 1),
                _dt.date(2027, 1, 1),
            ],
        )

    def test_repeat_generate_is_a_no_op(self):
        res = self.api.post(
            "/api/invoice_entries/generate/",
            {"plan_uid": str(self.plan.uid)},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["created"], 0)
        self.assertEqual(res.data["pruned_out_of_range"], 0)
        self.assertEqual(res.data["skipped_existing"], 12)


class InvoiceCategoryModelTests(TestCase):
    def test_unique_per_org(self):
        from core.invoices.models import InvoiceCategory

        org, _ = _make_org_admin("cat_admin")
        InvoiceCategory.objects.create(org=org, name="Audit")
        with self.assertRaises(Exception):
            InvoiceCategory.objects.create(org=org, name="Audit")

    def test_same_name_allowed_across_orgs(self):
        from core.invoices.models import InvoiceCategory

        org1, _ = _make_org_admin("cat_a1")
        org2, _ = _make_org_admin("cat_a2")
        InvoiceCategory.objects.create(org=org1, name="Audit")
        InvoiceCategory.objects.create(org=org2, name="Audit")  # must not raise


class InvoiceCategoryApiTests(TestCase):
    def setUp(self):
        self.org, self.admin = _make_org_admin("cat_api_admin")
        self.api = APIClient()
        _auth(self.api, self.admin)

    def test_admin_can_create_and_list(self):
        res = self.api.post(
            "/api/invoice_categories/",
            {"name": "Audit", "org": str(self.org.uid)},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)
        list_res = self.api.get("/api/invoice_categories/")
        self.assertEqual(list_res.status_code, 200)
        names = [r["name"] for r in list_res.data]
        self.assertIn("Audit", names)

    def test_other_org_cannot_see(self):
        other_org, other_admin = _make_org_admin("cat_other")
        from core.invoices.models import InvoiceCategory
        InvoiceCategory.objects.create(org=self.org, name="Audit")
        other_api = APIClient()
        _auth(other_api, other_admin)
        res = other_api.get("/api/invoice_categories/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data, [])

    def test_non_admin_cannot_create(self):
        member = User.objects.create_user(username="cat_member", password="pw", full_name="M")
        OrgMembership.objects.create(user=member, org=self.org, role="member")
        member_api = APIClient()
        _auth(member_api, member)
        res = member_api.post(
            "/api/invoice_categories/",
            {"name": "Tax", "org": str(self.org.uid)},
            format="json",
        )
        self.assertEqual(res.status_code, 403)


class ProjectStatusFieldTests(TestCase):
    def test_plan_defaults_to_projected(self):
        org, _ = _make_org_admin("ps_admin")
        client = Master.objects.create(name="X", type="client", org=org)
        plan = InvoicePlan.objects.create(
            org=org,
            client=client,
            job_description="J",
            periodicity="Monthly",
            start_month=_dt.date(2026, 4, 1),
            end_month=_dt.date(2026, 4, 1),
            invoice_day=1,
            base_amount=1000,
        )
        self.assertEqual(plan.project_status, "Projected")

    def test_entry_defaults_to_projected(self):
        org, _ = _make_org_admin("ps_e_admin")
        client = Master.objects.create(name="X", type="client", org=org)
        plan = InvoicePlan.objects.create(
            org=org,
            client=client,
            job_description="J",
            periodicity="Monthly",
            start_month=_dt.date(2026, 4, 1),
            end_month=_dt.date(2026, 4, 1),
            invoice_day=1,
            base_amount=1000,
        )
        entry = InvoiceEntry.objects.create(plan=plan, invoice_month=_dt.date(2026, 4, 1))
        self.assertEqual(entry.project_status, "Projected")


class AttributionThroughTableTests(TestCase):
    def setUp(self):
        from core.invoices.models import InvoiceCategory

        self.org, self.admin = _make_org_admin("attr_admin")
        self.client_master = Master.objects.create(name="X", type="client", org=self.org)
        self.cat = InvoiceCategory.objects.create(org=self.org, name="Audit")
        self.plan = InvoicePlan.objects.create(
            org=self.org,
            client=self.client_master,
            job_description="J",
            periodicity="Monthly",
            start_month=_dt.date(2026, 4, 1),
            end_month=_dt.date(2026, 4, 1),
            invoice_day=1,
            base_amount=1000,
        )
        self.entry = InvoiceEntry.objects.create(plan=self.plan, invoice_month=_dt.date(2026, 4, 1))

    def test_plan_can_link_category_with_pct(self):
        from core.invoices.models import InvoicePlanCategory

        link = InvoicePlanCategory.objects.create(plan=self.plan, category=self.cat, contribution_pct=100)
        self.assertEqual(link.contribution_pct, 100)
        self.assertIn(self.cat, self.plan.default_categories.all())

    def test_plan_can_link_owner_with_pct(self):
        from core.invoices.models import InvoicePlanOwner

        link = InvoicePlanOwner.objects.create(plan=self.plan, user=self.admin, contribution_pct=100)
        self.assertEqual(link.contribution_pct, 100)

    def test_entry_can_link_category_and_owner(self):
        from core.invoices.models import InvoiceEntryCategory, InvoiceEntryOwner

        InvoiceEntryCategory.objects.create(entry=self.entry, category=self.cat, contribution_pct=100)
        InvoiceEntryOwner.objects.create(entry=self.entry, user=self.admin, contribution_pct=100)
        self.assertEqual(self.entry.categories.count(), 1)
        self.assertEqual(self.entry.owners.count(), 1)

    def test_category_protected_from_delete_when_in_use(self):
        from core.invoices.models import InvoiceCategory, InvoicePlanCategory
        from django.db.models.deletion import ProtectedError

        InvoicePlanCategory.objects.create(plan=self.plan, category=self.cat, contribution_pct=100)
        with self.assertRaises(ProtectedError):
            self.cat.delete()


class PlanSerializerAttributionTests(TestCase):
    def setUp(self):
        from core.invoices.models import InvoiceCategory

        self.org, self.admin = _make_org_admin("plan_attr_admin")
        self.client_master = Master.objects.create(name="X", type="client", org=self.org)
        self.client_master.orgs.add(self.org)
        self.cat_a = InvoiceCategory.objects.create(org=self.org, name="Audit")
        self.cat_b = InvoiceCategory.objects.create(org=self.org, name="Tax")
        self.api = APIClient()
        _auth(self.api, self.admin)

    def _create_payload(self, default_categories=None, default_owners=None, project_status="Projected"):
        return {
            "client": str(self.client_master.uid),
            "job_description": "J",
            "periodicity": "Monthly",
            "start_month": "2026-04-01",
            "end_month": "2026-04-01",
            "invoice_day": 1,
            "base_amount": "1000.00",
            "org": str(self.org.uid),
            "project_status": project_status,
            "default_categories": default_categories or [],
            "default_owners": default_owners or [],
        }

    def test_create_with_valid_attribution(self):
        body = self._create_payload(
            default_categories=[
                {"category_uid": str(self.cat_a.uid), "contribution_pct": "60.00"},
                {"category_uid": str(self.cat_b.uid), "contribution_pct": "40.00"},
            ],
            default_owners=[
                {"user_uid": str(self.admin.uid), "contribution_pct": "100.00"},
            ],
            project_status="Confirmed",
        )
        res = self.api.post("/api/invoice_plans/", body, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(len(res.data["default_categories"]), 2)
        self.assertEqual(res.data["project_status"], "Confirmed")

    def test_reject_pct_sum_not_100(self):
        body = self._create_payload(
            default_categories=[
                {"category_uid": str(self.cat_a.uid), "contribution_pct": "60.00"},
                {"category_uid": str(self.cat_b.uid), "contribution_pct": "30.00"},
            ],
        )
        res = self.api.post("/api/invoice_plans/", body, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("default_categories", res.data)

    def test_reject_duplicate_category(self):
        body = self._create_payload(
            default_categories=[
                {"category_uid": str(self.cat_a.uid), "contribution_pct": "50.00"},
                {"category_uid": str(self.cat_a.uid), "contribution_pct": "50.00"},
            ],
        )
        res = self.api.post("/api/invoice_plans/", body, format="json")
        self.assertEqual(res.status_code, 400)

    def test_empty_attribution_allowed(self):
        body = self._create_payload(default_categories=[], default_owners=[])
        res = self.api.post("/api/invoice_plans/", body, format="json")
        self.assertEqual(res.status_code, 201, res.data)
