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
        from django.db import IntegrityError, transaction

        from core.invoices.models import InvoiceCategory

        org, _ = _make_org_admin("cat_admin")
        InvoiceCategory.objects.create(org=org, name="Audit")
        with self.assertRaises(IntegrityError), transaction.atomic():
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

    def test_plan_category_can_carry_owners(self):
        from core.invoices.models import InvoicePlanCategory, InvoicePlanCategoryOwner

        cat_link = InvoicePlanCategory.objects.create(plan=self.plan, category=self.cat, contribution_pct=100)
        owner_link = InvoicePlanCategoryOwner.objects.create(
            plan_category=cat_link, user=self.admin, contribution_pct=100
        )
        self.assertEqual(owner_link.contribution_pct, 100)
        self.assertEqual(cat_link.owner_links.count(), 1)

    def test_entry_can_link_category_and_owner(self):
        from core.invoices.models import InvoiceEntryCategory, InvoiceEntryCategoryOwner

        cat_link = InvoiceEntryCategory.objects.create(
            entry=self.entry, category=self.cat, contribution_pct=100
        )
        InvoiceEntryCategoryOwner.objects.create(entry_category=cat_link, user=self.admin, contribution_pct=100)
        self.assertEqual(self.entry.categories.count(), 1)
        self.assertEqual(cat_link.owner_links.count(), 1)

    def test_category_protected_from_delete_when_in_use(self):
        from django.db.models.deletion import ProtectedError

        from core.invoices.models import InvoicePlanCategory

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

    def _create_payload(self, default_categories=None, project_status="Projected"):
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
        }

    def test_create_with_valid_attribution(self):
        body = self._create_payload(
            default_categories=[
                {
                    "category_uid": str(self.cat_a.uid),
                    "contribution_pct": "60.00",
                    "owners": [{"user_uid": str(self.admin.uid), "contribution_pct": "100.00"}],
                },
                {
                    "category_uid": str(self.cat_b.uid),
                    "contribution_pct": "40.00",
                    "owners": [],
                },
            ],
            project_status="Confirmed",
        )
        res = self.api.post("/api/invoice_plans/", body, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        cats = res.data["default_categories"]
        self.assertEqual(len(cats), 2)
        # Category A came back with one owner; B came back empty.
        a_row = next(c for c in cats if c["category_uid"] == str(self.cat_a.uid))
        b_row = next(c for c in cats if c["category_uid"] == str(self.cat_b.uid))
        self.assertEqual(len(a_row["owners"]), 1)
        self.assertEqual(a_row["owners"][0]["user_uid"], str(self.admin.uid))
        self.assertEqual(b_row["owners"], [])
        self.assertEqual(res.data["project_status"], "Confirmed")

    def test_owners_within_category_must_sum_to_100(self):
        body = self._create_payload(
            default_categories=[
                {
                    "category_uid": str(self.cat_a.uid),
                    "contribution_pct": "100.00",
                    "owners": [{"user_uid": str(self.admin.uid), "contribution_pct": "30.00"}],
                },
            ],
        )
        res = self.api.post("/api/invoice_plans/", body, format="json")
        self.assertEqual(res.status_code, 400)

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
        body = self._create_payload(default_categories=[])
        res = self.api.post("/api/invoice_plans/", body, format="json")
        self.assertEqual(res.status_code, 201, res.data)


class EntrySerializerAttributionTests(TestCase):
    def setUp(self):
        from core.invoices.models import InvoiceCategory

        self.org, self.admin = _make_org_admin("entry_attr_admin")
        self.client_master = Master.objects.create(name="X", type="client", org=self.org)
        self.client_master.orgs.add(self.org)
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
        self.api = APIClient()
        _auth(self.api, self.admin)

    def test_patch_entry_attribution(self):
        body = {
            "project_status": "Confirmed",
            "categories": [
                {
                    "category_uid": str(self.cat.uid),
                    "contribution_pct": "100.00",
                    "owners": [{"user_uid": str(self.admin.uid), "contribution_pct": "100.00"}],
                },
            ],
        }
        res = self.api.patch(f"/api/invoice_entries/{self.entry.uid}/", body, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["project_status"], "Confirmed")
        self.assertEqual(len(res.data["categories"]), 1)
        self.assertEqual(len(res.data["categories"][0]["owners"]), 1)

    def test_filter_by_project_status(self):
        e2 = InvoiceEntry.objects.create(plan=self.plan, invoice_month=_dt.date(2026, 5, 1))
        e2.project_status = "Confirmed"
        e2.save()
        res = self.api.get("/api/invoice_entries/?project_status=Confirmed")
        self.assertEqual(res.status_code, 200)
        uids = [r["uid"] for r in res.data]
        self.assertIn(str(e2.uid), uids)
        self.assertNotIn(str(self.entry.uid), uids)


class GenerateCopiesDefaultsTests(TestCase):
    def setUp(self):
        from core.invoices.models import (
            InvoiceCategory,
            InvoicePlanCategory,
            InvoicePlanCategoryOwner,
        )

        self.org, self.admin = _make_org_admin("gen_def_admin")
        self.client_master = Master.objects.create(name="X", type="client", org=self.org)
        self.client_master.orgs.add(self.org)
        self.cat = InvoiceCategory.objects.create(org=self.org, name="Audit")
        self.plan = InvoicePlan.objects.create(
            org=self.org,
            client=self.client_master,
            job_description="J",
            periodicity="Monthly",
            start_month=_dt.date(2026, 4, 1),
            end_month=_dt.date(2026, 6, 1),
            invoice_day=1,
            base_amount=1000,
            project_status="Confirmed",
        )
        cat_link = InvoicePlanCategory.objects.create(plan=self.plan, category=self.cat, contribution_pct=100)
        InvoicePlanCategoryOwner.objects.create(plan_category=cat_link, user=self.admin, contribution_pct=100)
        self.api = APIClient()
        _auth(self.api, self.admin)

    def test_generated_entries_inherit_defaults(self):
        res = self.api.post(
            "/api/invoice_entries/generate/",
            {"plan_uid": str(self.plan.uid)},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        for entry in InvoiceEntry.objects.filter(plan=self.plan):
            self.assertEqual(entry.project_status, "Confirmed")
            self.assertEqual(entry.categories.count(), 1)
            cat_link = entry.category_links.first()
            assert cat_link is not None
            self.assertEqual(cat_link.owner_links.count(), 1)

    def test_existing_entries_not_retro_updated(self):
        from core.invoices.models import InvoicePlanCategory

        self.api.post("/api/invoice_entries/generate/", {"plan_uid": str(self.plan.uid)}, format="json")
        # Add a second default category to the plan; existing entries
        # should not get the new one.
        from core.invoices.models import InvoiceCategory

        cat2 = InvoiceCategory.objects.create(org=self.org, name="Tax")
        InvoicePlanCategory.objects.filter(plan=self.plan).delete()
        InvoicePlanCategory.objects.create(plan=self.plan, category=self.cat, contribution_pct=50)
        InvoicePlanCategory.objects.create(plan=self.plan, category=cat2, contribution_pct=50)
        for entry in InvoiceEntry.objects.filter(plan=self.plan):
            self.assertEqual(entry.categories.count(), 1)  # still just Audit


class InvoiceReportsTests(TestCase):
    def setUp(self):
        from core.invoices.models import (
            InvoiceCategory,
            InvoiceEntryCategory,
            InvoiceEntryCategoryOwner,
        )

        self.org, self.admin = _make_org_admin("rep_admin")
        self.user2 = User.objects.create_user(username="rep_u2", password="pw", full_name="U2")
        OrgMembership.objects.create(user=self.user2, org=self.org, role="member")
        self.client_master = Master.objects.create(name="X", type="client", org=self.org)
        self.client_master.orgs.add(self.org)
        self.cat_a = InvoiceCategory.objects.create(org=self.org, name="Audit")
        self.cat_b = InvoiceCategory.objects.create(org=self.org, name="Tax")
        self.plan = InvoicePlan.objects.create(
            org=self.org,
            client=self.client_master,
            job_description="J",
            periodicity="Monthly",
            start_month=_dt.date(2026, 4, 1),
            end_month=_dt.date(2026, 4, 1),
            invoice_day=1,
            base_amount=1000,
            project_status="Confirmed",
        )
        # 1 entry with two categories 60/40; each category has admin/U2 50/50.
        self.entry = InvoiceEntry.objects.create(plan=self.plan, invoice_month=_dt.date(2026, 4, 1), amount=1000)
        self.entry.project_status = "Confirmed"
        self.entry.save()
        for cat, cat_pct in [(self.cat_a, 60), (self.cat_b, 40)]:
            cat_link = InvoiceEntryCategory.objects.create(entry=self.entry, category=cat, contribution_pct=cat_pct)
            InvoiceEntryCategoryOwner.objects.create(entry_category=cat_link, user=self.admin, contribution_pct=50)
            InvoiceEntryCategoryOwner.objects.create(entry_category=cat_link, user=self.user2, contribution_pct=50)
        # Second client / plan / entry in May, owned by admin only,
        # categorised entirely as Audit. Lets us test:
        #   - per-month distinct-client count differs by month
        #   - row-total count dedupes when same client appears twice
        #   - column-total count counts unique clients across rows
        self.client_master_b = Master.objects.create(name="Y", type="client", org=self.org)
        self.client_master_b.orgs.add(self.org)
        self.plan_b = InvoicePlan.objects.create(
            org=self.org,
            client=self.client_master_b,
            job_description="J2",
            periodicity="Monthly",
            start_month=_dt.date(2026, 5, 1),
            end_month=_dt.date(2026, 5, 1),
            invoice_day=1,
            base_amount=2000,
            project_status="Confirmed",
        )
        self.entry_b = InvoiceEntry.objects.create(plan=self.plan_b, invoice_month=_dt.date(2026, 5, 1), amount=2000)
        self.entry_b.project_status = "Confirmed"
        self.entry_b.save()
        cat_link_b = InvoiceEntryCategory.objects.create(
            entry=self.entry_b, category=self.cat_a, contribution_pct=100
        )
        InvoiceEntryCategoryOwner.objects.create(entry_category=cat_link_b, user=self.admin, contribution_pct=100)
        self.api = APIClient()
        _auth(self.api, self.admin)

    def test_group_by_category_attributes_correctly(self):
        res = self.api.get("/api/invoice_reports/?fy=2026-27&group_by=category")
        self.assertEqual(res.status_code, 200, res.data)
        rows = {r["label"]: r for r in res.data["rows"]}
        self.assertEqual(float(rows["Audit"]["monthly"]["2026-04"]), 600.0)
        self.assertEqual(float(rows["Tax"]["monthly"]["2026-04"]), 400.0)
        # April: 1000 (entry split 600/400). May: 2000 (entry_b, client Y, all Audit).
        self.assertEqual(float(res.data["totals"]["total"]), 3000.0)

    def test_group_by_owner(self):
        res = self.api.get("/api/invoice_reports/?fy=2026-27&group_by=owner")
        rows = {r["label"]: r for r in res.data["rows"]}
        self.assertEqual(float(rows["U2"]["monthly"]["2026-04"]), 500.0)

    def test_unattributed_bucket(self):
        InvoiceEntry.objects.create(plan=self.plan, invoice_month=_dt.date(2026, 5, 1), amount=300)
        res = self.api.get("/api/invoice_reports/?fy=2026-27&group_by=category")
        rows = {r["label"]: r for r in res.data["rows"]}
        self.assertEqual(float(rows["Unattributed"]["monthly"]["2026-05"]), 300.0)

    def test_filter_by_category(self):
        res = self.api.get(f"/api/invoice_reports/?fy=2026-27&group_by=owner&category={self.cat_a.uid}")
        self.assertEqual(res.status_code, 200)

    def test_filter_by_project_status(self):
        # Entry is Confirmed; ?project_status=Projected should return zero rows.
        res = self.api.get("/api/invoice_reports/?fy=2026-27&group_by=category&project_status=Projected")
        self.assertEqual(res.status_code, 200)
        # Either no rows or all-zero monthly values.
        total = sum(float(r["monthly"].get("2026-04", 0)) for r in res.data["rows"])
        self.assertEqual(total, 0.0)

    def test_owner_mode_returns_per_cell_client_counts(self):
        res = self.api.get("/api/invoice_reports/?fy=2026-27&group_by=owner")
        self.assertEqual(res.status_code, 200, res.data)
        rows = {r["label"]: r for r in res.data["rows"]}
        admin_row = rows["Rep_Admin"]
        u2_row = rows["U2"]
        # Admin owns entry (April, client X) and entry_b (May, client Y).
        self.assertEqual(admin_row["monthly_clients"]["2026-04"], 1)
        self.assertEqual(admin_row["monthly_clients"]["2026-05"], 1)
        self.assertEqual(admin_row["total_clients"], 2)
        # U2 owns only the April entry → one client, one month.
        self.assertEqual(u2_row["monthly_clients"]["2026-04"], 1)
        self.assertEqual(u2_row["monthly_clients"].get("2026-05", 0), 0)
        self.assertEqual(u2_row["total_clients"], 1)

    def test_category_mode_counts_distinct_clients(self):
        res = self.api.get("/api/invoice_reports/?fy=2026-27&group_by=category")
        rows = {r["label"]: r for r in res.data["rows"]}
        # Audit row: April entry contributes (client X), May entry contributes (client Y) → 2 distinct.
        self.assertEqual(rows["Audit"]["monthly_clients"]["2026-04"], 1)
        self.assertEqual(rows["Audit"]["monthly_clients"]["2026-05"], 1)
        self.assertEqual(rows["Audit"]["total_clients"], 2)
        # Tax row: only April entry → 1 client.
        self.assertEqual(rows["Tax"]["total_clients"], 1)
        # Column totals.
        self.assertEqual(res.data["totals"]["monthly_clients"]["2026-04"], 1)  # only client X in April
        self.assertEqual(res.data["totals"]["monthly_clients"]["2026-05"], 1)  # only client Y in May
        self.assertEqual(res.data["totals"]["total_clients"], 2)  # both clients across FY

    def test_month_mode_counts_distinct_clients(self):
        res = self.api.get("/api/invoice_reports/?fy=2026-27&group_by=month")
        rows = {r["label"]: r for r in res.data["rows"]}
        self.assertEqual(rows["2026-04"]["monthly_clients"]["2026-04"], 1)
        self.assertEqual(rows["2026-05"]["monthly_clients"]["2026-05"], 1)

    def test_client_mode_omits_count_fields(self):
        res = self.api.get("/api/invoice_reports/?fy=2026-27&group_by=client")
        for row in res.data["rows"]:
            self.assertNotIn("monthly_clients", row)
            self.assertNotIn("total_clients", row)
        self.assertNotIn("monthly_clients", res.data["totals"])
        self.assertNotIn("total_clients", res.data["totals"])

    def test_owner_per_category_routes_amount_to_correct_owner(self):
        """User's example: Accounting 50% → Tamil 100%, Analytics 50% →
        Akilan 100% on a ₹40k plan should give Tamil ₹20k Accounting and
        Akilan ₹20k Analytics — not 50/50 cross-attribution.
        """
        from core.invoices.models import (
            InvoiceCategory,
            InvoiceEntryCategory,
            InvoiceEntryCategoryOwner,
        )

        tamil = User.objects.create_user(username="tamil", password="pw", full_name="Tamil")
        akilan = User.objects.create_user(username="akilan", password="pw", full_name="Akilan")
        OrgMembership.objects.create(user=tamil, org=self.org, role="member")
        OrgMembership.objects.create(user=akilan, org=self.org, role="member")
        accounting = InvoiceCategory.objects.create(org=self.org, name="Accounting")
        analytics = InvoiceCategory.objects.create(org=self.org, name="Analytics")
        client_z = Master.objects.create(name="AL-Noor", type="client", org=self.org)
        client_z.orgs.add(self.org)
        plan_z = InvoicePlan.objects.create(
            org=self.org,
            client=client_z,
            job_description="J",
            periodicity="Monthly",
            start_month=_dt.date(2026, 6, 1),
            end_month=_dt.date(2026, 6, 1),
            invoice_day=5,
            base_amount=40000,
            project_status="Confirmed",
        )
        entry_z = InvoiceEntry.objects.create(plan=plan_z, invoice_month=_dt.date(2026, 6, 1), amount=40000)
        entry_z.project_status = "Confirmed"
        entry_z.save()
        link_acc = InvoiceEntryCategory.objects.create(entry=entry_z, category=accounting, contribution_pct=50)
        InvoiceEntryCategoryOwner.objects.create(entry_category=link_acc, user=tamil, contribution_pct=100)
        link_ana = InvoiceEntryCategory.objects.create(entry=entry_z, category=analytics, contribution_pct=50)
        InvoiceEntryCategoryOwner.objects.create(entry_category=link_ana, user=akilan, contribution_pct=100)

        res = self.api.get("/api/invoice_reports/?fy=2026-27&group_by=owner")
        self.assertEqual(res.status_code, 200, res.data)
        rows = {r["label"]: r for r in res.data["rows"]}
        # Tamil should get the full Accounting slice (₹20k), nothing for Analytics.
        self.assertEqual(float(rows["Tamil"]["monthly"]["2026-06"]), 20000.0)
        # Akilan should get the full Analytics slice (₹20k), nothing for Accounting.
        self.assertEqual(float(rows["Akilan"]["monthly"]["2026-06"]), 20000.0)

        # Owner drill-down for Tamil in June: only one row, Accounting ₹20k.
        cell = self.api.get(
            f"/api/invoice_reports/cell/?fy=2026-27&group_by=owner&row_key={tamil.uid}&month=2026-06"
        )
        self.assertEqual(cell.status_code, 200, cell.data)
        cell_rows = cell.data["rows"]
        self.assertEqual(len(cell_rows), 1)
        self.assertEqual(cell_rows[0]["category"], "Accounting")
        self.assertEqual(float(cell_rows[0]["amount"]), 20000.0)

    def test_unattributed_owner_shows_categories_with_no_owners(self):
        """A category contribution with no owner_links is part of the
        Unattributed bucket in owner mode (and only that slice — the rest
        of the entry's owned slices stay attributed)."""
        from core.invoices.models import InvoiceEntryCategory, InvoiceEntryCategoryOwner

        # Make plan_b's only category have no owners → ₹2000 → Unattributed.
        InvoiceEntryCategoryOwner.objects.filter(entry_category__entry=self.entry_b).delete()
        # entry (April) untouched: keeps owners on both cats.
        # entry_b (May) Audit slice now ownerless.
        res = self.api.get("/api/invoice_reports/?fy=2026-27&group_by=owner")
        rows = {r["label"]: r for r in res.data["rows"]}
        self.assertEqual(float(rows["Unattributed"]["monthly"]["2026-05"]), 2000.0)
        # Admin still gets April share (60%×50% + 40%×50% × 1000 = 500),
        # nothing for May (entry_b is unowned now).
        self.assertEqual(float(rows["Rep_Admin"]["monthly"]["2026-04"]), 500.0)
        self.assertEqual(float(rows["Rep_Admin"]["monthly"].get("2026-05", 0)), 0.0)


class InvoiceReportCellTests(TestCase):
    """Drill-down endpoint that backs the click-to-expand modal on the
    Invoice Tracker → Report tab."""

    def setUp(self):
        from core.invoices.models import (
            InvoiceCategory,
            InvoiceEntryCategory,
            InvoiceEntryCategoryOwner,
        )

        self.org, self.admin = _make_org_admin("cell_admin")
        self.user2 = User.objects.create_user(username="cell_u2", password="pw", full_name="U2")
        OrgMembership.objects.create(user=self.user2, org=self.org, role="member")

        self.client_x = Master.objects.create(name="Client X", type="client", org=self.org)
        self.client_x.orgs.add(self.org)
        self.client_y = Master.objects.create(name="Client Y", type="client", org=self.org)
        self.client_y.orgs.add(self.org)

        self.cat_a = InvoiceCategory.objects.create(org=self.org, name="Audit")
        self.cat_b = InvoiceCategory.objects.create(org=self.org, name="Tax")

        # Plan 1 — Client X, April + May. Each category carries the same
        # owner allocation (admin/U2 50/50) so the test's expected numbers
        # match the legacy flat-owner case (and exercise the migration's
        # default copy behavior).
        plan_x = InvoicePlan.objects.create(
            org=self.org,
            client=self.client_x,
            job_description="J",
            periodicity="Monthly",
            start_month=_dt.date(2026, 4, 1),
            end_month=_dt.date(2026, 5, 1),
            invoice_day=1,
            base_amount=1000,
            project_status="Confirmed",
        )
        for month_date in (_dt.date(2026, 4, 1), _dt.date(2026, 5, 1)):
            e = InvoiceEntry.objects.create(plan=plan_x, invoice_month=month_date, amount=1000)
            e.project_status = "Confirmed"
            e.save()
            for cat, pct in [(self.cat_a, 60), (self.cat_b, 40)]:
                cl = InvoiceEntryCategory.objects.create(entry=e, category=cat, contribution_pct=pct)
                InvoiceEntryCategoryOwner.objects.create(entry_category=cl, user=self.admin, contribution_pct=50)
                InvoiceEntryCategoryOwner.objects.create(entry_category=cl, user=self.user2, contribution_pct=50)

        # Plan 2 — Client Y, April only. Audit 100% owned by admin 100%.
        plan_y = InvoicePlan.objects.create(
            org=self.org,
            client=self.client_y,
            job_description="J",
            periodicity="Monthly",
            start_month=_dt.date(2026, 4, 1),
            end_month=_dt.date(2026, 4, 1),
            invoice_day=1,
            base_amount=2000,
            project_status="Confirmed",
        )
        e2 = InvoiceEntry.objects.create(plan=plan_y, invoice_month=_dt.date(2026, 4, 1), amount=2000)
        e2.project_status = "Confirmed"
        e2.save()
        cl_y = InvoiceEntryCategory.objects.create(entry=e2, category=self.cat_a, contribution_pct=100)
        InvoiceEntryCategoryOwner.objects.create(entry_category=cl_y, user=self.admin, contribution_pct=100)

        self.api = APIClient()
        _auth(self.api, self.admin)

    def test_owner_inner_cell_returns_per_category_per_client_rows(self):
        # Drill on (admin, 2026-04). Admin owns entry_x_apr (50%) and entry_y_apr (100%).
        res = self.api.get(
            f"/api/invoice_reports/cell/?fy=2026-27&group_by=owner&row_key={self.admin.uid}&month=2026-04"
        )
        self.assertEqual(res.status_code, 200, res.data)
        body = res.data
        # entry_x_apr × admin 50% × Audit 60% = 300
        # entry_x_apr × admin 50% × Tax 40%   = 200
        # entry_y_apr × admin 100% × Audit 100% = 2000
        rows = body["rows"]
        self.assertEqual(len(rows), 3)
        # Sort: client asc, category asc, month asc
        self.assertEqual(rows[0]["client"], "Client X")
        self.assertEqual(rows[0]["category"], "Audit")
        self.assertEqual(rows[0]["month"], "2026-04")
        self.assertEqual(float(rows[0]["amount"]), 300.0)
        self.assertEqual(rows[1]["client"], "Client X")
        self.assertEqual(rows[1]["category"], "Tax")
        self.assertEqual(float(rows[1]["amount"]), 200.0)
        self.assertEqual(rows[2]["client"], "Client Y")
        self.assertEqual(float(rows[2]["amount"]), 2000.0)
        self.assertEqual(float(body["total_amount"]), 2500.0)
        self.assertEqual(body["client_count"], 2)

    def test_category_inner_cell_returns_only_focus_category_share(self):
        # Drill on (Audit, 2026-04). Both entries contribute Audit share.
        res = self.api.get(
            f"/api/invoice_reports/cell/?fy=2026-27&group_by=category&row_key={self.cat_a.uid}&month=2026-04"
        )
        self.assertEqual(res.status_code, 200, res.data)
        body = res.data
        # entry_x_apr × Audit 60% = 600 (client X)
        # entry_y_apr × Audit 100% = 2000 (client Y)
        labels = [(r["client"], r["category"], float(r["amount"])) for r in body["rows"]]
        self.assertIn(("Client X", "Audit", 600.0), labels)
        self.assertIn(("Client Y", "Audit", 2000.0), labels)
        # No Tax rows in this drill.
        self.assertFalse(any(r["category"] == "Tax" for r in body["rows"]))
        self.assertEqual(float(body["total_amount"]), 2600.0)
        self.assertEqual(body["client_count"], 2)

    def test_month_inner_cell_lists_all_categories(self):
        # Drill on (2026-04, 2026-04). All April entries × all category links.
        res = self.api.get("/api/invoice_reports/cell/?fy=2026-27&group_by=month&row_key=2026-04&month=2026-04")
        body = res.data
        # entry_x_apr: Audit 60% = 600, Tax 40% = 400 (client X)
        # entry_y_apr: Audit 100% = 2000 (client Y)
        amounts = sorted(float(r["amount"]) for r in body["rows"])
        self.assertEqual(amounts, [400.0, 600.0, 2000.0])
        self.assertEqual(float(body["total_amount"]), 3000.0)
        self.assertEqual(body["client_count"], 2)

    def test_total_column_drill_aggregates_across_months(self):
        # Drill on (admin, Total). Row Total for owner mode across full FY.
        res = self.api.get(
            f"/api/invoice_reports/cell/?fy=2026-27&group_by=owner&row_key={self.admin.uid}&month=__total__"
        )
        body = res.data
        # Admin's slice: April (X 50%×60%=300 Audit, X 50%×40%=200 Tax, Y 100%×100%=2000 Audit)
        #               May   (X 50%×60%=300 Audit, X 50%×40%=200 Tax)
        # Total = 3000.
        self.assertEqual(float(body["total_amount"]), 3000.0)
        # Months column should now have multiple distinct values.
        months_in_response = {r["month"] for r in body["rows"]}
        self.assertEqual(months_in_response, {"2026-04", "2026-05"})

    def test_filter_by_project_status_propagates_to_cell(self):
        # All entries are Confirmed → ?project_status=Projected returns nothing.
        res = self.api.get(
            "/api/invoice_reports/cell/"
            f"?fy=2026-27&group_by=owner&row_key={self.admin.uid}&month=2026-04&project_status=Projected"
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["rows"], [])
        self.assertEqual(float(res.data["total_amount"]), 0.0)
        self.assertEqual(res.data["client_count"], 0)


class PlanUpdatePropagatesToPendingEntriesTests(TestCase):
    def setUp(self):
        from core.invoices.models import InvoiceCategory

        self.org, self.admin = _make_org_admin("propagate_admin")
        self.client_master = Master.objects.create(name="X", type="client", org=self.org)
        self.client_master.orgs.add(self.org)
        self.cat_a = InvoiceCategory.objects.create(org=self.org, name="Audit")
        self.cat_b = InvoiceCategory.objects.create(org=self.org, name="Tax")
        self.plan = InvoicePlan.objects.create(
            org=self.org,
            client=self.client_master,
            job_description="J",
            periodicity="Monthly",
            start_month=_dt.date(2026, 4, 1),
            end_month=_dt.date(2026, 6, 1),
            invoice_day=1,
            base_amount=1000,
        )
        self.api = APIClient()
        _auth(self.api, self.admin)
        # Generate three entries via API (plan has no attribution yet).
        self.api.post(
            "/api/invoice_entries/generate/",
            {"plan_uid": str(self.plan.uid)},
            format="json",
        )
        self.entries = list(InvoiceEntry.objects.filter(plan=self.plan).order_by("invoice_month"))

    def test_attribution_propagates_to_pending_entries(self):
        # All three entries start unattributed.
        for e in self.entries:
            self.assertEqual(e.categories.count(), 0)

        body = {
            "default_categories": [
                {
                    "category_uid": str(self.cat_a.uid),
                    "contribution_pct": "60.00",
                    "owners": [{"user_uid": str(self.admin.uid), "contribution_pct": "100.00"}],
                },
                {
                    "category_uid": str(self.cat_b.uid),
                    "contribution_pct": "40.00",
                    "owners": [{"user_uid": str(self.admin.uid), "contribution_pct": "100.00"}],
                },
            ],
        }
        res = self.api.patch(f"/api/invoice_plans/{self.plan.uid}/", body, format="json")
        self.assertEqual(res.status_code, 200, res.data)

        for e in InvoiceEntry.objects.filter(plan=self.plan):
            self.assertEqual(e.categories.count(), 2)
            for cl in e.category_links.all():
                self.assertEqual(cl.owner_links.count(), 1)

    def test_uploaded_entries_are_not_overwritten(self):
        # Mark first entry as Uploaded with its own attribution.
        from core.invoices.models import InvoiceEntryCategory

        first = self.entries[0]
        first.status = "Uploaded"
        first.save()
        InvoiceEntryCategory.objects.create(entry=first, category=self.cat_a, contribution_pct=100)

        body = {
            "default_categories": [
                {"category_uid": str(self.cat_b.uid), "contribution_pct": "100.00"},
            ],
        }
        res = self.api.patch(f"/api/invoice_plans/{self.plan.uid}/", body, format="json")
        self.assertEqual(res.status_code, 200, res.data)

        # First entry (Uploaded) keeps its Audit attribution.
        first.refresh_from_db()
        self.assertEqual(first.categories.count(), 1)
        first_cat = first.categories.first()
        assert first_cat is not None
        self.assertEqual(first_cat.name, "Audit")

        # Other Pending entries get the new Tax attribution.
        for e in self.entries[1:]:
            e.refresh_from_db()
            self.assertEqual(e.categories.count(), 1)
            cat = e.categories.first()
            assert cat is not None
            self.assertEqual(cat.name, "Tax")

    def test_project_status_propagates_to_pending(self):
        body = {"project_status": "Confirmed"}
        res = self.api.patch(f"/api/invoice_plans/{self.plan.uid}/", body, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        for e in InvoiceEntry.objects.filter(plan=self.plan):
            self.assertEqual(e.project_status, "Confirmed")


class PlanUpdatePropagatesToNonPendingEmptyEntriesTests(TestCase):
    """When a plan gets attribution and there are non-Pending entries with
    NO attribution yet, those entries should also pick up the new defaults
    (they pre-date the attribution feature and have nothing to preserve)."""

    def setUp(self):
        from core.invoices.models import InvoiceCategory

        self.org, self.admin = _make_org_admin("nonpending_admin")
        self.client_master = Master.objects.create(name="X", type="client", org=self.org)
        self.client_master.orgs.add(self.org)
        self.cat = InvoiceCategory.objects.create(org=self.org, name="Audit")
        self.plan = InvoicePlan.objects.create(
            org=self.org,
            client=self.client_master,
            job_description="J",
            periodicity="Monthly",
            start_month=_dt.date(2026, 4, 1),
            end_month=_dt.date(2026, 6, 1),
            invoice_day=1,
            base_amount=1000,
        )
        self.api = APIClient()
        _auth(self.api, self.admin)
        # Generate three entries (no attribution yet) and mark one Approved.
        self.api.post(
            "/api/invoice_entries/generate/",
            {"plan_uid": str(self.plan.uid)},
            format="json",
        )
        self.entries = list(InvoiceEntry.objects.filter(plan=self.plan).order_by("invoice_month"))
        self.april = self.entries[0]
        self.april.status = "Approved"
        self.april.save()

    def test_approved_entry_with_empty_attribution_gets_filled(self):
        body = {
            "default_categories": [
                {
                    "category_uid": str(self.cat.uid),
                    "contribution_pct": "100.00",
                    "owners": [{"user_uid": str(self.admin.uid), "contribution_pct": "100.00"}],
                },
            ],
        }
        res = self.api.patch(f"/api/invoice_plans/{self.plan.uid}/", body, format="json")
        self.assertEqual(res.status_code, 200, res.data)

        self.april.refresh_from_db()
        self.assertEqual(self.april.categories.count(), 1)
        cl = self.april.category_links.first()
        assert cl is not None
        self.assertEqual(cl.owner_links.count(), 1)

    def test_approved_entry_with_existing_attribution_is_preserved(self):
        from core.invoices.models import InvoiceCategory, InvoiceEntryCategory

        cat2 = InvoiceCategory.objects.create(org=self.org, name="Tax")
        # April (Approved) already has its own per-entry category.
        InvoiceEntryCategory.objects.create(entry=self.april, category=cat2, contribution_pct=100)

        body = {
            "default_categories": [
                {"category_uid": str(self.cat.uid), "contribution_pct": "100.00"},
            ],
        }
        res = self.api.patch(f"/api/invoice_plans/{self.plan.uid}/", body, format="json")
        self.assertEqual(res.status_code, 200, res.data)

        self.april.refresh_from_db()
        self.assertEqual(self.april.categories.count(), 1)
        # April keeps Tax (its per-entry override), NOT the new Audit default.
        april_cat = self.april.categories.first()
        assert april_cat is not None
        self.assertEqual(april_cat.name, "Tax")


# The old PlanUpdateCategoryOwnerIndependentPropagationTests scenario
# (Approved entry with owners but no categories) no longer exists — owners
# are now nested under categories, so an entry can't carry owners without
# a category to hang them on.
