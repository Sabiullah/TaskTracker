import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from core.base import TimeStampedModel


class Master(TimeStampedModel):
    # 'org' removed — orgs live in their own first-class table (users.Org).
    # 'team' removed — team members are User + OrgMembership (see
    # ``drop_team_masters`` management command for the one-time migration).
    TYPE_CHOICES = [
        ("client", "Client"),
        ("category", "Category"),
        ("designation", "Designation"),
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
    # Self-FK so a category master can declare a parent main category. A
    # row with ``parent=None`` and ``type='category'`` is a "main category"
    # surfaced in the goal-level dropdown; rows with a parent are "sub
    # categories" that auto-populate the subtask grid when the user picks
    # the parent in the Add/Edit Task modal. Only meaningful for
    # ``type='category'`` — the field is ignored for clients.
    parent = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="children",
    )
    # Recurrence + target day are only meaningful on sub-categories
    # (parent != None). They drive the occurrence engine in the Add Task
    # modal: given a Start Month, every occurrence between [start, start +
    # engagement_months) becomes one materialised subtask row whose
    # target date is (year, month, target_day) — clamped to the last day
    # of the month for short months. Empty/null values keep the legacy
    # "one row per sub-category, no date" behaviour.
    RECURRENCE_CHOICES = [
        ("Onetime", "One-time"),
        ("Weekly", "Weekly"),
        ("Monthly", "Monthly"),
        ("Quarterly", "Quarterly"),
        ("Halfyearly", "Half-yearly"),
        ("Yearly", "Yearly"),
    ]
    recurrence = models.CharField(
        max_length=20,
        choices=RECURRENCE_CHOICES,
        blank=True,
        default="",
    )
    target_day = models.PositiveSmallIntegerField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="masters",
    )

    class Meta:
        ordering = ["type", "sort_order", "name"]
        # Two unique constraints (replacing the legacy
        # ``unique_together = ("type", "name", "org")``):
        #   - Mains / clients (parent IS NULL): unique on (type, name, org)
        #   - Sub-categories (parent IS NOT NULL): unique on
        #     (type, name, org, parent) — so two different mains can each
        #     have a sub named "Sales" without colliding.
        # Org is included so two tenants can independently have an "Acme"
        # client without conflict. Kept scoped to the legacy ``org`` FK;
        # the M2M ``orgs`` is a sharing fan-out, not an identity field.
        # The actual same-name guard at the API layer lives in
        # ``MasterSerializer.validate`` because DRF's UniqueTogetherValidator
        # skips rows whose unique fields contain a NULL.
        constraints = [
            models.CheckConstraint(
                condition=models.Q(type__in=["client", "category", "designation"]),
                name="master_type_valid",
            ),
            models.UniqueConstraint(
                fields=["type", "name", "org"],
                condition=models.Q(parent__isnull=True),
                name="master_unique_main",
            ),
            models.UniqueConstraint(
                fields=["type", "name", "org", "parent"],
                condition=models.Q(parent__isnull=False),
                name="master_unique_sub",
            ),
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


class ClientVisit(TimeStampedModel):
    STATUS_CHOICES = [
        ("Draft", "Draft"),
        ("Pending", "Pending"),
        ("Approved", "Approved"),
        ("Rejected", "Rejected"),
    ]

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    org = models.ForeignKey("users.Org", null=True, blank=True, on_delete=models.SET_NULL, related_name="client_visits")
    client = models.ForeignKey(
        "masters.Master",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="visits",
        limit_choices_to={"type": "client"},
    )
    visit_date = models.DateField(db_index=True)
    prepared_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="prepared_client_visits",
    )
    assigned_manager = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="assigned_client_visits",
    )
    current_status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="Draft", db_index=True)
    report_sent_date = models.DateField(null=True, blank=True)
    voice_note_sent = models.BooleanField(default=False)
    voice_note_summary = models.TextField(blank=True, default="")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_client_visits",
    )

    class Meta:
        ordering = ["-visit_date", "-created_at"]
        verbose_name = "client visit"
        verbose_name_plural = "client visits"
        indexes = [
            models.Index(fields=["client", "-visit_date"], name="cv_client_date_idx"),
            models.Index(fields=["org", "report_sent_date", "visit_date"], name="cv_overdue_idx"),
            models.Index(fields=["org", "current_status"], name="cv_org_status_idx"),
        ]

    def __str__(self):
        return f"Visit {self.client} {self.visit_date}"


