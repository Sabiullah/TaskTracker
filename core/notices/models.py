import uuid

from django.conf import settings
from django.db import models

from core.base import TimeStampedModel


class Notice(TimeStampedModel):
    STATUS_CHOICES = [
        ("Open", "Open"),
        ("Replied", "Replied"),
        ("Appealed", "Appealed"),
        ("Completed", "Completed"),
    ]
    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    serial_no = models.PositiveIntegerField(unique=True, null=True, blank=True, editable=False, db_index=True)
    org = models.ForeignKey(
        "users.Org",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="notices",
    )
    client = models.ForeignKey(
        "masters.Master",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="client_notices",
        limit_choices_to={"type": "client"},
    )
    dispute_nature = models.TextField()
    fy = models.CharField(max_length=10, blank=True, default="")
    received_date = models.DateField(null=True, blank=True)
    replied_date = models.DateField(null=True, blank=True)
    next_target_date = models.DateField(null=True, blank=True)
    remarks = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="Open", db_index=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="notices",
    )

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "notice"
        verbose_name_plural = "notices"

    def save(self, *args, **kwargs):
        if self.serial_no is None:
            last = Notice.objects.order_by("-serial_no").values_list("serial_no", flat=True).first()
            self.serial_no = (last or 0) + 1
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.client} - {self.fy} - {self.status}"
