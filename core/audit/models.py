from django.conf import settings
from django.db import models


class AuditLog(models.Model):
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    org = models.ForeignKey("users.Org", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    action = models.CharField(max_length=64)
    resource_type = models.CharField(max_length=64, blank=True)
    resource_id = models.CharField(max_length=64, blank=True)
    changes = models.JSONField(default=dict, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["-created_at"]),
            models.Index(fields=["action", "-created_at"]),
            models.Index(fields=["resource_type", "resource_id"]),
        ]

    def __str__(self):
        actor_id = getattr(self, "actor_id", None)
        return f"{self.action} by {actor_id} @ {self.created_at:%Y-%m-%d %H:%M}"


def log(actor, action, *, org=None, resource_type="", resource_id="", changes=None, request=None):
    ip = None
    if request is not None:
        ip = (request.META.get("HTTP_X_FORWARDED_FOR") or request.META.get("REMOTE_ADDR") or "").split(",")[
            0
        ].strip() or None
    return AuditLog.objects.create(
        actor=actor if getattr(actor, "is_authenticated", False) else None,
        org=org or getattr(actor, "org", None),
        action=action,
        resource_type=resource_type,
        resource_id=str(resource_id) if resource_id else "",
        changes=changes or {},
        ip_address=ip,
    )
