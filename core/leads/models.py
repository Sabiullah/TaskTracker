import uuid

from django.conf import settings
from django.db import models

from core.base import TimeStampedModel


class LeadStatus(models.Model):
    org = models.ForeignKey(
        "users.Org",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="lead_statuses",
    )
    name = models.CharField(max_length=100)
    color = models.CharField(max_length=20, default="#64748b")
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["sort_order"]
        verbose_name = "lead status"
        verbose_name_plural = "lead statuses"
        constraints = [
            models.UniqueConstraint(fields=["org", "name"], name="unique_lead_status_name_per_org"),
        ]

    def __str__(self):
        return self.name


class Lead(TimeStampedModel):
    PRIORITY_CHOICES = [
        ("High", "High"),
        ("Medium", "Medium"),
        ("Low", "Low"),
    ]
    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    serial_no = models.PositiveIntegerField(unique=True, null=True, blank=True, editable=False, db_index=True)
    org = models.ForeignKey(
        "users.Org",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="leads",
    )
    client = models.ForeignKey(
        "masters.Master",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="client_leads",
        limit_choices_to={"type": "client"},
    )
    # Free-text prospect name. Leads are enquiries — they often don't exist in
    # the client master yet — so we let the user type any name here. The FK
    # above is kept optional for cases where a lead is manually linked to an
    # existing master, but the display/write path uses ``client_name``.
    client_name = models.CharField(max_length=255, blank=True, default="")
    contact_person = models.CharField(max_length=150, blank=True, default="")
    contact_email = models.EmailField(blank=True, default="")
    contact_phone = models.CharField(max_length=30, blank=True, default="")
    lead_source = models.CharField(max_length=100, blank=True, default="")
    reference_from = models.CharField(max_length=255, blank=True, default="")
    status = models.ForeignKey(
        LeadStatus,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="leads",
    )
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default="Medium")
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="assigned_leads",
    )
    estimated_value = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    action_taken = models.TextField(blank=True)
    next_step = models.TextField(blank=True)
    next_step_date = models.DateField(null=True, blank=True)
    remarks = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="leads",
    )

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "lead"
        verbose_name_plural = "leads"

    def save(self, *args, **kwargs):
        if self.serial_no is None:
            last = Lead.objects.order_by("-serial_no").values_list("serial_no", flat=True).first()
            self.serial_no = (last or 0) + 1
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.client} ({self.priority})"


class LeadHistory(models.Model):
    # Django attaches these implicitly from the FKs below; declare them so
    # static type-checkers (pylance) don't complain in __str__.
    lead_id: int
    created_by_id: int | None

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    lead = models.ForeignKey(Lead, on_delete=models.CASCADE, related_name="history")
    note = models.TextField()
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="lead_history_entries",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "lead_history"
        ordering = ["-created_at"]
        verbose_name = "lead history entry"
        verbose_name_plural = "lead history"

    def __str__(self):
        return f"History on Lead #{self.lead_id}"
