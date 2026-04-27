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


class ClientRoadmap(TimeStampedModel):
    STATUS_CHOICES = [
        ("Not Started", "Not Started"),
        ("In Progress", "In Progress"),
        ("Achieved", "Achieved"),
        ("At Risk", "At Risk"),
        ("Cancelled", "Cancelled"),
    ]
    PRIORITY_CHOICES = [
        ("High", "High"),
        ("Medium", "Medium"),
        ("Low", "Low"),
    ]

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    org = models.ForeignKey(
        "users.Org", null=True, blank=True, on_delete=models.SET_NULL, related_name="client_roadmaps"
    )
    client = models.ForeignKey(
        "masters.Master",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="roadmaps",
        limit_choices_to={"type": "client"},
    )
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="owned_client_roadmaps",
    )
    start_date = models.DateField(null=True, blank=True)
    target_date = models.DateField(null=True, blank=True)
    expected_date = models.DateField(null=True, blank=True)
    completion_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="Not Started", db_index=True)
    priority = models.CharField(max_length=10, choices=PRIORITY_CHOICES, default="Medium")
    progress_notes = models.TextField(blank=True, default="")
    category = models.CharField(max_length=100, blank=True, default="")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_client_roadmaps",
    )

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "client roadmap item"
        verbose_name_plural = "client roadmap items"
        indexes = [
            models.Index(fields=["client", "status"], name="cm_roadmap_client_status_idx"),
            models.Index(fields=["target_date"], name="cm_roadmap_target_idx"),
        ]

    def __str__(self):
        return f"{self.client} — {self.title}"


class ClientMeeting(TimeStampedModel):
    MEETING_TYPE_CHOICES = [
        ("Review", "Review"),
        ("Kickoff", "Kickoff"),
        ("Escalation", "Escalation"),
        ("Strategic", "Strategic"),
        ("Ad-hoc", "Ad-hoc"),
    ]
    MODE_CHOICES = [
        ("In-person", "In-person"),
        ("Video", "Video"),
        ("Phone", "Phone"),
    ]

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    org = models.ForeignKey(
        "users.Org", null=True, blank=True, on_delete=models.SET_NULL, related_name="client_meetings"
    )
    client = models.ForeignKey(
        "masters.Master",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="meetings",
        limit_choices_to={"type": "client"},
    )
    meeting_date = models.DateField(db_index=True)
    meeting_time = models.TimeField(null=True, blank=True)
    meeting_type = models.CharField(max_length=20, choices=MEETING_TYPE_CHOICES, default="Review")
    mode = models.CharField(max_length=20, choices=MODE_CHOICES, default="Video")
    venue = models.CharField(max_length=255, blank=True, default="")
    conducted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="conducted_client_meetings",
    )
    our_attendees = models.ManyToManyField(
        settings.AUTH_USER_MODEL, blank=True, related_name="attended_client_meetings"
    )
    client_attendees = models.JSONField(default=list, blank=True)
    agenda = models.TextField(blank=True, default="")
    minutes = models.TextField(blank=True, default="")
    next_meeting_date = models.DateField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_client_meetings",
    )

    class Meta:
        ordering = ["-meeting_date", "-created_at"]
        verbose_name = "client meeting"
        verbose_name_plural = "client meetings"
        indexes = [
            models.Index(fields=["client", "meeting_date"], name="cm_meeting_client_date_idx"),
        ]

    def __str__(self):
        return f"{self.client} — {self.meeting_date}"


class ClientActionPoint(TimeStampedModel):
    STATUS_CHOICES = [
        ("Open", "Open"),
        ("In Progress", "In Progress"),
        ("Completed", "Completed"),
        ("Cancelled", "Cancelled"),
    ]
    PRIORITY_CHOICES = [
        ("High", "High"),
        ("Medium", "Medium"),
        ("Low", "Low"),
    ]

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    meeting = models.ForeignKey(ClientMeeting, on_delete=models.CASCADE, related_name="action_points")
    description = models.TextField()
    responsibility = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="assigned_client_action_points",
    )
    target_date = models.DateField(null=True, blank=True)
    completion_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="Open", db_index=True)
    priority = models.CharField(max_length=10, choices=PRIORITY_CHOICES, default="Medium")
    remarks = models.TextField(blank=True, default="")
    roadmap_link = models.ForeignKey(
        ClientRoadmap,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="linked_action_points",
    )

    class Meta:
        ordering = ["target_date", "-created_at"]
        verbose_name = "client action point"
        verbose_name_plural = "client action points"
        indexes = [
            models.Index(fields=["meeting", "status"], name="cm_action_meeting_status_idx"),
            models.Index(fields=["target_date"], name="cm_action_target_idx"),
        ]

    def __str__(self):
        # ``self.meeting.pk`` instead of ``self.meeting_id`` because pyright's
        # django-stubs doesn't surface the implicit ``<fk>_id`` column attribute.
        return f"Action #{self.pk} on meeting #{self.meeting.pk}"


class ClientMeetingAttachment(models.Model):
    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    meeting = models.ForeignKey(ClientMeeting, on_delete=models.CASCADE, related_name="attachments")
    file = models.FileField(upload_to="client_meetings/%Y/%m/")
    filename = models.CharField(max_length=255)
    size_bytes = models.PositiveBigIntegerField(default=0)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="uploaded_client_meeting_attachments",
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-uploaded_at"]
        verbose_name = "client meeting attachment"
        verbose_name_plural = "client meeting attachments"

    def __str__(self):
        return self.filename or f"attachment #{self.pk}"


class ClientActionPointAttachment(models.Model):
    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    action_point = models.ForeignKey(ClientActionPoint, on_delete=models.CASCADE, related_name="attachments")
    file = models.FileField(upload_to="client_action_points/%Y/%m/")
    filename = models.CharField(max_length=255)
    size_bytes = models.PositiveBigIntegerField(default=0)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="uploaded_client_action_point_attachments",
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-uploaded_at"]
        verbose_name = "client action point attachment"
        verbose_name_plural = "client action point attachments"

    def __str__(self):
        return self.filename or f"ap-attachment #{self.pk}"
