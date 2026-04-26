from django.apps import AppConfig


class LeaveConfig(AppConfig):
    name = "core.leave"
    label = "leave"
    verbose_name = "leave requests"

    def ready(self):
        from . import signals  # noqa: F401  — imports materialise/demolish helpers used by apply_state_transition
