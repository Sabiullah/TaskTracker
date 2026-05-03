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
        months = sorted(
            InvoiceEntry.objects.filter(plan=self.plan).values_list("invoice_month", flat=True)
        )
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
        self.assertTrue(
            InvoiceEntry.objects.filter(plan=self.plan, invoice_month=_dt.date(2026, 4, 1)).exists()
        )

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
        months = sorted(
            InvoiceEntry.objects.filter(plan=self.plan).values_list("invoice_month", flat=True)
        )
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
