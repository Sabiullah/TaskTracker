import uuid

from django.conf import settings
from django.db import models

from core.base import TimeStampedModel


class Master(TimeStampedModel):
    # 'org' removed — orgs live in their own first-class table (users.Org).
    TYPE_CHOICES = [
        ("client", "Client"),
        ("category", "Category"),
        ("team", "Team"),
    ]
    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    name = models.CharField(max_length=255)
    type = models.CharField(max_length=20, choices=TYPE_CHOICES, db_index=True)
    color = models.CharField(max_length=20, blank=True, default="")
    org = models.ForeignKey(
        "users.Org",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="masters",
    )
    is_active = models.BooleanField(default=True, db_index=True)
    sort_order = models.IntegerField(default=0)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="masters",
    )

    class Meta:
        ordering = ["type", "sort_order", "name"]
        # Include org in the uniqueness — two tenants can independently
        # have a "Acme" client without colliding.
        unique_together = ("type", "name", "org")
        constraints = [
            models.CheckConstraint(
                condition=models.Q(type__in=["client", "category", "team"]),
                name="master_type_valid",
            )
        ]
        verbose_name = "master"
        verbose_name_plural = "masters"

    def __str__(self):
        return f"{self.type}: {self.name}"
