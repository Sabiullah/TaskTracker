import uuid

from django.conf import settings
from django.db import models

from core.base import TimeStampedModel


class Kaizen(TimeStampedModel):
    STATUS_CHOICES = [
        ("Pending", "Pending"),
        ("Approved", "Approved"),
        ("Rejected", "Rejected"),
    ]

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    org = models.ForeignKey(
        "users.Org",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="kaizens",
    )
    raised_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="raised_kaizens",
    )
    entry_date = models.DateField(db_index=True)
    client = models.ForeignKey(
        "masters.Master",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="client_kaizens",
        limit_choices_to={"type": "client"},
    )
    area = models.CharField(max_length=255, blank=True, default="")
    description = models.TextField()
    takeaway = models.TextField()
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default="Pending",
        db_index=True,
    )
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reviewed_kaizens",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-entry_date", "-created_at"]
        verbose_name = "kaizen entry"
        verbose_name_plural = "kaizen entries"
        indexes = [
            models.Index(fields=["status", "-entry_date"], name="kaizen_status_date_idx"),
        ]

    def __str__(self):
        label = self.area.strip() if self.area else f"Kaizen #{self.pk}"
        return f"{label} ({self.status})"
