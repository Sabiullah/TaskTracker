from django.conf import settings
from django.db import models


class Task(models.Model):
    STATUS_CHOICES = [
        ("Pending", "Pending"),
        ("TodayTask", "TodayTask"),
        ("Tomorrow", "Tomorrow"),
        ("In Progress", "In Progress"),
        ("Completed", "Completed"),
        ("Completed Delay", "Completed Delay"),
        ("Overdue", "Overdue"),
        ("Future Task/Goals", "Future Task/Goals"),
        ("TBC", "TBC"),
        ("Ontime", "Ontime"),
        ("Archived", "Archived"),
    ]
    RECURRENCE_CHOICES = [
        ("Onetime", "Onetime"),
        ("Daily", "Daily"),
        ("Weekly", "Weekly"),
        ("Monthly", "Monthly"),
        ("Quarterly", "Quarterly"),
        ("Halfyearly", "Halfyearly"),
        ("Yearly", "Yearly"),
    ]
    s_no = models.IntegerField(null=True, blank=True)
    client = models.CharField(max_length=255, blank=True)
    category = models.CharField(max_length=100, blank=True)
    description = models.TextField(blank=True)
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default="Pending")
    target_date = models.DateField(null=True, blank=True)
    expected_date = models.DateField(null=True, blank=True)
    comp_date = models.DateField(null=True, blank=True)
    responsible = models.CharField(max_length=150, blank=True)
    remarks = models.TextField(blank=True)
    recurrence = models.CharField(max_length=20, choices=RECURRENCE_CHOICES, default="Onetime")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_tasks",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["s_no", "target_date"]

    def __str__(self):
        return f"{self.client} – {self.description[:50]}"


class WorkLog(models.Model):
    PRIORITY_CHOICES = [
        ("Top Priority", "Top Priority"),
        ("Priority", "Priority"),
        ("Normal", "Normal"),
        ("Not Urgent", "Not Urgent"),
    ]
    name = models.CharField(max_length=150)
    day = models.CharField(max_length=10, blank=True)
    date = models.DateField(null=True, blank=True)
    client = models.CharField(max_length=255, blank=True)
    task_description = models.TextField()
    hours_worked = models.CharField(max_length=10, blank=True, null=True)
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default="Normal")
    sort_order = models.IntegerField(default=0)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["sort_order", "-date", "-created_at"]


