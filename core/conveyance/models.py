import uuid

from django.conf import settings
from django.db import models

from core.base import TimeStampedModel


class ConveyanceEntry(TimeStampedModel):
    # Static-typing hints for pyright — Django's implicit primary key
    # and FK attnames aren't surfaced to stubs.
    id: int
    org_id: int | None
    employee_id: int
    client_id: int

    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("approved", "Approved"),
        ("rejected", "Rejected"),
    ]

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    org = models.ForeignKey(
        "users.Org",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="conveyance_entries",
    )
    employee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="conveyance_entries",
    )
    date = models.DateField(db_index=True)
    client = models.ForeignKey(
        "masters.Master",
        on_delete=models.PROTECT,
        related_name="client_conveyance_entries",
        limit_choices_to={"type": "client"},
    )
    reason = models.TextField(max_length=2000)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    claimable = models.BooleanField(default=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="pending", db_index=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="conveyance_reviews",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_note = models.CharField(max_length=500, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="conveyance_created",
    )

    class Meta:
        ordering = ["-date", "-created_at"]
        verbose_name = "conveyance entry"
        verbose_name_plural = "conveyance entries"
        indexes = [
            models.Index(fields=["org", "date"]),
            models.Index(fields=["org", "employee", "date"]),
            models.Index(fields=["org", "client", "date"]),
            models.Index(fields=["org", "status"]),
        ]

    def __str__(self):
        return f"{self.employee} · {self.date} · ₹{self.amount}"
