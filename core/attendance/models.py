import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from core.base import TimeStampedModel


class Attendance(TimeStampedModel):
    # Hours-based attendance derivation, applied on save unless the row is
    # pinned via ``manual_status_override`` (admin override) or carries an
    # explicit Leave status:
    #   - hours > FULL_DAY_HOURS   → Present
    #   - HALF_DAY_HOURS ≤ hours ≤ FULL_DAY_HOURS → Half Day
    #   - hours < HALF_DAY_HOURS   → Absent
    # The Matrix view reads the same stored ``status`` so Log, Report and
    # Matrix can never disagree about a row.
    HALF_DAY_HOURS = 4
    FULL_DAY_HOURS = 6
    # Back-compat alias — older code referred to the 4h boundary as "minimum
    # for Present". The 4h threshold is now the Half Day floor.
    MIN_PRESENT_HOURS = HALF_DAY_HOURS

    # WFH is NOT a status — use work_location='WFH' instead. Keeping status
    # orthogonal to location mirrors the SQL schema and avoids two sources
    # of truth for the same fact.
    STATUS_CHOICES = [
        ("Present", "Present"),
        ("Absent", "Absent"),
        ("Half Day", "Half Day"),
        ("Leave", "Leave"),
        ("Holiday", "Holiday"),
    ]
    LOCATION_CHOICES = [
        ("Office", "Office"),
        ("WFH", "WFH"),
        ("Client Site", "Client Site"),
        ("Field", "Field"),
        ("Other", "Other"),
    ]
    APPROVAL_CHOICES = [
        ("Pending", "Pending"),
        ("Approved", "Approved"),
        ("Rejected", "Rejected"),
    ]
    LEAVE_SESSION_CHOICES = [
        ("First Half", "First Half"),
        ("Second Half", "Second Half"),
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
    approval_state = models.CharField(max_length=10, choices=APPROVAL_CHOICES, null=True, blank=True)
    approver = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="attendance_approvals",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True)
    leave_session = models.CharField(max_length=12, choices=LEAVE_SESSION_CHOICES, null=True, blank=True)
    # When True, save() skips _derive_status — admin/manager has pinned the
    # row to a specific status and it must not be auto-recomputed from hours.
    manual_status_override = models.BooleanField(default=False)
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
        indexes = [
            models.Index(fields=["approval_state", "org"]),
        ]
        verbose_name = "attendance"
        verbose_name_plural = "attendance"

    def clean(self):
        if self.login_time and self.logout_time and self.logout_time < self.login_time:
            raise ValidationError("logout_time cannot be before login_time.")
        # Present/Half Day must have a login time — mirrors SQL check.
        if self.status in ("Present", "Half Day") and not self.login_time:
            raise ValidationError("login_time is required for Present/Half Day status.")

    @property
    def worked_minutes(self) -> int | None:
        if not self.login_time or not self.logout_time:
            return None
        login_m = self.login_time.hour * 60 + self.login_time.minute
        logout_m = self.logout_time.hour * 60 + self.logout_time.minute
        return max(0, logout_m - login_m)

    @property
    def worked_hours(self) -> float | None:
        m = self.worked_minutes
        return None if m is None else round(m / 60, 2)

    def _derive_status(self) -> None:
        # Admin/manager has pinned the row → trust the chosen status as-is.
        if self.manual_status_override:
            return
        # Leave is an explicit admin choice (typically materialised from a
        # LeaveRequest) and must never revert to a punch-derived status.
        if self.status == "Leave":
            return
        m = self.worked_minutes
        if m is None:
            # No timing recorded → cannot derive. Trust the inbound value.
            return
        h = m / 60
        if h < self.HALF_DAY_HOURS:
            self.status = "Absent"
        elif h <= self.FULL_DAY_HOURS:
            self.status = "Half Day"
        else:
            self.status = "Present"

    def save(self, *args, **kwargs):
        self._derive_status()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.user} - {self.date} - {self.status}"
