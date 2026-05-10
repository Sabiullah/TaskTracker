import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

from core.base import TimeStampedModel


class Task(TimeStampedModel):
    # Django attaches these implicitly from the parent FK and reverse accessor.
    parent_id: int | None
    responsible_id: int | None
    subtasks: "models.Manager[Task]"

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
    # Nullable so historical rows can stay empty after the column is added.
    # New tasks must populate it — enforced at the serializer layer where
    # we can distinguish create from update.
    reporting_manager = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reporting_manager_tasks",
    )
    remarks = models.TextField(blank=True)
    recurrence = models.CharField(max_length=20, choices=RECURRENCE_CHOICES, default="onetime")
    # Engagement window for this goal. Used to default plan dates and to
    # bound the month-selector dropdown in the Add/Edit Task modal. Nullable
    # so legacy rows without a plan can stay empty.
    engagement_start = models.DateField(null=True, blank=True)
    engagement_end = models.DateField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_tasks",
    )
    parent = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="subtasks",
        db_index=True,
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

        if self.parent_id is not None:
            parent = self.parent
            if parent is not None and parent.parent_id is not None:
                raise ValidationError("Sub-tasks cannot have sub-tasks (two levels max).")
            if parent is not None and parent.target_date and self.target_date and self.target_date > parent.target_date:
                raise ValidationError(
                    {
                        "target_date": (
                            f"Sub-task target date cannot be after the main goal's "
                            f"target date ({parent.target_date.isoformat()})."
                        )
                    }
                )

        if self.parent_id is None and self.pk and self.target_date:
            late = list(self.subtasks.filter(target_date__gt=self.target_date).values_list("serial_no", flat=True))
            if late:
                joined = ", ".join(f"#{s}" for s in late if s is not None)
                desc = joined if joined else f"{len(late)} sub-task(s)"
                raise ValidationError(
                    {"target_date": (f"Cannot move main target date earlier than sub-tasks: {desc}.")}
                )

        # A main goal can't be marked complete while any sub-task is still
        # open. The board UI auto-recomputes status from dates, but a user
        # could still set completed_date on the main directly — block it
        # at the model so the rule holds for every write path.
        if self.parent_id is None and self.pk and self.status in self.COMPLETED_STATUSES:
            open_subs = list(
                self.subtasks.exclude(status__in=self.COMPLETED_STATUSES).values_list("serial_no", flat=True)
            )
            if open_subs:
                joined = ", ".join(f"#{s}" for s in open_subs if s is not None)
                desc = joined if joined else f"{len(open_subs)} sub-task(s)"
                raise ValidationError(
                    {"completed_date": f"Cannot complete the main goal while sub-tasks are open: {desc}."}
                )

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
        # written. Never overwrite — audit logs are append-only. Prefer
        # full_name so the audit shows the human name, not the login slug.
        if not self.changed_by_name and self.changed_by_id and self.changed_by:
            u = self.changed_by
            self.changed_by_name = u.full_name or u.email or u.username
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


class TaskSubcategoryPlan(TimeStampedModel):
    """Per-goal sub-category template. Materializes Task children on-demand
    per month within ``[active_from_month, active_until_month]`` (or open-ended
    if ``active_until_month`` is null). Frozen recurrence/target_day so a
    later edit to the sub-cat master doesn't retro-shift the plan.
    """

    main_task = models.ForeignKey(
        Task,
        on_delete=models.CASCADE,
        related_name="sub_plans",
    )
    subcategory = models.ForeignKey(
        "masters.Master",
        on_delete=models.PROTECT,
        limit_choices_to={"type": "category"},
        related_name="plans",
    )
    recurrence = models.CharField(
        max_length=20,
        choices=Task.RECURRENCE_CHOICES,
        default="monthly",
    )
    target_day = models.PositiveSmallIntegerField(null=True, blank=True)
    default_owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="default_owner_plans",
    )
    # Both stored as the first day of the month (e.g. 2026-05-01) for clean
    # month-arithmetic downstream.
    active_from_month = models.DateField()
    active_until_month = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ["main_task_id", "subcategory_id"]
        unique_together = [("main_task", "subcategory")]
        verbose_name = "task subcategory plan"
        verbose_name_plural = "task subcategory plans"

    def __str__(self):
        return f"Plan(goal={self.main_task_id}, sub={self.subcategory_id})"
