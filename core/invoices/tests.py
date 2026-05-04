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
                {"category_uid": str(self.cat.uid), "contribution_pct": "100.00"},
            ],
            "owners": [
                {"user_uid": str(self.admin.uid), "contribution_pct": "100.00"},
            ],
        }
        res = self.api.patch(f"/api/invoice_entries/{self.entry.uid}/", body, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["project_status"], "Confirmed")
        self.assertEqual(len(res.data["categories"]), 1)
        self.assertEqual(len(res.data["owners"]), 1)

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
            InvoicePlanOwner,
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
        InvoicePlanCategory.objects.create(plan=self.plan, category=self.cat, contribution_pct=100)
        InvoicePlanOwner.objects.create(plan=self.plan, user=self.admin, contribution_pct=100)
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
            self.assertEqual(entry.owners.count(), 1)

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
            InvoiceEntryOwner,
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
        # 1 entry with two categories 60/40 and two owners 50/50
        self.entry = InvoiceEntry.objects.create(plan=self.plan, invoice_month=_dt.date(2026, 4, 1), amount=1000)
        self.entry.project_status = "Confirmed"
        self.entry.save()
        InvoiceEntryCategory.objects.create(entry=self.entry, category=self.cat_a, contribution_pct=60)
        InvoiceEntryCategory.objects.create(entry=self.entry, category=self.cat_b, contribution_pct=40)
        InvoiceEntryOwner.objects.create(entry=self.entry, user=self.admin, contribution_pct=50)
        InvoiceEntryOwner.objects.create(entry=self.entry, user=self.user2, contribution_pct=50)
        self.api = APIClient()
        _auth(self.api, self.admin)

    def test_group_by_category_attributes_correctly(self):
        res = self.api.get("/api/invoice_reports/?fy=2026-27&group_by=category")
        self.assertEqual(res.status_code, 200, res.data)
        rows = {r["label"]: r for r in res.data["rows"]}
        self.assertEqual(float(rows["Audit"]["monthly"]["2026-04"]), 600.0)
        self.assertEqual(float(rows["Tax"]["monthly"]["2026-04"]), 400.0)
        self.assertEqual(float(res.data["totals"]["total"]), 1000.0)

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
                {"category_uid": str(self.cat_a.uid), "contribution_pct": "60.00"},
                {"category_uid": str(self.cat_b.uid), "contribution_pct": "40.00"},
            ],
            "default_owners": [
                {"user_uid": str(self.admin.uid), "contribution_pct": "100.00"},
            ],
        }
        res = self.api.patch(f"/api/invoice_plans/{self.plan.uid}/", body, format="json")
        self.assertEqual(res.status_code, 200, res.data)

        for e in InvoiceEntry.objects.filter(plan=self.plan):
            self.assertEqual(e.categories.count(), 2)
            self.assertEqual(e.owners.count(), 1)

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
