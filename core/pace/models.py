import uuid

from django.conf import settings
from django.db import models

from core.base import TimeStampedModel


class PaceGoal(TimeStampedModel):
    GOAL_TYPE_CHOICES = [
        ("Result", "Result"),
        ("Skill", "Skill"),
        ("Attitude", "Attitude"),
    ]
    STATUS_CHOICES = [
        ("Not Started", "Not Started"),
        ("In Progress", "In Progress"),
        ("Achieved", "Achieved"),
        ("Needs Attention", "Needs Attention"),
    ]
    PRIORITY_CHOICES = [
        ("Critical", "Critical"),
        ("Development", "Development"),
        ("Stretch", "Stretch"),
    ]
    ICEBERG_LEVEL_CHOICES = [
        ("Skill", "Skill"),
        ("Knowledge", "Knowledge"),
        ("Self-Image", "Self-Image"),
        ("Trait", "Trait"),
        ("Motive", "Motive"),
    ]
    FOCUS_AREA_CHOICES = [
        ("Practice", "Practice"),
        ("Build Habit", "Build Habit"),
        ("Strengthen", "Strengthen"),
        ("Deepen", "Deepen"),
        ("Develop", "Develop"),
        ("Sustain", "Sustain"),
        ("Sustain & Model", "Sustain & Model"),
        ("Sustain & Expand", "Sustain & Expand"),
        ("Channel", "Channel"),
        ("Channel into BD", "Channel into BD"),
        ("Activate Intentionally", "Activate Intentionally"),
        ("Build Urgently", "Build Urgently"),
        ("Build Consistently", "Build Consistently"),
        ("Strengthen Urgently", "Strengthen Urgently"),
        ("Ignite", "Ignite"),
        ("Ignite Immediately", "Ignite Immediately"),
    ]
    FREQUENCY_CHOICES = [
        ("Weekly", "Weekly"),
        ("Monthly", "Monthly"),
        ("Quarterly", "Quarterly"),
        ("45 Days", "45 Days"),
        ("Fortnightly", "Fortnightly"),
    ]

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    org = models.ForeignKey("users.Org", null=True, blank=True, on_delete=models.SET_NULL, related_name="pace_goals")
    profile = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="pace_goals",
    )
    goal_type = models.CharField(max_length=20, choices=GOAL_TYPE_CHOICES, default="Skill")
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="Not Started", db_index=True)
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default="Development")
    current_rating = models.DecimalField(max_digits=4, decimal_places=1, default=0)
    target_rating = models.DecimalField(max_digits=4, decimal_places=1, default=0)
    # Result goal fields
    success_criteria = models.TextField(blank=True)
    frequency = models.CharField(max_length=20, choices=FREQUENCY_CHOICES, blank=True, default="")
    target = models.CharField(max_length=255, blank=True, default="")
    tracking_method = models.TextField(blank=True)
    # Skill goal fields
    learning_action = models.TextField(blank=True)
    completion_by = models.DateField(null=True, blank=True)
    # Attitude goal fields
    iceberg_level = models.CharField(max_length=20, choices=ICEBERG_LEVEL_CHOICES, blank=True, default="")
    focus_area = models.CharField(max_length=30, choices=FOCUS_AREA_CHOICES, blank=True, default="")
    daily_practice = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_pace_goals",
    )

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "pace goal"
        verbose_name_plural = "pace goals"

    def __str__(self):
        return self.title


class PaceGoalReview(models.Model):
    goal_id: int

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    goal = models.ForeignKey(PaceGoal, on_delete=models.CASCADE, related_name="reviews")
    review_date = models.DateField()
    previous_rating = models.IntegerField(default=0)
    new_rating = models.IntegerField(default=0)
    reviewer_name = models.CharField(max_length=150, blank=True, default="")
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="pace_goal_reviews",
    )
    comments = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-review_date", "-created_at"]
        verbose_name = "pace goal review"
        verbose_name_plural = "pace goal reviews"

    def __str__(self):
        return f"Review on goal #{self.goal_id} ({self.review_date})"


