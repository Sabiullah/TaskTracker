import uuid

from django.conf import settings
from django.db import models

from core.base import TimeStampedModel


class WorkingDayOverride(TimeStampedModel):
    """Override the default Sunday=holiday rule for a specific date.

    A row with ``is_working=True`` flips a Sunday into a working day. The
    field exists for symmetry — a future ``False`` row could mark an arbitrary
    weekday as a holiday, but the matrix's holiday-resolution order checks
    explicit `Holiday` rows first, so that case isn't used yet.
    """

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    org = models.ForeignKey(
        "users.Org",
        on_delete=models.CASCADE,
        related_name="working_day_overrides",
    )
    date = models.DateField()
    is_working = models.BooleanField(default=True)
    note = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="working_day_overrides",
    )

    class Meta:
        unique_together = ("org", "date")
        ordering = ["-date"]
        verbose_name = "working day override"
        verbose_name_plural = "working day overrides"

    def __str__(self):
        return f"{self.date} ({'working' if self.is_working else 'holiday'})"
