import calendar
import datetime as dt
import uuid
from decimal import Decimal

from django.conf import settings
from django.db import models, transaction

from core.base import TimeStampedModel


class LeaveRequest(TimeStampedModel):
    SESSION_CHOICES = [
        ("Full", "Full"),
        ("First Half", "First Half"),
        ("Second Half", "Second Half"),
    ]
    STATUS_CHOICES = [
        ("Pending", "Pending"),
        ("Approved", "Approved"),
        ("Rejected", "Rejected"),
        ("Withdrawn", "Withdrawn"),
    ]

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    org = models.ForeignKey(
        "users.Org",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="leave_requests",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="leave_requests",
    )
    from_date = models.DateField()
    to_date = models.DateField()
    from_session = models.CharField(max_length=12, choices=SESSION_CHOICES, default="Full")
    to_session = models.CharField(max_length=12, choices=SESSION_CHOICES, default="Full")
    reason = models.TextField()
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="Pending", db_index=True)
    approver = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="leave_decisions",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True)
    total_days = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("0"))
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="leave_requests_created",
    )

    class Meta:
        ordering = ["-from_date", "-id"]
        verbose_name = "leave request"
        verbose_name_plural = "leave requests"
        indexes = [
            models.Index(fields=["status", "org"]),
            models.Index(fields=["user", "from_date", "to_date"]),
        ]

    def __str__(self):
        return f"{self.user} · {self.from_date} → {self.to_date} ({self.status})"

    # ── Day computation ──────────────────────────────────────────────────
    def included_dates(self) -> list[tuple[dt.date, str]]:
        """Yield (date, session) pairs for every day this request covers,
        skipping holidays and Sundays (per spec Q6(b)).

        Session is 'Full' for inner dates; the first/last date carries the
        from_session / to_session if the request is multi-day, or the merged
        session if from_date == to_date.
        """
        from core.holidays.models import Holiday
        from core.working_days.models import WorkingDayOverride

        if self.from_date > self.to_date:
            return []

        holidays = set(
            Holiday.objects.filter(date__range=(self.from_date, self.to_date)).values_list("date", flat=True)
        )
        overrides = {
            o.date: o.is_working
            for o in WorkingDayOverride.objects.filter(
                org=self.org, date__range=(self.from_date, self.to_date)
            )
        }

        out: list[tuple[dt.date, str]] = []
        cur = self.from_date
        single = self.from_date == self.to_date
        while cur <= self.to_date:
            if cur in holidays:
                cur += dt.timedelta(days=1)
                continue
            is_sunday = cur.weekday() == calendar.SUNDAY
            override_working = overrides.get(cur)
            if is_sunday and not override_working:
                cur += dt.timedelta(days=1)
                continue
            if single:
                # First and to sessions both apply — merge.
                if self.from_session == "Full" or self.to_session == "Full":
                    session = "Full"
                elif self.from_session == self.to_session:
                    session = self.from_session
                else:
                    # First Half + Second Half on the same date is a Full leave.
                    session = "Full"
            elif cur == self.from_date:
                session = self.from_session
            elif cur == self.to_date:
                session = self.to_session
            else:
                session = "Full"
            out.append((cur, session))
            cur += dt.timedelta(days=1)
        return out

    def compute_total_days(self) -> Decimal:
        total = Decimal("0")
        for _date, session in self.included_dates():
            total += Decimal("1") if session == "Full" else Decimal("0.5")
        return total

    # ── State transitions ────────────────────────────────────────────────
    def apply_state_transition(self, new_status: str, by_user, reason: str = ""):
        """Single source of truth for status changes + materialisation.

        Use this — never assign `status` directly — so that materialised
        Attendance rows stay in sync.
        """
        from .signals import materialise_attendance, demolish_attendance

        old = self.status
        if old == new_status:
            return self
        self.status = new_status
        if new_status in ("Approved", "Rejected"):
            self.approver = by_user
            self.approved_at = dt.datetime.now(dt.UTC)
        if new_status == "Rejected":
            self.rejection_reason = reason or ""
        with transaction.atomic():
            self.save(update_fields=["status", "approver", "approved_at", "rejection_reason", "updated_at"])
            if old == "Approved" and new_status in ("Rejected", "Withdrawn"):
                demolish_attendance(self)
            elif new_status == "Approved":
                materialise_attendance(self, by_user)
        return self