class VisitReport(TimeStampedModel):
    STATUS_CHOICES = [
        ("Draft", "Draft"),
        ("Pending", "Pending"),
        ("Approved", "Approved"),
        ("Rejected", "Rejected"),
    ]

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    visit = models.ForeignKey(ClientVisit, on_delete=models.CASCADE, related_name="reports")
    revision_number = models.PositiveIntegerField()
    key_points = models.TextField(blank=True, default="")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="Draft", db_index=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reviewed_visit_reports",
    )
    manager_comment = models.TextField(blank=True, default="")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="authored_visit_reports",
    )

    class Meta:
        ordering = ["visit", "revision_number"]
        verbose_name = "visit report"
        verbose_name_plural = "visit reports"
        unique_together = (("visit", "revision_number"),)
        constraints = [
            models.CheckConstraint(
                condition=models.Q(revision_number__gte=1),
                name="visit_report_revision_positive",
            ),
        ]

    def __str__(self):
        # Use ``self.visit.pk`` instead of ``self.visit_id`` because pyright's
        # django-stubs doesn't surface the implicit ``<fk>_id`` column attribute
        # (mirrors ``ClientActionPoint.__str__``).
        return f"Report v{self.revision_number} for visit #{self.visit.pk}"


class VisitReportAttachment(models.Model):
    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    report = models.ForeignKey(
        VisitReport,
        on_delete=models.CASCADE,
        related_name="attachments",
    )
    file = models.FileField(upload_to="client_visits/%Y/%m/")
    filename = models.CharField(max_length=255)
    size_bytes = models.PositiveBigIntegerField(default=0)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="uploaded_visit_report_attachments",
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-uploaded_at"]
        verbose_name = "visit report attachment"
        verbose_name_plural = "visit report attachments"

    def __str__(self):
        return self.filename or f"vr-attachment #{self.pk}"


class VisitReportAuditEvent(models.Model):
    EVENT_CHOICES = [
        ("created", "Created"),
        ("submitted", "Submitted"),
        ("approved", "Approved"),
        ("rejected", "Rejected"),
        ("resubmitted", "Resubmitted"),
        ("sent_to_client", "Sent to client"),
        ("voice_note_marked", "Voice note marked"),
    ]

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    visit = models.ForeignKey(ClientVisit, on_delete=models.CASCADE, related_name="audit_events")
    report = models.ForeignKey(
        VisitReport, null=True, blank=True, on_delete=models.SET_NULL, related_name="audit_events"
    )
    event_type = models.CharField(max_length=30, choices=EVENT_CHOICES)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="visit_audit_actions",
    )
    comment = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["visit", "created_at"]
        verbose_name = "visit report audit event"
        verbose_name_plural = "visit report audit events"
        indexes = [
            models.Index(fields=["visit", "created_at"], name="vrae_visit_created_idx"),
        ]

    def __str__(self):
        return f"{self.event_type} on visit #{self.visit.pk}"


def is_visit_overdue(visit: "ClientVisit", today=None) -> bool:
    """A visit is overdue when the manager has not entered ``report_sent_date``
    by the end of ``visit_date + 1`` calendar day. Weekends counted.

    Example: visit on Apr 25 becomes overdue starting Apr 27 (when today - visit_date > 1).
    """
    today = today or timezone.localdate()
    if visit.report_sent_date is not None:
        return False
    return (today - visit.visit_date).days > 1


# ---------------------------------------------------------------------------
# Client Monthly Report
# ---------------------------------------------------------------------------
#
# Per-client monthly deliverable. Author drafts, manager approves/rejects,
# org admin marks reviewed (final). Each (org, client, year_month) carries a
# "required" flag so a manager can decide month-by-month whether a report is
# expected — that flag is what drives the "report required: yes/no" toggle in
# the UI.


