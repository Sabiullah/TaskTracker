import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from core.base import TimeStampedModel


class Attendance(TimeStampedModel):
    # WFH is NOT a status — use work_location='WFH' instead. Keeping status
    # orthogonal to location mirrors the SQL schema and avoids two sources
    # of truth for the same fact.
    STATUS_CHOICES = [
        ("Present", "Present"),
        ("Absent", "Absent"),
        ("Half Day", "Half Day"),
        ("Leave", "Leave"),
    ]
    LOCATION_CHOICES = [
        ("Office", "Office"),
        ("WFH", "WFH"),
        ("Client Site", "Client Site"),
        ("Field", "Field"),
        ("Other", "Other"),
    ]
    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    org = models.ForeignKey(
        "users.Org",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="attendance_entries",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="attendance_entries",
        db_index=True,
    )
    date = models.DateField(db_index=True)
    login_time = models.TimeField(null=True, blank=True)
    logout_time = models.TimeField(null=True, blank=True)
    work_location = models.CharField(max_length=30, choices=LOCATION_CHOICES, default="Office")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="Present")
    remarks = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="attendance_records",
    )

    class Meta:
        ordering = ["-date", "user"]
        unique_together = ("user", "date")
        verbose_name = "attendance"
        verbose_name_plural = "attendance"

    def clean(self):
        if self.login_time and self.logout_time and self.logout_time < self.login_time:
            raise ValidationError("logout_time cannot be before login_time.")
        # Present/Half Day must have a login time — mirrors SQL check.
        if self.status in ("Present", "Half Day") and not self.login_time:
            raise ValidationError("login_time is required for Present/Half Day status.")

    def __str__(self):
        return f"{self.user} - {self.date} - {self.status}"
