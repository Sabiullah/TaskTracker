import uuid

from django.conf import settings
from django.db import models

from core.base import TimeStampedModel


class GrowthPlan(TimeStampedModel):
    STATUS_CHOICES = [
        ("Open", "Open"),
        ("Under Progress", "Under Progress"),
        ("Completed", "Completed"),
        ("On Hold", "On Hold"),
        ("Cancelled", "Cancelled"),
    ]
    PRIORITY_CHOICES = [
        ("High", "High"),
        ("Medium", "Medium"),
        ("Low", "Low"),
    ]

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    org = models.ForeignKey(
        "users.Org",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="growth_plans",
    )
    activity = models.TextField()
    target_month = models.DateField(null=True, blank=True)
    steps_taken = models.TextField(blank=True)
    steps_to_take = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="Open", db_index=True)
    priority = models.CharField(max_length=10, choices=PRIORITY_CHOICES, default="Medium", db_index=True)
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="growth_plans",
    )
    remarks = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_growth_plans",
    )

    class Meta:
        ordering = ["target_month", "priority"]
        verbose_name = "growth plan"
        verbose_name_plural = "growth plans"

    def __str__(self):
        return f"{self.activity[:60]} ({self.status})"