class WorkPlan(models.Model):
    assigned_to = models.CharField(max_length=150)
    assigned_to_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="work_plans",
    )
    created_by = models.CharField(max_length=150, blank=True)
    created_by_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_work_plans",
    )
    day = models.CharField(max_length=10, blank=True)
    date = models.DateField(null=True, blank=True)
    client = models.CharField(max_length=255, blank=True)
    task_description = models.TextField()
    planned_hours = models.CharField(max_length=10, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["date"]


class Notice(models.Model):
    STATUS_CHOICES = [
        ("Open", "Open"),
        ("Replied", "Replied"),
        ("Appealed", "Appealed"),
        ("Completed", "Completed"),
    ]
    s_no = models.IntegerField(null=True, blank=True)
    client_name = models.CharField(max_length=255)
    dispute_nature = models.TextField()
    fy = models.CharField(max_length=10, blank=True, null=True)
    notice_replied_date = models.DateField(null=True, blank=True)
    next_target_date = models.DateField(null=True, blank=True)
    remarks = models.TextField(blank=True, null=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="Open")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="notices",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["s_no"]


class LeadStatus(models.Model):
    name = models.CharField(max_length=100, unique=True)
    color = models.CharField(max_length=20, default="#64748b")
    sort_order = models.IntegerField(default=0)

    class Meta:
        ordering = ["sort_order"]


class Lead(models.Model):
    PRIORITY_CHOICES = [("High", "High"), ("Medium", "Medium"), ("Low", "Low")]
    s_no = models.IntegerField(null=True, blank=True)
    client = models.CharField(max_length=255)
    contact_person = models.CharField(max_length=150, blank=True, null=True)
    contact_email = models.EmailField(blank=True, null=True)
    contact_phone = models.CharField(max_length=30, blank=True, null=True)
    lead_source = models.CharField(max_length=100, blank=True, null=True)
    reference_from = models.CharField(max_length=255, blank=True, null=True)
    status = models.CharField(max_length=100, blank=True)
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default="Medium")
    assigned_to = models.CharField(max_length=150, blank=True, null=True)
    estimated_value = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    action_taken = models.TextField(blank=True, null=True)
    next_step = models.TextField(blank=True, null=True)
    next_step_date = models.DateField(null=True, blank=True)
    remarks = models.TextField(blank=True, null=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="leads",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["s_no"]


class LeadFollowup(models.Model):
    lead = models.ForeignKey(Lead, on_delete=models.CASCADE, related_name="followups")
    note = models.TextField()
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class InvoicePlan(models.Model):
    PERIODICITY_CHOICES = [
        ("Monthly", "Monthly"),
        ("Quarterly", "Quarterly"),
        ("Half-yearly", "Half-yearly"),
        ("Yearly", "Yearly"),
    ]
    s_no = models.IntegerField(null=True, blank=True)
    client_name = models.CharField(max_length=255)
    job_description = models.TextField()
    periodicity = models.CharField(max_length=20, choices=PERIODICITY_CHOICES, default="Monthly")
    start_month = models.CharField(max_length=7)  # YYYY-MM
    end_month = models.CharField(max_length=7)  # YYYY-MM
    invoice_day = models.IntegerField(default=1)
    base_amount = models.DecimalField(max_digits=14, decimal_places=2)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="invoice_plans",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["s_no"]


class InvoiceEntry(models.Model):
    STATUS_CHOICES = [
        ("Pending", "Pending"),
        ("Uploaded", "Uploaded"),
        ("Approved", "Approved"),
        ("Rejected", "Rejected"),
    ]
    plan = models.ForeignKey(InvoicePlan, on_delete=models.CASCADE, related_name="entries")
    client_name = models.CharField(max_length=255)
    invoice_month = models.CharField(max_length=7)  # YYYY-MM
    invoice_date = models.DateField(null=True, blank=True)
    amount = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="Pending")
    invoice_number = models.CharField(max_length=100, blank=True, null=True)
    notes = models.TextField(blank=True, null=True)
    file_path = models.CharField(max_length=500, blank=True, null=True)
    file_name = models.CharField(max_length=255, blank=True, null=True)
    rejection_reason = models.TextField(blank=True, null=True)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="uploaded_invoices",
    )
    uploaded_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="approved_invoices",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["invoice_date"]


class ChatRoom(models.Model):
    TYPE_CHOICES = [("direct", "Direct"), ("group", "Group")]
    name = models.CharField(max_length=255, blank=True, null=True)
    type = models.CharField(max_length=10, choices=TYPE_CHOICES, default="direct")
    parent_room = models.ForeignKey("self", null=True, blank=True, on_delete=models.CASCADE, related_name="subrooms")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_rooms",
    )
    created_at = models.DateTimeField(auto_now_add=True)


class ChatMember(models.Model):
    room = models.ForeignKey(ChatRoom, on_delete=models.CASCADE, related_name="members")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="chat_memberships",
    )
    last_read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = ("room", "user")


class ChatMessage(models.Model):
    room = models.ForeignKey(ChatRoom, on_delete=models.CASCADE, related_name="messages")
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="sent_messages",
    )
    message = models.TextField(blank=True, null=True)
    reply_to = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="replies",
    )
    file_path = models.CharField(max_length=500, blank=True, null=True)
    file_name = models.CharField(max_length=255, blank=True, null=True)
    file_type = models.CharField(max_length=100, blank=True, null=True)
    file_size = models.IntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
