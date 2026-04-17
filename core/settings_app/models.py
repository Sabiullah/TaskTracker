from django.conf import settings
from django.db import models

from core.base import TimeStampedModel


class AppSetting(TimeStampedModel):
    org = models.ForeignKey(
        "users.Org",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="app_settings",
    )
    key = models.CharField(max_length=100)
    value = models.TextField(blank=True)
    description = models.TextField(blank=True, default="")
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="app_settings_updated",
    )

    class Meta:
        ordering = ["key"]
        unique_together = ("org", "key")
        verbose_name = "app setting"
        verbose_name_plural = "app settings"

    def __str__(self):
        return f"{self.key} = {self.value}"
