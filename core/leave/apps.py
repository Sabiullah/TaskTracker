from django.apps import AppConfig


class LeaveConfig(AppConfig):
    name = "core.leave"
    label = "leave"
    verbose_name = "leave requests"

    def ready(self):
        from . import signals  # noqa: F401  — registers post_save handlers
