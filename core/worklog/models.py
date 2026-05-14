import uuid
from decimal import Decimal

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from core.base import TimeStampedModel

HOURS_VALIDATORS = [MinValueValidator(Decimal("0")), MaxValueValidator(Decimal("24"))]


class WorkLog(TimeStampedModel):
    PRIORITY_CHOICES = [
        ("Top Priority", "Top Priority"),
        ("Priority", "Priority"),
        ("Normal", "Normal"),
        ("Not Urgent", "Not Urgent"),
    ]
    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    org = models.ForeignKey(
        "users.Org",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="work_logs",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="work_logs",
    )
    date = models.DateField(db_index=True)
    client = models.ForeignKey(
        "masters.Master",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="client_worklogs",
        limit_choices_to={"type": "client"},
    )
    task_description = models.TextField()
    hours_worked = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        validators=HOURS_VALIDATORS,
    )
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default="Normal")
    sort_order = models.IntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "-date", "-created_at"]
        verbose_name = "work log"
        verbose_name_plural = "work logs"

    def __str__(self):
        return f"{self.user} - {self.date}"


class WorkPlan(TimeStampedModel):
    RECURRENCE_CHOICES = [
        ("", "One-time"),
        ("daily", "Daily"),
        ("weekly", "Weekly"),
        ("monthly", "Monthly"),
    ]
    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    org = models.ForeignKey(
        "users.Org",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="work_plans",
    )
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="work_plans",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_work_plans",
    )
    date = models.DateField(null=True, blank=True, db_index=True)
    client = models.ForeignKey(
        "masters.Master",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="client_workplans",
        limit_choices_to={"type": "client"},
    )
    task_description = models.TextField()
    planned_hours = models.DecimalField(max_digits=5, decimal_places=2, validators=HOURS_VALIDATORS)
    series_uid = models.UUIDField(null=True, blank=True, db_index=True)
    recurrence = models.CharField(
        max_length=20,
        choices=RECURRENCE_CHOICES,
        blank=True,
        default="",
    )
    recurrence_end_date = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ["date"]
        verbose_name = "work plan"
        verbose_name_plural = "work plans"

    def __str__(self):
        return f"{self.assigned_to} - {self.date}"