class PaceMeeting(TimeStampedModel):
    MEETING_TYPE_CHOICES = [
        ("Strategic", "Strategic"),
        ("Tactical", "Tactical"),
        ("Operational", "Operational"),
    ]
    STATUS_CHOICES = [
        ("Scheduled", "Scheduled"),
        ("In Progress", "In Progress"),
        ("Completed", "Completed"),
        ("Cancelled", "Cancelled"),
    ]

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    org = models.ForeignKey("users.Org", null=True, blank=True, on_delete=models.SET_NULL, related_name="pace_meetings")
    title = models.CharField(max_length=255)
    meeting_type = models.CharField(max_length=20, choices=MEETING_TYPE_CHOICES, db_index=True)
    scheduled_date = models.DateField(db_index=True)
    scheduled_time = models.TimeField(null=True, blank=True)
    duration_minutes = models.PositiveIntegerField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="Scheduled", db_index=True)
    agenda = models.TextField(blank=True)
    minutes = models.TextField(blank=True)
    attendees = models.JSONField(default=list, blank=True)
    action_items = models.JSONField(default=list, blank=True)
    conducted_by = models.CharField(max_length=150, blank=True, default="")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_pace_meetings",
    )

    class Meta:
        ordering = ["-scheduled_date"]
        verbose_name = "pace meeting"
        verbose_name_plural = "pace meetings"

    def __str__(self):
        return self.title


class OperationalStandup(TimeStampedModel):
    # Typing hints so pyright sees the implicit Django attributes.
    id: int
    org_id: int
    profile_id: int

    BREAKTHROUGH_TYPE_CHOICES = [
        ("Breakdown", "Breakdown"),
        ("Breakthrough", "Breakthrough"),
    ]
    STATUS_CHOICES = [
        ("Pending", "Pending"),
        ("Approved", "Approved"),
    ]

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    org = models.ForeignKey("users.Org", on_delete=models.CASCADE, related_name="operational_standups")
    profile = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="operational_standups",
    )
    standup_date = models.DateField(db_index=True)
    breakthrough_type = models.CharField(max_length=20, choices=BREAKTHROUGH_TYPE_CHOICES, blank=True, default="")
    priorities = models.TextField(blank=True)
    collaboration_need = models.TextField(blank=True)
    remarks = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="Pending", db_index=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="operational_standups_created",
    )
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="operational_standups_approved",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="operational_standups_reviewed",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-standup_date", "profile__full_name"]
        constraints = [
            models.UniqueConstraint(
                fields=["org", "profile", "standup_date"],
                name="uniq_op_standup_org_profile_date",
            ),
        ]
        indexes = [
            models.Index(fields=["org", "standup_date"], name="op_standup_org_date_idx"),
            models.Index(fields=["org", "status"], name="op_standup_org_status_idx"),
        ]
        verbose_name = "operational standup"
        verbose_name_plural = "operational standups"

    def __str__(self):
        return f"{self.profile} — {self.standup_date}"


class PaceChecklist(TimeStampedModel):
    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    org = models.ForeignKey(
        "users.Org", null=True, blank=True, on_delete=models.SET_NULL, related_name="pace_checklists"
    )
    fy = models.CharField(max_length=8, db_index=True)  # e.g. "2026-27"
    week_number = models.IntegerField()
    item_number = models.IntegerField()
    action_item = models.TextField()
    done = models.BooleanField(default=False)
    notes = models.TextField(blank=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="pace_checklist_updates",
    )

    class Meta:
        ordering = ["fy", "week_number", "item_number"]
        unique_together = ("org", "fy", "week_number", "item_number")
        indexes = [
            models.Index(fields=["org", "fy", "week_number"], name="pace_checklist_fy_week_idx"),
        ]
        verbose_name = "pace checklist item"
        verbose_name_plural = "pace checklist items"

    def __str__(self):
        return f"FY {self.fy} W{self.week_number}.{self.item_number}"


class ClientClassification(TimeStampedModel):
    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    org = models.ForeignKey(
        "users.Org", null=True, blank=True, on_delete=models.SET_NULL, related_name="client_classifications"
    )
    client = models.ForeignKey(
        "masters.Master",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="client_classifications",
        limit_choices_to={"type": "client"},
    )
    classification = models.CharField(max_length=5, blank=True, default="")
    revenue_tier = models.CharField(max_length=10, blank=True, default="")
    strategic_importance = models.CharField(max_length=20, blank=True, default="")
    relationship_health = models.CharField(max_length=20, blank=True, default="")
    growth_potential = models.CharField(max_length=10, blank=True, default="")
    risk_level = models.CharField(max_length=10, blank=True, default="")
    notes = models.TextField(blank=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="client_classification_updates",
    )

    class Meta:
        ordering = ["client"]
        unique_together = ("org", "client")
        verbose_name = "client classification"
        verbose_name_plural = "client classifications"

    def __str__(self):
        return f"{self.client} ({self.classification})"
