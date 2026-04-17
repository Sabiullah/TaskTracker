import calendar
import uuid

from django.conf import settings
from django.db import models

from core.base import TimeStampedModel


class Holiday(TimeStampedModel):
    TYPE_CHOICES = [
        ("National", "National"),
        ("Regional", "Regional"),
        ("Company", "Company"),
    ]
    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    org = models.ForeignKey(
        "users.Org",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="holidays",
    )
    name = models.CharField(max_length=255)
    date = models.DateField(unique=True)
    type = models.CharField(max_length=20, choices=TYPE_CHOICES, default="National")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="holidays",
    )

    class Meta:
        ordering = ["date"]
        verbose_name = "holiday"
        verbose_name_plural = "holidays"

    @property
    def day(self) -> str:
        # calendar.day_name is a locale-aware Sequence; index yields a str
        # at runtime but pyright types it as Sequence[str]. Convert to be safe.
        return str(calendar.day_name[self.date.weekday()])

    def __str__(self):
        return f"{self.name} ({self.date})"
