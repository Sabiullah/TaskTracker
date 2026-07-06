import uuid

from django.conf import settings
from django.db import models

from core.base import TimeStampedModel


class CostingEntry(TimeStampedModel):
    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    org = models.ForeignKey(
        "users.Org",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="costing_entries",
    )
    client = models.ForeignKey(
        "masters.Master",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="costing_entries_as_client",
        limit_choices_to={"type": "client"},
    )
    designation = models.ForeignKey(
        "masters.Master",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="costing_entries_as_designation",
        limit_choices_to={"type": "designation"},
    )
    employee = models.ForeignKey(
        "employees.Employee",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="costing_entries",
    )
    hr_day = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    days_working = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=10, decimal_places=2, default=0, editable=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="costing_entries",
    )

    class Meta:
        ordering = ["client__name", "designation__name"]
        verbose_name = "costing entry"
        verbose_name_plural = "costing entries"

    def save(self, *args, **kwargs):
        self.total = (self.hr_day or 0) * (self.days_working or 0)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.client} — {self.designation} ({self.total})"
