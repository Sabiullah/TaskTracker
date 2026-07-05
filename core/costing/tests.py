from decimal import Decimal

from django.test import TestCase

from core.masters.models import Master
from users.models import Org

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
        self.assertEqual(entry.total, Decimal("30"))

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
        self.assertEqual(entry.total, Decimal("28"))