class MonthlyReportRequirement(TimeStampedModel):
    """Per (org, client) flag for whether monthly reports are expected.

    The flag persists across months — once a client is marked "required",
    every subsequent month inherits the same value until someone toggles it
    off. Decoupled from the report itself so the UI can show "required:
    yes/no" before any draft exists.
    """

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    org = models.ForeignKey("users.Org", on_delete=models.CASCADE, related_name="monthly_report_requirements")
    client = models.ForeignKey(
        "masters.Master",
        on_delete=models.CASCADE,
        related_name="monthly_report_requirements",
        limit_choices_to={"type": "client"},
    )
    required = models.BooleanField(default=False)
    set_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="set_monthly_report_requirements",
    )

    class Meta:
        ordering = ["client__name"]
        unique_together = (("org", "client"),)
        verbose_name = "monthly report requirement"
        verbose_name_plural = "monthly report requirements"
        indexes = [
            models.Index(fields=["org", "required"], name="mrr_org_required_idx"),
        ]

    def __str__(self):
        return f"{self.client}: {'required' if self.required else 'not required'}"


class ClientMonthlyReport(TimeStampedModel):
    STATUS_CHOICES = [
        ("Draft", "Draft"),
        ("Pending", "Pending"),  # awaiting manager approval
        ("Approved", "Approved"),  # manager approved, awaiting admin review
        ("Reviewed", "Reviewed"),  # admin reviewed — terminal
        ("Rejected", "Rejected"),  # manager rejected — author may edit + resubmit
    ]

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    org = models.ForeignKey(
        "users.Org", null=True, blank=True, on_delete=models.SET_NULL, related_name="client_monthly_reports"
    )
    client = models.ForeignKey(
        "masters.Master",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="monthly_reports",
        limit_choices_to={"type": "client"},
    )
    year_month = models.CharField(max_length=7, db_index=True)  # "YYYY-MM"
    report_date = models.DateField(db_index=True)
    report_name = models.CharField(max_length=255)
    key_points = models.TextField(blank=True, default="")

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="Draft", db_index=True)
    prepared_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="prepared_monthly_reports",
    )
    assigned_manager = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="assigned_monthly_reports",
    )

    submitted_at = models.DateTimeField(null=True, blank=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="approved_monthly_reports",
    )
    manager_comment = models.TextField(blank=True, default="")
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reviewed_monthly_reports",
    )
    review_comment = models.TextField(blank=True, default="")

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_monthly_reports",
    )

    class Meta:
        ordering = ["-year_month", "-report_date", "-created_at"]
        verbose_name = "client monthly report"
        verbose_name_plural = "client monthly reports"
        indexes = [
            models.Index(fields=["client", "year_month"], name="cmr_client_month_idx"),
            models.Index(fields=["org", "year_month", "status"], name="cmr_org_month_status_idx"),
        ]

    def __str__(self):
        return f"Monthly {self.client} {self.year_month}"


class MonthlyReportAttachment(models.Model):
    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    report = models.ForeignKey(
        ClientMonthlyReport,
        on_delete=models.CASCADE,
        related_name="attachments",
    )
    file = models.FileField(upload_to="monthly_reports/%Y/%m/")
    filename = models.CharField(max_length=255)
    size_bytes = models.PositiveBigIntegerField(default=0)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="uploaded_monthly_report_attachments",
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-uploaded_at"]
        verbose_name = "monthly report attachment"
        verbose_name_plural = "monthly report attachments"

    def __str__(self):
        return self.filename or f"mr-attachment #{self.pk}"


class MonthlyReportAuditEvent(models.Model):
    EVENT_CHOICES = [
        ("created", "Created"),
        ("submitted", "Submitted"),
        ("approved", "Approved"),
        ("rejected", "Rejected"),
        ("reviewed", "Reviewed"),
        ("resubmitted", "Resubmitted"),
        ("required_changed", "Requirement changed"),
    ]

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    report = models.ForeignKey(
        ClientMonthlyReport,
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="audit_events",
    )
    event_type = models.CharField(max_length=30, choices=EVENT_CHOICES)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="monthly_report_audit_actions",
    )
    comment = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["report", "created_at"]
        verbose_name = "monthly report audit event"
        verbose_name_plural = "monthly report audit events"
        indexes = [
            models.Index(fields=["report", "created_at"], name="mrae_report_created_idx"),
        ]

    def __str__(self):
        # ``self.report.pk`` instead of ``self.report_id`` because pyright's
        # django-stubs doesn't surface the implicit ``<fk>_id`` column attribute
        # (mirrors ``ClientActionPoint.__str__`` and ``VisitReportAuditEvent.__str__``).
        return f"{self.event_type} on monthly-report #{self.report.pk if self.report else None}"
