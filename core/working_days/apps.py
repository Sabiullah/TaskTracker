from django.apps import AppConfig


class WorkingDaysConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "core.working_days"
    label = "working_days"
    verbose_name = "working day overrides"
