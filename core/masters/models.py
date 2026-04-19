import uuid

from django.conf import settings
from django.db import models

from core.base import TimeStampedModel


class Master(TimeStampedModel):
    # 'org' removed — orgs live in their own first-class table (users.Org).
    # 'team' removed — team members are User + OrgMembership (see
    # ``drop_team_masters`` management command for the one-time migration).
    TYPE_CHOICES = [
        ("client", "Client"),
        ("category", "Category"),
    ]
    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    name = models.CharField(max_length=255)
    type = models.CharField(max_length=20, choices=TYPE_CHOICES, db_index=True)
    color = models.CharField(max_length=20, blank=True, default="")
    # Legacy single-org FK. Kept for backward compatibility during the
    # M2M rollout — read as a fallback when ``orgs`` is empty, but all
    # new writes flow through ``orgs`` below. Safe to drop once every
    # existing row has been mirrored into ``orgs`` (see migration 0004).
    org = models.ForeignKey(
        "users.Org",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="masters",
    )
    # Multi-org membership. A client / category can be shared across any
    # number of orgs — the ``scoped()`` helper does ``orgs__in=caller``
    # with ``.distinct()`` so it doesn't duplicate rows when a master
    # lives in two orgs the caller also belongs to.
    orgs = models.ManyToManyField(
        "users.Org",
        blank=True,
        related_name="shared_masters",
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
        # have a "Acme" client without colliding. Kept scoped to the
        # legacy ``org`` FK; since the M2M lets one row serve multiple
        # orgs, uniqueness by (type, name) alone would be too strict.
        unique_together = ("type", "name", "org")
        constraints = [
            models.CheckConstraint(
                condition=models.Q(type__in=["client", "category"]),
                name="master_type_valid",
            )
        ]
        verbose_name = "master"
        verbose_name_plural = "masters"

    def __str__(self):
        return f"{self.type}: {self.name}"
