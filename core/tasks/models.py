import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from core.base import TimeStampedModel


class Task(TimeStampedModel):
    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("today_task", "Today Task"),
        ("tomorrow", "Tomorrow"),
        ("in_progress", "In Progress"),
        ("completed", "Completed"),
        ("completed_delay", "Completed Delay"),
        ("overdue", "Overdue"),
        ("future_goal", "Future Task/Goals"),
        ("tbc", "TBC"),
        ("archived", "Archived"),
    ]
    RECURRENCE_CHOICES = [
        ("onetime", "One-time"),
        ("daily", "Daily"),
        ("weekly", "Weekly"),
        ("monthly", "Monthly"),
        ("quarterly", "Quarterly"),
        ("halfyearly", "Half-yearly"),
        ("yearly", "Yearly"),
    ]
    COMPLETED_STATUSES = {"completed", "completed_delay"}

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    serial_no = models.PositiveIntegerField(unique=True, null=True, blank=True, editable=False, db_index=True)
    title = models.CharField(max_length=255, blank=True, default="")
    org = models.ForeignKey(
        "users.Org",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="tasks",
    )
    client = models.ForeignKey(
        "masters.Master",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="client_tasks",
        limit_choices_to={"type": "client"},
    )
    category = models.ForeignKey(
        "masters.Master",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="category_tasks",
        limit_choices_to={"type": "category"},
    )
    description = models.TextField()
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default="pending", db_index=True)
    target_date = models.DateField(null=True, blank=True, db_index=True)
    expected_date = models.DateField(null=True, blank=True)
    completed_date = models.DateField(null=True, blank=True)
    responsible = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="responsible_tasks",
    )
    remarks = models.TextField(blank=True)
    recurrence = models.CharField(max_length=20, choices=RECURRENCE_CHOICES, default="onetime")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_tasks",
    )

    class Meta:
        ordering = ["target_date", "created_at"]
        verbose_name = "task"
        verbose_name_plural = "tasks"

    def clean(self):
        if not (self.description or "").strip():
            raise ValidationError({"description": "Description is required."})
        if self.completed_date and self.status not in self.COMPLETED_STATUSES:
            raise ValidationError("completed_date should only be set when status is completed or completed_delay.")
        if self.target_date and self.expected_date and self.expected_date < self.target_date:
            raise ValidationError("expected_date cannot be before target_date.")

    def save(self, *args, **kwargs):
        if self.serial_no is None:
            last = Task.objects.order_by("-serial_no").values_list("serial_no", flat=True).first()
            self.serial_no = (last or 0) + 1
        super().save(*args, **kwargs)

    def __str__(self):
        return self.title or f"{self.client} - {self.description[:50]}"


class TaskLog(models.Model):
    # Django attaches these implicitly from the FKs below.
    task_id: int
    changed_by_id: int | None

    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="logs")
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="task_logs",
    )
    # Snapshot of the user's name at the time of the change — survives
    # user deletion, which matters for append-only audit logs.
    changed_by_name = models.CharField(max_length=150, blank=True, default="")
    changed_at = models.DateTimeField(auto_now_add=True)
    changes = models.JSONField(default=list)

    def clean(self):
        from django.core.exceptions import ValidationError

        if not self.changes:
            raise ValidationError("changes must be a non-empty list.")

    def save(self, *args, **kwargs):
        # Snapshot the actor's display name once, when the log is first
        # written. Never overwrite — audit logs are append-only.
        if not self.changed_by_name and self.changed_by_id:
            self.changed_by_name = str(self.changed_by)
        super().save(*args, **kwargs)

    class Meta:
        ordering = ["-changed_at"]
        indexes = [
            models.Index(fields=["task", "-changed_at"], name="tasklog_task_changed_idx"),
        ]
        verbose_name = "task log"
        verbose_name_plural = "task logs"

    def __str__(self):
        return f"TaskLog #{self.task_id}"
