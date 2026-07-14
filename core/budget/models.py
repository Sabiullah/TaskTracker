import uuid

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from core.base import TimeStampedModel


class BudgetLineItem(TimeStampedModel):
    LINE_TYPE_CHOICES = [
        ("budget", "Budget"),
        ("actual", "Actual"),
    ]

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    org = models.ForeignKey(
        "users.Org",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="budget_line_items",
    )
    client = models.ForeignKey(
        "masters.Master",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="budget_line_items",
        limit_choices_to={"type": "client"},
    )
    financial_year = models.PositiveIntegerField(
        validators=[MinValueValidator(2000), MaxValueValidator(2100)],
    )
    month = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(12)],
    )
    line_type = models.CharField(max_length=10, choices=LINE_TYPE_CHOICES)
    description = models.CharField(max_length=255, blank=True, default="")
    amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0,
        validators=[MinValueValidator(0)],
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="budget_line_items",
    )

    class Meta:
        ordering = ["client__name", "financial_year", "month", "line_type"]
        verbose_name = "budget line item"
        verbose_name_plural = "budget line items"
        indexes = [
            models.Index(fields=["client", "financial_year"], name="budget_client_fy_idx"),
        ]

    def __str__(self):
        return f"{self.client} {self.financial_year}-{self.month:02d} {self.line_type}: {self.amount}"
