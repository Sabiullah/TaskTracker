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


class ApkRelease(TimeStampedModel):
    """One row per exported APK build — powers the in-app download page.

    The APK bakes its version in at build time, so the installed app can only
    learn about newer builds (and what changed in them) from this table. The
    release flow appends a row per export (see
    frontend/task-tracker/exportAPK.md).
    """

    version = models.CharField(max_length=20, unique=True)
    remarks = models.TextField(
        blank=True,
        default="",
        help_text="What changed in this build — shown in the app's release table.",
    )

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "APK release"
        verbose_name_plural = "APK releases"

    def __str__(self):
        return f"v{self.version}"
