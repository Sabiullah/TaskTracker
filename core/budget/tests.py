from decimal import Decimal

from django.core.exceptions import ValidationError
from django.test import TestCase

from core.masters.models import Master
from users.models import Org

from .models import BudgetLineItem


class BudgetLineItemModelTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="Org-Budget")
        self.client_master = Master.objects.create(name="Acme", type="client", org=self.org)

    def test_create_budget_line_item(self):
        item = BudgetLineItem.objects.create(
            org=self.org,
            client=self.client_master,
            financial_year=2026,
            month=1,
            line_type="budget",
            description="Retainer fee",
            amount=Decimal("50000"),
        )
        self.assertEqual(item.line_type, "budget")
        self.assertEqual(item.amount, Decimal("50000"))

    def test_create_actual_line_item(self):
        item = BudgetLineItem.objects.create(
            org=self.org,
            client=self.client_master,
            financial_year=2026,
            month=1,
            line_type="actual",
            description="Invoice paid",
            amount=Decimal("48000"),
        )
        self.assertEqual(item.line_type, "actual")

    def test_month_out_of_range_rejected(self):
        item = BudgetLineItem(
            org=self.org,
            client=self.client_master,
            financial_year=2026,
            month=13,
            line_type="budget",
            amount=Decimal("100"),
        )
        with self.assertRaises(ValidationError):
            item.full_clean()

    def test_negative_amount_rejected(self):
        item = BudgetLineItem(
            org=self.org,
            client=self.client_master,
            financial_year=2026,
            month=1,
            line_type="budget",
            amount=Decimal("-10"),
        )
        with self.assertRaises(ValidationError):
            item.full_clean()
