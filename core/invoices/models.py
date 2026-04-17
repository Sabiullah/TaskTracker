import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from core.base import TimeStampedModel
from core.filestore.validators import invoice_upload_to


class InvoicePlan(TimeStampedModel):
    PERIODICITY_CHOICES = [
        ("Monthly", "Monthly"),
        ("Quarterly", "Quarterly"),
        ("Half-yearly", "Half-yearly"),
        ("Yearly", "Yearly"),
    ]
    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    serial_no = models.PositiveIntegerField(unique=True, null=True, blank=True, editable=False, db_index=True)
    org = models.ForeignKey(
        "users.Org",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="invoice_plans",
    )
    client = models.ForeignKey(
        "masters.Master",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="client_invoice_plans",
        limit_choices_to={"type": "client"},
    )
    job_description = models.TextField()
    periodicity = models.CharField(max_length=20, choices=PERIODICITY_CHOICES, default="Monthly")
    start_month = models.DateField()
    end_month = models.DateField()
    invoice_day = models.IntegerField(
        default=1,
        validators=[MinValueValidator(1), MaxValueValidator(31)],
    )
    base_amount = models.DecimalField(max_digits=14, decimal_places=2)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="invoice_plans",
    )

    class Meta:
        ordering = ["start_month"]
        verbose_name = "invoice plan"
        verbose_name_plural = "invoice plans"

    def save(self, *args, **kwargs):
        if self.serial_no is None:
            last = InvoicePlan.objects.order_by("-serial_no").values_list("serial_no", flat=True).first()
            self.serial_no = (last or 0) + 1
        super().save(*args, **kwargs)

    def clean(self):
        if self.start_month and self.end_month and self.start_month > self.end_month:
            raise ValidationError("start_month must be on or before end_month.")
        if self.invoice_day and self.start_month:
            import calendar as _cal

            max_day = _cal.monthrange(self.start_month.year, self.start_month.month)[1]
            if self.invoice_day > max_day:
                raise ValidationError(f"invoice_day {self.invoice_day} is invalid for the start month.")

    def __str__(self):
        return f"{self.client} - {self.periodicity}"


class InvoiceEntry(TimeStampedModel):
    STATUS_CHOICES = [
        ("Pending", "Pending"),
        ("Uploaded", "Uploaded"),
        ("Approved", "Approved"),
        ("Rejected", "Rejected"),
    ]
    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    plan = models.ForeignKey(InvoicePlan, on_delete=models.CASCADE, related_name="entries")
    invoice_month = models.DateField(db_index=True)
    invoice_date = models.DateField(null=True, blank=True)
    amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="Pending", db_index=True)
    invoice_number = models.CharField(max_length=100, blank=True, default="")
    notes = models.TextField(blank=True)
    file = models.FileField(upload_to=invoice_upload_to, null=True, blank=True)
    rejection_reason = models.TextField(blank=True)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="uploaded_invoices",
    )
    uploaded_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="approved_invoices",
    )
    approved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["invoice_month", "invoice_date"]
        unique_together = ("plan", "invoice_month")
        verbose_name = "invoice entry"
        verbose_name_plural = "invoice entries"

    def save(self, *args, **kwargs):
        from django.utils import timezone

        if self.status == "Uploaded" and not self.uploaded_at:
            self.uploaded_at = timezone.now()
        if self.status == "Approved" and not self.approved_at:
            self.approved_at = timezone.now()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"Invoice {self.invoice_number or '—'} ({self.invoice_month})"
