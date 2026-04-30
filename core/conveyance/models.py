import uuid

from django.conf import settings
from django.db import models

from core.base import TimeStampedModel
from core.filestore.validators import conveyance_attachment_upload_to


class ConveyanceEntry(TimeStampedModel):
    # Static-typing hints for pyright — Django's implicit primary key,
    # FK attnames, and reverse managers aren't surfaced to stubs.
    id: int
    org_id: int | None
    employee_id: int
    client_id: int
    reviewed_by_id: int | None
    created_by_id: int | None
    series_uid: uuid.UUID | None
    attachments: "models.Manager[ConveyanceAttachment]"

    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("approved", "Approved"),
        ("rejected", "Rejected"),
    ]

    FREQUENCY_CHOICES = [
        ("one_time", "One-time"),
        ("monthly", "Monthly"),
        ("half_yearly", "Half-yearly"),
        ("yearly", "Yearly"),
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
    frequency = models.CharField(
        max_length=12,
        choices=FREQUENCY_CHOICES,
        default="one_time",
        db_index=True,
    )
    series_uid = models.UUIDField(null=True, blank=True, db_index=True)
    start_month = models.DateField(null=True, blank=True)
    end_month = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ["-date", "-created_at"]
        verbose_name = "conveyance entry"
        verbose_name_plural = "conveyance entries"
        indexes = [
            models.Index(fields=["org", "date"]),
            models.Index(fields=["org", "employee", "date"]),
            models.Index(fields=["org", "client", "date"]),
            models.Index(fields=["org", "status"]),
            models.Index(fields=["org", "series_uid"]),
        ]

    def __str__(self):
        return f"{self.employee} · {self.date} · ₹{self.amount}"


class ConveyanceAttachment(TimeStampedModel):
    id: int
    entry_id: int

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    entry = models.ForeignKey(
        ConveyanceEntry,
        on_delete=models.CASCADE,
        related_name="attachments",
    )
    file = models.FileField(upload_to=conveyance_attachment_upload_to)
    label = models.CharField(max_length=100, blank=True)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="conveyance_attachment_uploads",
    )

    class Meta:
        ordering = ["created_at"]
        verbose_name = "conveyance attachment"
        verbose_name_plural = "conveyance attachments"
        indexes = [models.Index(fields=["entry"])]

    def __str__(self):
        name = self.file.name if self.file else None
        base = name.rsplit("/", 1)[-1] if name else "—"
        return f"{self.entry_id} · {self.label or base}"
