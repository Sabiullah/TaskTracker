# Clients — Internal Report Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Internal Report sub-tab to the Clients page so juniors can submit visit observation reports, route them through a manager approval workflow with revision history and audit trail, and track sent-to-client + voice-note delivery.

**Architecture:** A `ClientVisit` parent (immutable post-creation visit metadata + post-approval delivery fields) with a `VisitReport` child per submission attempt (revision chain, frozen on approval) and a `VisitReportAuditEvent` append-only timeline. Two DRF viewsets in `core/masters/` expose CRUD + lifecycle actions (`submit`, `approve`, `reject`, `resubmit`, `sent-info`) with object-level visibility limited to author + assigned manager + org admin. The React UI mirrors the existing MOM tab — grouped by client, descending visit_date — with role-aware action buttons, expandable revision/timeline panels, and toast notifications via the existing realtime broadcast bus.

**Tech Stack:** Django 5 + DRF + django-channels (existing). React + TypeScript + Vite + Vitest. UUID-based public identifiers via `UidLookupMixin`.

**Spec:** `docs/superpowers/specs/2026-04-27-clients-internal-report-design.md`

---

## File Structure

### Backend (`core/masters/`)

| Path | Status | Responsibility |
|---|---|---|
| `models.py` | modify | Add `ClientVisit`, `VisitReport`, `VisitReportAuditEvent` + `is_visit_overdue()` helper |
| `serializers.py` | modify | Add `VisitReportAuditEventSerializer`, `VisitReportSerializer`, `ClientVisitSerializer` (with embedded `reports[]` and `audit_events[]` and computed `is_overdue`) |
| `views.py` | modify | Add `IsVisitParticipant` permission, `ClientVisitViewSet`, `VisitReportViewSet`, `VisitReportAuditEventViewSet`, plus a small `_notify_user()` helper for directed toasts |
| `urls.py` | modify | Register the three new viewsets with the router |
| `migrations/0009_client_visit_report.py` | create | Generated migration creating the three new tables + indexes |
| `tests.py` | modify | Append `ClientVisitTests`, `VisitReportLifecycleTests`, `VisitReportPermissionTests`, `VisitOverdueTests` |

### Frontend (`frontend/task-tracker/src/`)

| Path | Status | Responsibility |
|---|---|---|
| `types/api/internalReports.ts` | create | DTOs (`ClientVisitDto`, `VisitReportDto`, `VisitReportAuditEventDto`, write-shapes, `DirectedNotificationPayload`) |
| `types/api/realtime.ts` | modify | Add `client-visits`, `visit-reports`, `notifications` to the `RealtimeChannel` union |
| `lib/api/internalReports.ts` | create | Fetch wrappers for the new endpoints |
| `lib/api/index.ts` | modify | Re-export the new fetchers from the barrel |
| `hooks/useClientVisits.ts` | create | Data hook: list + mutations + realtime subscription for `client-visits` and `visit-reports` |
| `hooks/useVisitAuditEvents.ts` | create | Per-visit audit fetch hook (used inside expanded row) |
| `hooks/useDirectedNotifications.ts` | create | Subscribes to the `notifications` channel and dispatches toasts for the current user |
| `components/clients/visitOverdue.ts` | create | Pure helper: `isVisitOverdue(visit, today)` (mirrors server rule) |
| `components/clients/internalReportFilters.ts` | create | Pure filter helpers + `isFilterActive()` |
| `components/clients/internalReportGrouping.ts` | create | Pure `groupByClient()` + descending `visit_date` sort |
| `components/clients/ClientInternalReportTab.tsx` | create | Top-level: filters bar + grouped list + modal wiring |
| `components/clients/ClientVisitGroupedView.tsx` | create | Collapsible client groups (mirrors `ClientMOMAllView` shape) |
| `components/clients/ClientVisitRow.tsx` | create | One row per visit; expand → revisions table + sent-info panel + timeline |
| `components/clients/VisitSubmitModal.tsx` | create | Junior form: create / edit-draft / resubmit (single component, three modes) |
| `components/clients/VisitReviewPanel.tsx` | create | Manager Approve / Reject buttons (with comment prompt on reject) |
| `components/clients/VisitSentInfoPanel.tsx` | create | Manager edits sent date + voice note tick + summary |
| `components/clients/VisitTimelinePanel.tsx` | create | Read-only audit-event timeline |
| `pages/ClientsPage.tsx` | modify | Add `internal` to `SubTab` union, add third tab button, render `ClientInternalReportTab` |
| `App.tsx` | modify | Mount `useDirectedNotifications()` once at app root (alongside `ToastHost`) |
| `__tests__/components/clients/internalReportFilters.test.ts` | create | Filter unit tests |
| `__tests__/components/clients/internalReportGrouping.test.ts` | create | Grouping + sort unit tests |
| `__tests__/components/clients/visitOverdue.test.ts` | create | Overdue-rule unit tests (frontend mirror of backend rule) |

### Phasing

The plan is split into 9 phases. Each phase ends with a single commit. Phases 1–4 are backend (model → migration → viewsets/permissions → notifications). Phases 5–8 are frontend (types/data → page integration → modal/forms → notifications). Phase 9 is end-to-end browser verification.

---

## Phase 1 — Data model

### Task 1.1: Add the three new models

**Files:**
- Modify: `core/masters/models.py` (append after `ClientActionPointAttachment`)

- [ ] **Step 1: Append the new models**

Append the following at the bottom of `core/masters/models.py`:

```python
class ClientVisit(TimeStampedModel):
    STATUS_CHOICES = [
        ("Draft", "Draft"),
        ("Pending", "Pending"),
        ("Approved", "Approved"),
        ("Rejected", "Rejected"),
    ]

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    org = models.ForeignKey(
        "users.Org", null=True, blank=True, on_delete=models.SET_NULL, related_name="client_visits"
    )
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
    current_status = models.CharField(
        max_length=20, choices=STATUS_CHOICES, default="Draft", db_index=True
    )
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
    observation_attachment = models.FileField(upload_to="client_visits/%Y/%m/", blank=True, null=True)
    attachment_filename = models.CharField(max_length=255, blank=True, default="")
    attachment_size_bytes = models.PositiveBigIntegerField(default=0)
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
        return f"Report v{self.revision_number} for visit #{self.visit_id}"


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

    def __str__(self):
        return f"{self.event_type} on visit #{self.visit_id}"


def is_visit_overdue(visit: "ClientVisit", today=None) -> bool:
    """A visit is overdue when the manager has not entered ``report_sent_date``
    by the end of ``visit_date + 1`` calendar day. Weekends counted.
    """
    from django.utils import timezone

    today = today or timezone.localdate()
    if visit.report_sent_date is not None:
        return False
    return (today - visit.visit_date).days > 1
```

- [ ] **Step 2: Run the existing test suite to confirm nothing else broke**

Run: `python manage.py test core.masters -v 2`
Expected: existing tests still pass; no new tests yet.

- [ ] **Step 3: Generate the migration**

Run: `python manage.py makemigrations masters --name client_visit_report`
Expected: a new file `core/masters/migrations/0009_client_visit_report.py` is created.

- [ ] **Step 4: Apply the migration locally**

Run: `python manage.py migrate masters`
Expected: `Applying masters.0009_client_visit_report... OK`

- [ ] **Step 5: Commit**

```bash
git add core/masters/models.py core/masters/migrations/0009_client_visit_report.py
git commit -m "feat(clients): add ClientVisit/VisitReport/VisitReportAuditEvent models"
```

### Task 1.2: Unit tests for `is_visit_overdue()`

**Files:**
- Modify: `core/masters/tests.py` (append a new test class at the bottom)

- [ ] **Step 1: Write the failing tests**

Append to `core/masters/tests.py` (the imports `Org`, `OrgMembership`, `User`, `Master`, and `_make_*` helpers already exist near the top of the file — reuse them):

```python
import datetime as _dt

from core.masters.models import ClientVisit, is_visit_overdue


class VisitOverdueTests(TestCase):
    def setUp(self):
        self.org, self.user = _make_org_user("ovduser", role="employee")
        self.client_master = _make_client(self.org)

    def _visit(self, visit_date, sent_date=None) -> ClientVisit:
        return ClientVisit.objects.create(
            org=self.org,
            client=self.client_master,
            visit_date=visit_date,
            prepared_by=self.user,
            report_sent_date=sent_date,
        )

    def test_today_minus_zero_not_overdue(self):
        today = _dt.date(2026, 4, 27)
        v = self._visit(today)
        self.assertFalse(is_visit_overdue(v, today=today))

    def test_today_minus_one_not_overdue(self):
        today = _dt.date(2026, 4, 27)
        v = self._visit(today - _dt.timedelta(days=1))
        self.assertFalse(is_visit_overdue(v, today=today))

    def test_today_minus_two_is_overdue(self):
        today = _dt.date(2026, 4, 27)
        v = self._visit(today - _dt.timedelta(days=2))
        self.assertTrue(is_visit_overdue(v, today=today))

    def test_sent_date_set_means_not_overdue(self):
        today = _dt.date(2026, 4, 27)
        v = self._visit(today - _dt.timedelta(days=10), sent_date=today)
        self.assertFalse(is_visit_overdue(v, today=today))
```

- [ ] **Step 2: Run the new tests to verify they pass**

Run: `python manage.py test core.masters.tests.VisitOverdueTests -v 2`
Expected: 4 passing tests.

- [ ] **Step 3: Commit**

```bash
git add core/masters/tests.py
git commit -m "test(clients): cover is_visit_overdue rule (calendar days, weekends counted)"
```

---

## Phase 2 — Serializers

### Task 2.1: Audit event + report serializers

**Files:**
- Modify: `core/masters/serializers.py` (append after `ClientActionPointSerializer`)

- [ ] **Step 1: Add the new model imports at the top**

Edit the import block at the top of `core/masters/serializers.py` to include the new models:

```python
from .models import (
    ClientActionPoint,
    ClientActionPointAttachment,
    ClientMeeting,
    ClientMeetingAttachment,
    ClientRoadmap,
    ClientVisit,
    Master,
    VisitReport,
    VisitReportAuditEvent,
    is_visit_overdue,
)
```

- [ ] **Step 2: Append `VisitReportAuditEventSerializer` and `VisitReportSerializer`**

Append to the bottom of the file:

```python
class VisitReportAuditEventSerializer(serializers.ModelSerializer):
    actor_detail = UserMinSerializer(source="actor", read_only=True)
    report_uid = serializers.UUIDField(source="report.uid", read_only=True, allow_null=True)
    visit_uid = serializers.UUIDField(source="visit.uid", read_only=True)

    class Meta:
        model = VisitReportAuditEvent
        fields = [
            "id",
            "uid",
            "visit_uid",
            "report_uid",
            "event_type",
            "actor_detail",
            "comment",
            "created_at",
        ]
        read_only_fields = fields


class VisitReportSerializer(serializers.ModelSerializer):
    created_by_detail = UserMinSerializer(source="created_by", read_only=True)
    reviewed_by_detail = UserMinSerializer(source="reviewed_by", read_only=True)
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = VisitReport
        fields = [
            "id",
            "uid",
            "visit",
            "revision_number",
            "key_points",
            "attachment_filename",
            "attachment_size_bytes",
            "status",
            "submitted_at",
            "reviewed_at",
            "reviewed_by_detail",
            "manager_comment",
            "created_by_detail",
            "created_at",
            "updated_at",
            "download_url",
        ]
        read_only_fields = [
            "id",
            "uid",
            "visit",
            "revision_number",
            "attachment_filename",
            "attachment_size_bytes",
            "status",
            "submitted_at",
            "reviewed_at",
            "reviewed_by_detail",
            "manager_comment",
            "created_by_detail",
            "created_at",
            "updated_at",
            "download_url",
        ]

    def get_download_url(self, obj):
        if not obj.observation_attachment:
            return ""
        path = reverse("visit-report-attachment-download", kwargs={"uid": str(obj.uid)})
        request = (self.context or {}).get("request")
        return request.build_absolute_uri(path) if request else path
```

- [ ] **Step 3: Append `ClientVisitSerializer`**

Append:

```python
class ClientVisitSerializer(OrgScopedMixin, serializers.ModelSerializer):
    org = serializers.SlugRelatedField(slug_field="uid", queryset=Org.objects.all(), required=False, allow_null=True)
    org_uid = serializers.UUIDField(source="org.uid", read_only=True, allow_null=True)
    client = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Master.objects.filter(type="client"),
    )
    client_detail = MasterMinSerializer(source="client", read_only=True)
    prepared_by = serializers.SlugRelatedField(
        slug_field="uid", queryset=User.objects.all(), required=False, allow_null=True
    )
    prepared_by_detail = UserMinSerializer(source="prepared_by", read_only=True)
    assigned_manager = serializers.SlugRelatedField(slug_field="uid", queryset=User.objects.all())
    assigned_manager_detail = UserMinSerializer(source="assigned_manager", read_only=True)
    created_by_detail = UserMinSerializer(source="created_by", read_only=True)
    reports = VisitReportSerializer(many=True, read_only=True)
    audit_events = VisitReportAuditEventSerializer(many=True, read_only=True)
    is_overdue = serializers.SerializerMethodField()

    class Meta:
        model = ClientVisit
        fields = [
            "id",
            "uid",
            "org",
            "org_uid",
            "client",
            "client_detail",
            "visit_date",
            "prepared_by",
            "prepared_by_detail",
            "assigned_manager",
            "assigned_manager_detail",
            "current_status",
            "report_sent_date",
            "voice_note_sent",
            "voice_note_summary",
            "created_by_detail",
            "reports",
            "audit_events",
            "is_overdue",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "uid",
            "org_uid",
            "client_detail",
            "prepared_by_detail",
            "assigned_manager_detail",
            "current_status",
            "created_by_detail",
            "reports",
            "audit_events",
            "is_overdue",
            "created_at",
            "updated_at",
        ]

    def get_is_overdue(self, obj) -> bool:
        return is_visit_overdue(obj)

    def validate_assigned_manager(self, value):
        """Assigned manager must be admin/manager in the visit's org."""
        # Org isn't bound yet on create — defer the org check to validate(); for
        # update, ``self.instance.org`` is the source of truth.
        request = (self.context or {}).get("request")
        if request and self.instance is not None:
            target_org = self.instance.org
            if target_org and not value.is_manager_in(target_org):
                raise serializers.ValidationError(
                    "Assigned manager must be admin or manager in this org."
                )
        return value

    def validate(self, attrs):
        # On create, cross-check assigned_manager against the resolved org from
        # the request (resolve_create_org is called in the viewset's
        # perform_create). Re-resolve here so the error fires before save.
        if self.instance is None:
            from core.org_utils import resolve_create_org

            request = (self.context or {}).get("request")
            if request is not None:
                org, _err = resolve_create_org(request)
                manager = attrs.get("assigned_manager")
                if org and manager and not manager.is_manager_in(org):
                    raise serializers.ValidationError(
                        {"assigned_manager": "Must be admin or manager in this org."}
                    )
        return super().validate(attrs)
```

- [ ] **Step 4: Run a sanity import check**

Run: `python -c "from core.masters.serializers import ClientVisitSerializer, VisitReportSerializer, VisitReportAuditEventSerializer; print('ok')"`
Expected: `ok` — confirms no import / syntax errors.

- [ ] **Step 5: Commit**

```bash
git add core/masters/serializers.py
git commit -m "feat(clients): add ClientVisit / VisitReport / audit-event serializers"
```

---

## Phase 3 — Viewsets, permissions, lifecycle actions

### Task 3.1: Add the `IsVisitParticipant` permission class

**Files:**
- Modify: `core/masters/views.py` (add a permission class near the top, alongside other helpers)

- [ ] **Step 1: Add the permission class**

Add this class after the existing module-level helpers in `core/masters/views.py` (e.g. after `_raise_from_response`):

```python
class IsVisitParticipant(permissions.BasePermission):
    """Object-level visibility for ClientVisit / VisitReport / audit events.

    Caller may access the row if any of:
      - they are the visit's ``prepared_by``
      - they are the visit's ``assigned_manager``
      - they are admin in the visit's org
    """

    def has_permission(self, request, view):
        return request.user.is_authenticated

    def has_object_permission(self, request, view, obj):
        user = cast(User, request.user)
        # Resolve the parent visit regardless of which model `obj` is on.
        if hasattr(obj, "visit") and obj.visit is not None:
            visit = obj.visit
        else:
            visit = obj
        return (
            (visit.prepared_by_id == user.id)
            or (visit.assigned_manager_id == user.id)
            or user.is_admin_in(visit.org)
        )
```

Also add the new model + serializer imports to the existing import blocks at the top of `views.py`:

```python
from .models import (
    ClientActionPoint,
    ClientActionPointAttachment,
    ClientMeeting,
    ClientMeetingAttachment,
    ClientRoadmap,
    ClientVisit,
    Master,
    VisitReport,
    VisitReportAuditEvent,
    is_visit_overdue,
)
from .serializers import (
    ClientActionPointAttachmentSerializer,
    ClientActionPointSerializer,
    ClientMeetingAttachmentSerializer,
    ClientMeetingSerializer,
    ClientRoadmapSerializer,
    ClientVisitSerializer,
    MasterSerializer,
    VisitReportAuditEventSerializer,
    VisitReportSerializer,
)
```

- [ ] **Step 2: Sanity import**

Run: `python -c "from core.masters.views import IsVisitParticipant; print('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit (intermediate — keeps the diff small)**

```bash
git add core/masters/views.py
git commit -m "feat(clients): add IsVisitParticipant object-level permission"
```

### Task 3.2: Add the `_notify_user()` helper

**Files:**
- Modify: `core/masters/views.py` (add helper after `_stream_attachment`)

- [ ] **Step 1: Add the helper**

Append this helper after the existing `_stream_attachment` function in `core/masters/views.py`:

```python
def _notify_user(to_user, kind: str, title: str, body: str, link: dict | None = None) -> None:
    """Push a directed in-app toast via the realtime ``notifications`` channel.

    Best-effort — broadcast failures are swallowed inside ``broadcast()``.
    Skipped silently when ``to_user`` is None (e.g. assigned_manager nulled out).
    """
    if to_user is None:
        return
    broadcast(
        "notifications",
        "INSERT",
        {
            "to_user_uid": str(to_user.uid),
            "kind": kind,
            "title": title,
            "body": body,
            "link": link or {},
        },
    )
```

- [ ] **Step 2: Sanity import**

Run: `python -c "from core.masters.views import _notify_user; print('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add core/masters/views.py
git commit -m "feat(clients): add _notify_user helper for directed toasts"
```

### Task 3.3: Add `ClientVisitViewSet` (list + create + sent-info action)

**Files:**
- Modify: `core/masters/views.py` (append after `ClientActionPointAttachmentViewSet`)

- [ ] **Step 1: Append the viewset**

Append to the bottom of `core/masters/views.py`:

```python
class ClientVisitViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = ClientVisitSerializer
    permission_classes = [permissions.IsAuthenticated, IsVisitParticipant]
    parser_classes = [JSONParser, FormParser, MultiPartParser]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        from django.db.models import Q
        from django.utils import timezone

        user = cast(User, self.request.user)
        org_ids = list(user.org_ids())
        # Visibility: author OR assigned_manager OR admin-in-org. Admins see
        # everything in their orgs. Managers and employees see their own
        # involvement (assigned + authored).
        admin_org_ids = list(
            user.memberships.filter(role="admin").values_list("org_id", flat=True)
        )
        qs = (
            ClientVisit.objects.select_related("client", "prepared_by", "assigned_manager", "org", "created_by")
            .prefetch_related("reports__reviewed_by", "reports__created_by", "audit_events__actor")
            .filter(org_id__in=org_ids)
        )
        qs = qs.filter(
            Q(org_id__in=admin_org_ids)
            | Q(prepared_by_id=user.id)
            | Q(assigned_manager_id=user.id)
        ).distinct()

        params = self.request.query_params
        client_uid = params.get("client_uid")
        prepared_by_uids = params.getlist("prepared_by_uid")
        assigned_manager_uids = params.getlist("assigned_manager_uid")
        statuses = params.getlist("status")
        visit_month = params.get("visit_month")
        date_from = params.get("date_from")
        date_to = params.get("date_to")
        overdue = params.get("overdue")

        if client_uid:
            qs = qs.filter(client__uid=client_uid)
        if prepared_by_uids:
            qs = qs.filter(prepared_by__uid__in=prepared_by_uids)
        if assigned_manager_uids:
            qs = qs.filter(assigned_manager__uid__in=assigned_manager_uids)
        if statuses:
            qs = qs.filter(current_status__in=statuses)
        if visit_month:
            try:
                year, month = visit_month.split("-")
                qs = qs.filter(visit_date__year=int(year), visit_date__month=int(month))
            except (ValueError, AttributeError):
                pass
        if date_from:
            qs = qs.filter(visit_date__gte=date_from)
        if date_to:
            qs = qs.filter(visit_date__lte=date_to)
        if overdue == "true":
            today = timezone.localdate()
            cutoff = today - datetime.timedelta(days=1)
            qs = qs.filter(report_sent_date__isnull=True, visit_date__lt=cutoff)

        return qs.order_by("client_id", "-visit_date")

    def perform_create(self, serializer):
        from django.db import transaction
        from django.utils import timezone

        org, err = resolve_create_org(self.request)
        if err is not None:
            _raise_from_response(err)

        # Multipart payloads put non-file fields here too — pop the report bits
        # off the serializer's validated_data so they don't slip into the visit.
        validated = serializer.validated_data
        key_points = self.request.data.get("key_points", "")
        upload = self.request.FILES.get("observation_attachment")

        with transaction.atomic():
            visit = serializer.save(
                created_by=self.request.user,
                prepared_by=self.request.user,
                org=org,
                current_status="Draft",
            )
            report = VisitReport.objects.create(
                visit=visit,
                revision_number=1,
                key_points=key_points,
                observation_attachment=upload,
                attachment_filename=upload.name if upload else "",
                attachment_size_bytes=(upload.size or 0) if upload else 0,
                status="Draft",
                created_by=self.request.user,
            )
            VisitReportAuditEvent.objects.create(
                visit=visit,
                report=report,
                event_type="created",
                actor=self.request.user,
            )
        broadcast(
            "client-visits",
            "INSERT",
            ClientVisitSerializer(visit, context={"request": self.request}).data,
        )

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast(
            "client-visits",
            "UPDATE",
            ClientVisitSerializer(obj, context={"request": self.request}).data,
        )

    def perform_destroy(self, instance):
        # Authors may delete only while the entire visit is still in Draft;
        # admins of the org may delete at any time. Managers cannot delete.
        user = cast(User, self.request.user)
        is_admin = user.is_admin_in(instance.org)
        is_author_draft = (
            instance.prepared_by_id == user.id and instance.current_status == "Draft"
        )
        if not (is_admin or is_author_draft):
            raise PermissionDenied("Only admins, or the author while still Draft, may delete.")
        broadcast("client-visits", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()

    @action(detail=True, methods=["patch"], url_path="sent-info")
    def sent_info(self, request, uid=None):
        from django.db import transaction
        from django.utils import timezone

        visit = self.get_object()
        user = cast(User, request.user)
        if not (user.is_admin_in(visit.org) or visit.assigned_manager_id == user.id):
            raise PermissionDenied("Only the assigned manager or an org admin may edit sent-info.")
        # Must have an Approved report.
        if not visit.reports.filter(status="Approved").exists():
            raise ValidationError({"detail": "Visit has no Approved report yet."})

        previous_sent = visit.report_sent_date
        previous_voice = visit.voice_note_sent

        with transaction.atomic():
            for field in ("report_sent_date", "voice_note_sent", "voice_note_summary"):
                if field in request.data:
                    setattr(visit, field, request.data.get(field))
            visit.save(update_fields=[
                "report_sent_date",
                "voice_note_sent",
                "voice_note_summary",
                "updated_at",
            ])
            if previous_sent is None and visit.report_sent_date is not None:
                VisitReportAuditEvent.objects.create(
                    visit=visit, event_type="sent_to_client", actor=user
                )
            if not previous_voice and visit.voice_note_sent:
                VisitReportAuditEvent.objects.create(
                    visit=visit, event_type="voice_note_marked", actor=user
                )

        broadcast(
            "client-visits",
            "UPDATE",
            ClientVisitSerializer(visit, context={"request": request}).data,
        )
        return Response(ClientVisitSerializer(visit, context={"request": request}).data)
```

Add `import datetime` to the top of `views.py` if it isn't already there.

- [ ] **Step 2: Sanity import**

Run: `python -c "from core.masters.views import ClientVisitViewSet; print('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add core/masters/views.py
git commit -m "feat(clients): add ClientVisitViewSet (list+create+sent-info)"
```

### Task 3.4: Add `VisitReportViewSet` with lifecycle actions

**Files:**
- Modify: `core/masters/views.py` (append after `ClientVisitViewSet`)

- [ ] **Step 1: Append the viewset**

Append:

```python
class VisitReportViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = VisitReportSerializer
    permission_classes = [permissions.IsAuthenticated, IsVisitParticipant]
    parser_classes = [JSONParser, FormParser, MultiPartParser]
    http_method_names = ["get", "patch", "post", "head", "options"]

    def get_queryset(self):
        from django.db.models import Q

        user = cast(User, self.request.user)
        org_ids = list(user.org_ids())
        admin_org_ids = list(
            user.memberships.filter(role="admin").values_list("org_id", flat=True)
        )
        qs = (
            VisitReport.objects.select_related("visit", "visit__client", "visit__org", "reviewed_by", "created_by")
            .filter(visit__org_id__in=org_ids)
        )
        return qs.filter(
            Q(visit__org_id__in=admin_org_ids)
            | Q(visit__prepared_by_id=user.id)
            | Q(visit__assigned_manager_id=user.id)
        ).distinct()

    def update(self, request, *args, **kwargs):
        # Allow PATCH only on Draft / Pending and only by the author of the report.
        report = self.get_object()
        user = cast(User, request.user)
        if report.created_by_id != user.id:
            raise PermissionDenied("Only the report author may edit.")
        if report.status not in ("Draft", "Pending"):
            raise PermissionDenied("Report is frozen — only Draft / Pending reports can be edited.")

        # Apply the editable fields explicitly. The serializer marks these as
        # read-only because most fields are; bypass via direct write.
        if "key_points" in request.data:
            report.key_points = request.data.get("key_points", "")
        upload = request.FILES.get("observation_attachment")
        if upload:
            report.observation_attachment = upload
            report.attachment_filename = upload.name
            report.attachment_size_bytes = upload.size or 0
        report.save()
        broadcast(
            "visit-reports",
            "UPDATE",
            VisitReportSerializer(report, context={"request": request}).data,
        )
        return Response(VisitReportSerializer(report, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="submit")
    def submit(self, request, uid=None):
        from django.db import transaction
        from django.utils import timezone

        report = self.get_object()
        user = cast(User, request.user)
        if report.created_by_id != user.id:
            raise PermissionDenied("Only the report author may submit.")
        if report.status != "Draft":
            raise ValidationError({"detail": f"Cannot submit a report in status {report.status!r}."})

        with transaction.atomic():
            report.status = "Pending"
            report.submitted_at = timezone.now()
            report.save(update_fields=["status", "submitted_at", "updated_at"])
            visit = report.visit
            visit.current_status = "Pending"
            visit.save(update_fields=["current_status", "updated_at"])
            VisitReportAuditEvent.objects.create(
                visit=visit, report=report, event_type="submitted", actor=user
            )
        broadcast(
            "client-visits",
            "UPDATE",
            ClientVisitSerializer(visit, context={"request": request}).data,
        )
        broadcast(
            "visit-reports",
            "UPDATE",
            VisitReportSerializer(report, context={"request": request}).data,
        )
        _notify_user(
            visit.assigned_manager,
            kind="visit_report_submitted",
            title="New report awaiting your approval",
            body=f"{user.full_name or user.username} submitted a report for "
            f"{visit.client.name if visit.client else 'a client'} ({visit.visit_date})",
            link={"tab": "internal", "visit_uid": str(visit.uid)},
        )
        return Response(VisitReportSerializer(report, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request, uid=None):
        return self._review(request, decision="Approved")

    @action(detail=True, methods=["post"], url_path="reject")
    def reject(self, request, uid=None):
        return self._review(request, decision="Rejected")

    def _review(self, request, decision: str):
        from django.db import transaction
        from django.utils import timezone

        report = self.get_object()
        user = cast(User, request.user)
        visit = report.visit
        # Assigned manager OR org admin may act.
        if not (visit.assigned_manager_id == user.id or user.is_admin_in(visit.org)):
            raise PermissionDenied("Only the assigned manager or an org admin may review.")
        if report.status != "Pending":
            raise ValidationError({"detail": f"Cannot {decision.lower()} a report in status {report.status!r}."})

        comment = (request.data.get("manager_comment") or "").strip()
        if decision == "Rejected" and not comment:
            raise ValidationError({"manager_comment": "Comment is required when rejecting."})

        with transaction.atomic():
            report.status = decision
            report.reviewed_at = timezone.now()
            report.reviewed_by = user
            report.manager_comment = comment
            report.save(update_fields=[
                "status", "reviewed_at", "reviewed_by", "manager_comment", "updated_at",
            ])
            visit.current_status = decision
            visit.save(update_fields=["current_status", "updated_at"])
            VisitReportAuditEvent.objects.create(
                visit=visit,
                report=report,
                event_type="approved" if decision == "Approved" else "rejected",
                actor=user,
                comment=comment,
            )
        broadcast(
            "client-visits",
            "UPDATE",
            ClientVisitSerializer(visit, context={"request": request}).data,
        )
        broadcast(
            "visit-reports",
            "UPDATE",
            VisitReportSerializer(report, context={"request": request}).data,
        )
        client_name = visit.client.name if visit.client else "a client"
        if decision == "Approved":
            _notify_user(
                report.created_by,
                kind="visit_report_approved",
                title="Your report was approved",
                body=f"Your report for {client_name} ({visit.visit_date}) was approved.",
                link={"tab": "internal", "visit_uid": str(visit.uid)},
            )
        else:
            _notify_user(
                report.created_by,
                kind="visit_report_rejected",
                title="Your report was rejected",
                body=f"Your report for {client_name} ({visit.visit_date}) was rejected — see comment.",
                link={"tab": "internal", "visit_uid": str(visit.uid)},
            )
        return Response(VisitReportSerializer(report, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="resubmit")
    def resubmit(self, request, uid=None):
        from django.db import transaction

        latest = self.get_object()
        user = cast(User, request.user)
        visit = latest.visit
        if latest.created_by_id != user.id:
            raise PermissionDenied("Only the report author may resubmit.")
        # Latest revision must be the one being resubmitted AND must be Rejected.
        true_latest = visit.reports.order_by("-revision_number").first()
        if true_latest is None or true_latest.id != latest.id:
            raise ValidationError({"detail": "Resubmit only from the latest revision."})
        if latest.status != "Rejected":
            raise ValidationError({"detail": "Only Rejected reports can be resubmitted."})

        key_points = request.data.get("key_points", "")
        upload = request.FILES.get("observation_attachment")

        with transaction.atomic():
            new_rev = VisitReport.objects.create(
                visit=visit,
                revision_number=latest.revision_number + 1,
                key_points=key_points,
                observation_attachment=upload,
                attachment_filename=upload.name if upload else "",
                attachment_size_bytes=(upload.size or 0) if upload else 0,
                status="Draft",
                created_by=user,
            )
            visit.current_status = "Draft"
            visit.save(update_fields=["current_status", "updated_at"])
            VisitReportAuditEvent.objects.create(
                visit=visit, report=new_rev, event_type="resubmitted", actor=user
            )
        broadcast(
            "client-visits",
            "UPDATE",
            ClientVisitSerializer(visit, context={"request": request}).data,
        )
        broadcast(
            "visit-reports",
            "INSERT",
            VisitReportSerializer(new_rev, context={"request": request}).data,
        )
        return Response(
            VisitReportSerializer(new_rev, context={"request": request}).data, status=201
        )

    @action(detail=True, methods=["get"], url_path="attachment/download")
    def attachment_download(self, request, uid=None):
        from django.http import Http404

        report = self.get_object()
        if not report.observation_attachment:
            raise Http404("No attachment")
        return _stream_attachment(report.observation_attachment, report.attachment_filename, request)
```

- [ ] **Step 2: Sanity import**

Run: `python -c "from core.masters.views import VisitReportViewSet; print('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add core/masters/views.py
git commit -m "feat(clients): add VisitReportViewSet with submit/approve/reject/resubmit"
```

### Task 3.5: Add `VisitReportAuditEventViewSet` (read-only)

**Files:**
- Modify: `core/masters/views.py` (append)

- [ ] **Step 1: Append the viewset**

Append:

```python
class VisitReportAuditEventViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = VisitReportAuditEventSerializer
    permission_classes = [permissions.IsAuthenticated, IsVisitParticipant]
    http_method_names = ["get", "head", "options"]

    def get_queryset(self):
        from django.db.models import Q

        user = cast(User, self.request.user)
        org_ids = list(user.org_ids())
        admin_org_ids = list(
            user.memberships.filter(role="admin").values_list("org_id", flat=True)
        )
        qs = (
            VisitReportAuditEvent.objects.select_related("visit", "visit__org", "actor", "report")
            .filter(visit__org_id__in=org_ids)
        )
        qs = qs.filter(
            Q(visit__org_id__in=admin_org_ids)
            | Q(visit__prepared_by_id=user.id)
            | Q(visit__assigned_manager_id=user.id)
        ).distinct()
        visit_uid = self.request.query_params.get("visit_uid")
        if visit_uid:
            qs = qs.filter(visit__uid=visit_uid)
        return qs.order_by("created_at")
```

- [ ] **Step 2: Sanity import**

Run: `python -c "from core.masters.views import VisitReportAuditEventViewSet; print('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add core/masters/views.py
git commit -m "feat(clients): add read-only VisitReportAuditEventViewSet"
```

### Task 3.6: Register routes

**Files:**
- Modify: `core/masters/urls.py`

- [ ] **Step 1: Update the imports + router registrations**

Replace `core/masters/urls.py` with:

```python
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    ClientActionPointAttachmentViewSet,
    ClientActionPointViewSet,
    ClientMeetingAttachmentViewSet,
    ClientMeetingViewSet,
    ClientRoadmapViewSet,
    ClientVisitViewSet,
    MasterViewSet,
    VisitReportAuditEventViewSet,
    VisitReportViewSet,
)

router = DefaultRouter()
router.register("masters", MasterViewSet, basename="master")
router.register("client-roadmap", ClientRoadmapViewSet, basename="client-roadmap")
router.register("client-meetings", ClientMeetingViewSet, basename="client-meeting")
router.register("client-action-points", ClientActionPointViewSet, basename="client-action-point")
router.register("client-attachments", ClientMeetingAttachmentViewSet, basename="client-attachment")
router.register(
    "client-ap-attachments",
    ClientActionPointAttachmentViewSet,
    basename="client-ap-attachment",
)
router.register("client-visits", ClientVisitViewSet, basename="client-visit")
router.register("visit-reports", VisitReportViewSet, basename="visit-report")
router.register(
    "visit-audit-events",
    VisitReportAuditEventViewSet,
    basename="visit-audit-event",
)

urlpatterns = [path("", include(router.urls))]
```

- [ ] **Step 2: Verify Django can resolve the new routes**

Run: `python manage.py show_urls 2>&1 | grep client-visit | head -5`

If `show_urls` is not installed, use this fallback:
`python -c "from django.urls import reverse; print(reverse('client-visit-list'))"`
Expected: prints `/api/client-visits/` (no exceptions).

Also check the action download URL the serializer references:
`python -c "from django.urls import reverse; print(reverse('visit-report-attachment-download', kwargs={'uid':'00000000-0000-0000-0000-000000000000'}))"`
Expected: prints a URL like `/api/visit-reports/<uuid>/attachment/download/`.

- [ ] **Step 3: Commit**

```bash
git add core/masters/urls.py
git commit -m "feat(clients): register Internal Report viewsets in the router"
```

### Task 3.7: Backend lifecycle tests

**Files:**
- Modify: `core/masters/tests.py` (append a new test class block at the bottom)

- [ ] **Step 1: Append the lifecycle tests**

Append:

```python
class VisitReportLifecycleTests(TestCase):
    def setUp(self):
        self.org, self.admin = _make_org_user("admin_lc", role="admin")
        self.junior = User.objects.create_user(username="jr1", password="pw", full_name="Junior 1")
        OrgMembership.objects.create(user=self.junior, org=self.org, role="employee")
        self.manager = User.objects.create_user(username="mgr1", password="pw", full_name="Mgr 1")
        OrgMembership.objects.create(user=self.manager, org=self.org, role="manager")
        self.client_master = _make_client(self.org)

        self.api = APIClient()

    def _create_visit_as_junior(self, **overrides):
        self.api.force_authenticate(self.junior)
        payload = {
            "client": str(self.client_master.uid),
            "visit_date": "2026-04-25",
            "assigned_manager": str(self.manager.uid),
            "key_points": "ok",
        }
        payload.update(overrides)
        return self.api.post("/api/client-visits/", payload, format="multipart")

    def test_create_visit_creates_initial_report_in_draft(self):
        res = self._create_visit_as_junior()
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(ClientVisit.objects.count(), 1)
        visit = ClientVisit.objects.get()
        self.assertEqual(visit.reports.count(), 1)
        report = visit.reports.get()
        self.assertEqual(report.revision_number, 1)
        self.assertEqual(report.status, "Draft")
        self.assertEqual(visit.current_status, "Draft")
        self.assertEqual(visit.audit_events.count(), 1)
        self.assertEqual(visit.audit_events.get().event_type, "created")

    def test_submit_then_approve_full_flow(self):
        res = self._create_visit_as_junior()
        report_uid = res.data["reports"][0]["uid"]
        # Submit (still as junior)
        r2 = self.api.post(f"/api/visit-reports/{report_uid}/submit/", {}, format="json")
        self.assertEqual(r2.status_code, 200, r2.data)
        # Approve as the manager
        self.api.force_authenticate(self.manager)
        r3 = self.api.post(f"/api/visit-reports/{report_uid}/approve/", {}, format="json")
        self.assertEqual(r3.status_code, 200, r3.data)
        report = VisitReport.objects.get(uid=report_uid)
        self.assertEqual(report.status, "Approved")
        self.assertEqual(report.visit.current_status, "Approved")
        self.assertEqual(
            list(report.visit.audit_events.order_by("created_at").values_list("event_type", flat=True)),
            ["created", "submitted", "approved"],
        )

    def test_reject_requires_comment(self):
        res = self._create_visit_as_junior()
        report_uid = res.data["reports"][0]["uid"]
        self.api.post(f"/api/visit-reports/{report_uid}/submit/", {}, format="json")
        self.api.force_authenticate(self.manager)
        r = self.api.post(
            f"/api/visit-reports/{report_uid}/reject/", {"manager_comment": ""}, format="json"
        )
        self.assertEqual(r.status_code, 400, r.data)
        self.assertIn("manager_comment", r.data)

    def test_resubmit_creates_new_revision(self):
        res = self._create_visit_as_junior()
        first_uid = res.data["reports"][0]["uid"]
        self.api.post(f"/api/visit-reports/{first_uid}/submit/", {}, format="json")
        self.api.force_authenticate(self.manager)
        self.api.post(
            f"/api/visit-reports/{first_uid}/reject/",
            {"manager_comment": "missing photos"},
            format="json",
        )
        self.api.force_authenticate(self.junior)
        r = self.api.post(
            f"/api/visit-reports/{first_uid}/resubmit/",
            {"key_points": "with photos"},
            format="multipart",
        )
        self.assertEqual(r.status_code, 201, r.data)
        visit = VisitReport.objects.get(uid=first_uid).visit
        self.assertEqual(visit.reports.count(), 2)
        latest = visit.reports.order_by("-revision_number").first()
        self.assertEqual(latest.revision_number, 2)
        self.assertEqual(latest.status, "Draft")

    def test_cannot_edit_approved_report(self):
        res = self._create_visit_as_junior()
        report_uid = res.data["reports"][0]["uid"]
        self.api.post(f"/api/visit-reports/{report_uid}/submit/", {}, format="json")
        self.api.force_authenticate(self.manager)
        self.api.post(f"/api/visit-reports/{report_uid}/approve/", {}, format="json")
        self.api.force_authenticate(self.junior)
        r = self.api.patch(
            f"/api/visit-reports/{report_uid}/",
            {"key_points": "changed after approval"},
            format="json",
        )
        self.assertEqual(r.status_code, 403, r.data)

    def test_sent_info_requires_approved_report(self):
        res = self._create_visit_as_junior()
        visit_uid = res.data["uid"]
        self.api.force_authenticate(self.manager)
        r = self.api.patch(
            f"/api/client-visits/{visit_uid}/sent-info/",
            {"report_sent_date": "2026-04-26"},
            format="json",
        )
        self.assertEqual(r.status_code, 400, r.data)


class VisitReportPermissionTests(TestCase):
    def setUp(self):
        self.org, self.admin = _make_org_user("admin_perm", role="admin")
        self.junior_a = User.objects.create_user(username="jra", password="pw", full_name="Jr A")
        self.junior_b = User.objects.create_user(username="jrb", password="pw", full_name="Jr B")
        for u in (self.junior_a, self.junior_b):
            OrgMembership.objects.create(user=u, org=self.org, role="employee")
        self.manager = User.objects.create_user(username="mgr_perm", password="pw", full_name="Mgr")
        OrgMembership.objects.create(user=self.manager, org=self.org, role="manager")
        self.other_manager = User.objects.create_user(
            username="othermgr", password="pw", full_name="OM"
        )
        OrgMembership.objects.create(user=self.other_manager, org=self.org, role="manager")
        self.client_master = _make_client(self.org)
        self.api = APIClient()

    def _make_visit(self, prepared_by, assigned_manager):
        self.api.force_authenticate(prepared_by)
        return self.api.post(
            "/api/client-visits/",
            {
                "client": str(self.client_master.uid),
                "visit_date": "2026-04-25",
                "assigned_manager": str(assigned_manager.uid),
                "key_points": "x",
            },
            format="multipart",
        )

    def test_other_junior_cannot_see_report(self):
        self._make_visit(self.junior_a, self.manager)
        self.api.force_authenticate(self.junior_b)
        res = self.api.get("/api/client-visits/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data, [])

    def test_other_manager_not_assigned_cannot_approve(self):
        res = self._make_visit(self.junior_a, self.manager)
        report_uid = res.data["reports"][0]["uid"]
        self.api.force_authenticate(self.junior_a)
        self.api.post(f"/api/visit-reports/{report_uid}/submit/", {}, format="json")
        self.api.force_authenticate(self.other_manager)
        r = self.api.post(f"/api/visit-reports/{report_uid}/approve/", {}, format="json")
        # Either 403 (visibility) or 404 (filtered out of queryset). Both valid.
        self.assertIn(r.status_code, (403, 404))

    def test_admin_can_approve_any_report(self):
        res = self._make_visit(self.junior_a, self.manager)
        report_uid = res.data["reports"][0]["uid"]
        self.api.force_authenticate(self.junior_a)
        self.api.post(f"/api/visit-reports/{report_uid}/submit/", {}, format="json")
        self.api.force_authenticate(self.admin)
        r = self.api.post(f"/api/visit-reports/{report_uid}/approve/", {}, format="json")
        self.assertEqual(r.status_code, 200, r.data)
```

- [ ] **Step 2: Run the new tests**

Run: `python manage.py test core.masters.tests.VisitReportLifecycleTests core.masters.tests.VisitReportPermissionTests -v 2`
Expected: all tests pass.

- [ ] **Step 3: Run the entire `core.masters` test suite to confirm no regression**

Run: `python manage.py test core.masters -v 2`
Expected: all tests pass (existing + new).

- [ ] **Step 4: Commit**

```bash
git add core/masters/tests.py
git commit -m "test(clients): cover Internal Report lifecycle + permission rules"
```

---

## Phase 4 — API smoke check (manual, no commit)

The full backend ships at the end of Phase 3. Before moving to the frontend, do a quick interactive sanity check.

### Task 4.1: Manual smoke

- [ ] **Step 1: Start the dev server**

Run: `python manage.py runserver 0.0.0.0:8000`
Leave it running in a separate terminal.

- [ ] **Step 2: Check the routes responded**

In another shell:
`curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer <yourtoken>" http://localhost:8000/api/client-visits/`
Expected: `200` (an empty list `[]`) for an authenticated user with no visits.

If you don't have a token to hand, skip; the unit tests already cover the surface.

- [ ] **Step 3: Stop the server before continuing**

`Ctrl-C` in the runserver terminal.

(No commit — this is a smoke check.)

---

## Phase 5 — Frontend types + API client

### Task 5.1: Add the new realtime channel names

**Files:**
- Modify: `frontend/task-tracker/src/types/api/realtime.ts`

- [ ] **Step 1: Extend the `RealtimeChannel` union**

Edit the union — add three entries at the end (before `"leave"` is fine; preserve trailing semicolon):

```ts
export type RealtimeChannel =
  // ... (existing)
  | "client-meetings"
  | "client-action-points"
  | "client-visits"
  | "visit-reports"
  | "notifications"
  | "conveyance-entries"
  | "leave";
```

- [ ] **Step 2: Type-check**

Run: `cd frontend/task-tracker && npm run -s typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add frontend/task-tracker/src/types/api/realtime.ts
git commit -m "feat(clients): add client-visits / visit-reports / notifications channels"
```

### Task 5.2: Add the DTO types

**Files:**
- Create: `frontend/task-tracker/src/types/api/internalReports.ts`

- [ ] **Step 1: Write the file**

```ts
import type { MasterDto } from "./master";

export interface UserMinDto {
  readonly id: number;
  readonly uid: string;
  readonly full_name: string;
  readonly username: string;
  readonly avatar_color?: string;
}

export type VisitStatus = "Draft" | "Pending" | "Approved" | "Rejected";

export type VisitAuditEventType =
  | "created"
  | "submitted"
  | "approved"
  | "rejected"
  | "resubmitted"
  | "sent_to_client"
  | "voice_note_marked";

export interface VisitReportAuditEventDto {
  readonly id: number;
  readonly uid: string;
  readonly visit_uid: string;
  readonly report_uid: string | null;
  readonly event_type: VisitAuditEventType;
  readonly actor_detail: UserMinDto | null;
  readonly comment: string;
  readonly created_at: string;
}

export interface VisitReportDto {
  readonly id: number;
  readonly uid: string;
  readonly visit: number;
  readonly revision_number: number;
  readonly key_points: string;
  readonly attachment_filename: string;
  readonly attachment_size_bytes: number;
  readonly status: VisitStatus;
  readonly submitted_at: string | null;
  readonly reviewed_at: string | null;
  readonly reviewed_by_detail: UserMinDto | null;
  readonly manager_comment: string;
  readonly created_by_detail: UserMinDto | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly download_url: string;
}

export interface ClientVisitDto {
  readonly id: number;
  readonly uid: string;
  readonly org_uid: string | null;
  readonly client: string | null;
  readonly client_detail: Pick<MasterDto, "id" | "uid" | "name" | "type" | "color"> | null;
  readonly visit_date: string;
  readonly prepared_by: string | null;
  readonly prepared_by_detail: UserMinDto | null;
  readonly assigned_manager: string | null;
  readonly assigned_manager_detail: UserMinDto | null;
  readonly current_status: VisitStatus;
  readonly report_sent_date: string | null;
  readonly voice_note_sent: boolean;
  readonly voice_note_summary: string;
  readonly created_by_detail: UserMinDto | null;
  readonly reports: readonly VisitReportDto[];
  readonly audit_events: readonly VisitReportAuditEventDto[];
  readonly is_overdue: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ClientVisitCreateForm {
  readonly client: string;
  readonly visit_date: string;
  readonly assigned_manager: string;
  readonly key_points: string;
  readonly observation_attachment?: File | null;
  readonly org?: string;
}

export interface VisitReportEditForm {
  readonly key_points?: string;
  readonly observation_attachment?: File | null;
}

export interface VisitSentInfoForm {
  readonly report_sent_date?: string | null;
  readonly voice_note_sent?: boolean;
  readonly voice_note_summary?: string;
}

export interface DirectedNotificationPayload {
  readonly to_user_uid: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  readonly link?: { tab?: string; visit_uid?: string };
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend/task-tracker && npm run -s typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add frontend/task-tracker/src/types/api/internalReports.ts
git commit -m "feat(clients): add Internal Report DTO types"
```

### Task 5.3: Add the API fetch wrappers

**Files:**
- Create: `frontend/task-tracker/src/lib/api/internalReports.ts`
- Modify: `frontend/task-tracker/src/lib/api/index.ts`

- [ ] **Step 1: Write the fetchers**

Create `frontend/task-tracker/src/lib/api/internalReports.ts`:

```ts
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPatchForm,
  apiPost,
  apiPostForm,
  type RequestQuery,
} from "./client";
import type {
  ClientVisitDto,
  ClientVisitCreateForm,
  VisitReportDto,
  VisitReportAuditEventDto,
  VisitReportEditForm,
  VisitSentInfoForm,
} from "@/types/api/internalReports";

export interface ListVisitsQuery extends RequestQuery {
  client_uid?: string;
  prepared_by_uid?: string | string[];
  assigned_manager_uid?: string | string[];
  status?: string | string[];
  visit_month?: string;
  date_from?: string;
  date_to?: string;
  overdue?: "true";
}

export const listVisits = (query?: ListVisitsQuery) =>
  apiGet<ClientVisitDto[]>("/client-visits/", query);

export const getVisit = (uid: string) =>
  apiGet<ClientVisitDto>(`/client-visits/${uid}/`);

export const createVisit = (form: ClientVisitCreateForm) => {
  const fd = new FormData();
  fd.append("client", form.client);
  fd.append("visit_date", form.visit_date);
  fd.append("assigned_manager", form.assigned_manager);
  fd.append("key_points", form.key_points);
  if (form.observation_attachment) {
    fd.append("observation_attachment", form.observation_attachment);
  }
  if (form.org) fd.append("org", form.org);
  return apiPostForm<ClientVisitDto>("/client-visits/", fd);
};

export const deleteVisit = (uid: string) => apiDelete(`/client-visits/${uid}/`);

export const updateSentInfo = (uid: string, form: VisitSentInfoForm) =>
  apiPatch<ClientVisitDto>(`/client-visits/${uid}/sent-info/`, form);

export const editReport = (uid: string, form: VisitReportEditForm) => {
  const fd = new FormData();
  if (form.key_points !== undefined) fd.append("key_points", form.key_points);
  if (form.observation_attachment) {
    fd.append("observation_attachment", form.observation_attachment);
  }
  return apiPatchForm<VisitReportDto>(`/visit-reports/${uid}/`, fd);
};

export const submitReport = (uid: string) =>
  apiPost<VisitReportDto>(`/visit-reports/${uid}/submit/`, {});

export const approveReport = (uid: string) =>
  apiPost<VisitReportDto>(`/visit-reports/${uid}/approve/`, {});

export const rejectReport = (uid: string, manager_comment: string) =>
  apiPost<VisitReportDto>(`/visit-reports/${uid}/reject/`, { manager_comment });

export const resubmitReport = (uid: string, form: VisitReportEditForm) => {
  const fd = new FormData();
  if (form.key_points !== undefined) fd.append("key_points", form.key_points);
  if (form.observation_attachment) {
    fd.append("observation_attachment", form.observation_attachment);
  }
  return apiPostForm<VisitReportDto>(`/visit-reports/${uid}/resubmit/`, fd);
};

export const listAuditEvents = (visit_uid: string) =>
  apiGet<VisitReportAuditEventDto[]>("/visit-audit-events/", { visit_uid });
```

- [ ] **Step 2: Re-export from the barrel**

Append to `frontend/task-tracker/src/lib/api/index.ts`:

```ts
export {
  approveReport,
  createVisit,
  deleteVisit,
  editReport,
  getVisit,
  listAuditEvents,
  listVisits,
  rejectReport,
  resubmitReport,
  submitReport,
  updateSentInfo,
  type ListVisitsQuery,
} from "./internalReports";
```

- [ ] **Step 3: Type-check**

Run: `cd frontend/task-tracker && npm run -s typecheck`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add frontend/task-tracker/src/lib/api/internalReports.ts frontend/task-tracker/src/lib/api/index.ts
git commit -m "feat(clients): add Internal Report fetch wrappers"
```

---

## Phase 6 — Frontend hooks

### Task 6.1: `useClientVisits` data hook

**Files:**
- Create: `frontend/task-tracker/src/hooks/useClientVisits.ts`

- [ ] **Step 1: Write the hook**

```ts
import { useCallback, useEffect, useState } from "react";
import {
  approveReport,
  createVisit,
  deleteVisit,
  editReport,
  listVisits,
  rejectReport,
  resubmitReport,
  submitReport,
  updateSentInfo,
  ws,
  type ListVisitsQuery,
} from "@/lib/api";
import type {
  ClientVisitCreateForm,
  ClientVisitDto,
  VisitReportEditForm,
  VisitSentInfoForm,
} from "@/types/api/internalReports";

export interface UseClientVisitsReturn {
  visits: ClientVisitDto[];
  loading: boolean;
  reload: (q?: ListVisitsQuery) => Promise<void>;
  createNew: (form: ClientVisitCreateForm) => Promise<ClientVisitDto>;
  removeVisit: (uid: string) => Promise<void>;
  setSentInfo: (uid: string, form: VisitSentInfoForm) => Promise<ClientVisitDto>;
  editDraft: (reportUid: string, form: VisitReportEditForm) => Promise<void>;
  submit: (reportUid: string) => Promise<void>;
  approve: (reportUid: string) => Promise<void>;
  reject: (reportUid: string, comment: string) => Promise<void>;
  resubmit: (reportUid: string, form: VisitReportEditForm) => Promise<void>;
}

export function useClientVisits(initialQuery?: ListVisitsQuery): UseClientVisitsReturn {
  const [visits, setVisits] = useState<ClientVisitDto[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (q?: ListVisitsQuery) => {
    const data = await listVisits(q ?? initialQuery);
    setVisits(data);
  }, [initialQuery]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reload();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    // INSERT/UPDATE/DELETE on visits — patch the local list when we have it.
    const unsubVisits = ws.subscribe<ClientVisitDto>("client-visits", (evt) => {
      if (evt.event === "INSERT" && evt.record) {
        const next = evt.record;
        setVisits((prev) => (prev.some((v) => v.uid === next.uid) ? prev : [next, ...prev]));
      } else if (evt.event === "UPDATE" && evt.record) {
        const next = evt.record;
        setVisits((prev) => prev.map((v) => (v.uid === next.uid ? next : v)));
      } else if (evt.event === "DELETE" && evt.record) {
        const recId = (evt.record as { uid?: string }).uid;
        setVisits((prev) => prev.filter((v) => v.uid !== recId));
      }
    });
    // visit-reports updates: mutate the embedded report inside the parent visit
    // we already hold; if we don't hold it, refetch the list.
    const unsubReports = ws.subscribe<{ uid: string; visit: number }>("visit-reports", () => {
      void reload();
    });

    return () => {
      cancelled = true;
      unsubVisits();
      unsubReports();
    };
  }, [reload]);

  const createNew = async (form: ClientVisitCreateForm) => {
    const created = await createVisit(form);
    setVisits((prev) => [created, ...prev]);
    return created;
  };

  const removeVisit = async (uid: string) => {
    await deleteVisit(uid);
    setVisits((prev) => prev.filter((v) => v.uid !== uid));
  };

  const setSentInfo = async (uid: string, form: VisitSentInfoForm) => {
    const updated = await updateSentInfo(uid, form);
    setVisits((prev) => prev.map((v) => (v.uid === uid ? updated : v)));
    return updated;
  };

  const editDraft = async (reportUid: string, form: VisitReportEditForm) => {
    await editReport(reportUid, form);
    await reload();
  };
  const submit = async (reportUid: string) => {
    await submitReport(reportUid);
    await reload();
  };
  const approve = async (reportUid: string) => {
    await approveReport(reportUid);
    await reload();
  };
  const reject = async (reportUid: string, comment: string) => {
    await rejectReport(reportUid, comment);
    await reload();
  };
  const resubmit = async (reportUid: string, form: VisitReportEditForm) => {
    await resubmitReport(reportUid, form);
    await reload();
  };

  return {
    visits,
    loading,
    reload,
    createNew,
    removeVisit,
    setSentInfo,
    editDraft,
    submit,
    approve,
    reject,
    resubmit,
  };
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend/task-tracker && npm run -s typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add frontend/task-tracker/src/hooks/useClientVisits.ts
git commit -m "feat(clients): add useClientVisits data hook"
```

### Task 6.2: `useVisitAuditEvents` hook

**Files:**
- Create: `frontend/task-tracker/src/hooks/useVisitAuditEvents.ts`

- [ ] **Step 1: Write the hook**

```ts
import { useCallback, useEffect, useState } from "react";
import { listAuditEvents } from "@/lib/api";
import type { VisitReportAuditEventDto } from "@/types/api/internalReports";

export function useVisitAuditEvents(visitUid: string | null) {
  const [events, setEvents] = useState<VisitReportAuditEventDto[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!visitUid) return;
    setLoading(true);
    try {
      setEvents(await listAuditEvents(visitUid));
    } finally {
      setLoading(false);
    }
  }, [visitUid]);

  useEffect(() => { void reload(); }, [reload]);
  return { events, loading, reload };
}
```

- [ ] **Step 2: Type-check & commit**

Run: `cd frontend/task-tracker && npm run -s typecheck`
Expected: passes.

```bash
git add frontend/task-tracker/src/hooks/useVisitAuditEvents.ts
git commit -m "feat(clients): add useVisitAuditEvents hook"
```

### Task 6.3: `useDirectedNotifications` toast bridge

**Files:**
- Create: `frontend/task-tracker/src/hooks/useDirectedNotifications.ts`
- Modify: `frontend/task-tracker/src/App.tsx` (mount the hook once at app root)

- [ ] **Step 1: Write the hook**

```ts
import { useEffect } from "react";
import { ws } from "@/lib/api";
import { toast } from "@/lib/toast";
import type { DirectedNotificationPayload } from "@/types/api/internalReports";
import { useAuth } from "@/hooks/useAuth";

/**
 * Subscribes to the realtime ``notifications`` channel and pops a toast for
 * messages addressed to the current user. Mount once at the app root.
 *
 * The ``link`` payload is currently informational — clicking the toast cannot
 * yet deep-link to a specific visit. A follow-up can wire that up via a small
 * router helper; for v1 the toast text alone is enough.
 */
export function useDirectedNotifications(): void {
  const { profile } = useAuth();
  const myUid = profile?.id;
  useEffect(() => {
    if (!myUid) return;
    const unsub = ws.subscribe<DirectedNotificationPayload>("notifications", (evt) => {
      if (evt.event !== "INSERT" || !evt.record) return;
      if (evt.record.to_user_uid !== myUid) return;
      toast.show(`${evt.record.title} — ${evt.record.body}`, "ok");
    });
    return unsub;
  }, [myUid]);
}
```

If `useAuth` exposes `profile` differently, swap to whatever yields the
current user's `uid`. Verify by:

`cd frontend/task-tracker && grep -RIn "export.*useAuth" src/hooks`

Adjust the destructured field name accordingly so `myUid` ends up being the
current user's UID string.

- [ ] **Step 2: Mount the hook in `App.tsx`**

Open `frontend/task-tracker/src/App.tsx` and add the import + a call to the
hook inside the existing root component (next to where `<ToastHost />` is
rendered). Example shape:

```tsx
import { useDirectedNotifications } from "@/hooks/useDirectedNotifications";

export default function App() {
  useDirectedNotifications();
  // ... existing return (...)
}
```

- [ ] **Step 3: Type-check & commit**

Run: `cd frontend/task-tracker && npm run -s typecheck`
Expected: passes.

```bash
git add frontend/task-tracker/src/hooks/useDirectedNotifications.ts frontend/task-tracker/src/App.tsx
git commit -m "feat(clients): add useDirectedNotifications toast bridge"
```

---

## Phase 7 — Frontend pure helpers + tests

### Task 7.1: `visitOverdue` helper + tests

**Files:**
- Create: `frontend/task-tracker/src/components/clients/visitOverdue.ts`
- Create: `frontend/task-tracker/src/__tests__/components/clients/visitOverdue.test.ts`

- [ ] **Step 1: Write the failing test first**

`frontend/task-tracker/src/__tests__/components/clients/visitOverdue.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isVisitOverdue } from "@/components/clients/visitOverdue";

const TODAY = new Date("2026-04-27");

function visit(visit_date: string, report_sent_date: string | null = null) {
  return { visit_date, report_sent_date };
}

describe("isVisitOverdue", () => {
  it("returns false on visit day", () => {
    expect(isVisitOverdue(visit("2026-04-27"), TODAY)).toBe(false);
  });
  it("returns false the next day", () => {
    expect(isVisitOverdue(visit("2026-04-26"), TODAY)).toBe(false);
  });
  it("returns true two days later", () => {
    expect(isVisitOverdue(visit("2026-04-25"), TODAY)).toBe(true);
  });
  it("returns false when sent date is set", () => {
    expect(isVisitOverdue(visit("2026-04-10", "2026-04-20"), TODAY)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/components/clients/visitOverdue.test.ts`
Expected: 4 failing tests (`isVisitOverdue` not found).

- [ ] **Step 3: Implement the helper**

`frontend/task-tracker/src/components/clients/visitOverdue.ts`:

```ts
/**
 * Mirror of the backend rule (``core.masters.models.is_visit_overdue``):
 * overdue when sent_date is null AND today - visit_date > 1 calendar day.
 * Weekends are counted; this is a strict 1-day SLA.
 */
export interface OverdueShape {
  readonly visit_date: string;
  readonly report_sent_date: string | null;
}

export function isVisitOverdue(visit: OverdueShape, today: Date = new Date()): boolean {
  if (visit.report_sent_date) return false;
  // Parse YYYY-MM-DD as a local date so the diff isn't off-by-one in some TZs.
  const [y, m, d] = visit.visit_date.split("-").map((s) => parseInt(s, 10));
  const visitDay = new Date(y, m - 1, d);
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffMs = todayDay.getTime() - visitDay.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return diffDays > 1;
}
```

- [ ] **Step 4: Run tests — should pass**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/components/clients/visitOverdue.test.ts`
Expected: 4 passing tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/components/clients/visitOverdue.ts frontend/task-tracker/src/__tests__/components/clients/visitOverdue.test.ts
git commit -m "feat(clients): add isVisitOverdue helper mirroring backend rule"
```

### Task 7.2: `internalReportFilters` helper + tests

**Files:**
- Create: `frontend/task-tracker/src/components/clients/internalReportFilters.ts`
- Create: `frontend/task-tracker/src/__tests__/components/clients/internalReportFilters.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  isInternalReportFilterActive,
  visitMatches,
  type InternalReportFilters,
} from "@/components/clients/internalReportFilters";
import type { ClientVisitDto } from "@/types/api/internalReports";

function visit(overrides: Partial<ClientVisitDto> = {}): ClientVisitDto {
  return {
    id: 1,
    uid: "v-1",
    org_uid: "org-1",
    client: "c-1",
    client_detail: { id: 10, uid: "c-1", name: "Acme", type: "client", color: "" },
    visit_date: "2026-04-25",
    prepared_by: "u-1",
    prepared_by_detail: null,
    assigned_manager: "u-2",
    assigned_manager_detail: null,
    current_status: "Pending",
    report_sent_date: null,
    voice_note_sent: false,
    voice_note_summary: "",
    created_by_detail: null,
    reports: [],
    audit_events: [],
    is_overdue: false,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

const empty: InternalReportFilters = {
  preparedByUids: [],
  assignedManagerUids: [],
  statuses: [],
  visitMonth: "",
  overdueOnly: false,
};

describe("isInternalReportFilterActive", () => {
  it("returns false when nothing is set", () => {
    expect(isInternalReportFilterActive(empty)).toBe(false);
  });
  it("returns true when status filter is non-empty", () => {
    expect(isInternalReportFilterActive({ ...empty, statuses: ["Pending"] })).toBe(true);
  });
  it("returns true when overdueOnly is true", () => {
    expect(isInternalReportFilterActive({ ...empty, overdueOnly: true })).toBe(true);
  });
});

describe("visitMatches", () => {
  it("matches when all filters empty", () => {
    expect(visitMatches(visit(), empty)).toBe(true);
  });
  it("excludes when prepared_by uid is filtered out", () => {
    expect(
      visitMatches(visit({ prepared_by: "u-1" }), { ...empty, preparedByUids: ["u-99"] }),
    ).toBe(false);
  });
  it("excludes when status is filtered out", () => {
    expect(
      visitMatches(visit({ current_status: "Approved" }), { ...empty, statuses: ["Pending"] }),
    ).toBe(false);
  });
  it("includes when visit_month matches", () => {
    expect(visitMatches(visit({ visit_date: "2026-04-25" }), { ...empty, visitMonth: "2026-04" })).toBe(true);
  });
  it("excludes when visit_month does not match", () => {
    expect(visitMatches(visit({ visit_date: "2026-03-25" }), { ...empty, visitMonth: "2026-04" })).toBe(false);
  });
  it("includes only overdue when overdueOnly is true", () => {
    expect(visitMatches(visit({ is_overdue: true }), { ...empty, overdueOnly: true })).toBe(true);
    expect(visitMatches(visit({ is_overdue: false }), { ...empty, overdueOnly: true })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — should fail**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/components/clients/internalReportFilters.test.ts`
Expected: failures (`isInternalReportFilterActive` not found).

- [ ] **Step 3: Implement the helper**

`frontend/task-tracker/src/components/clients/internalReportFilters.ts`:

```ts
import type { ClientVisitDto, VisitStatus } from "@/types/api/internalReports";

export interface InternalReportFilters {
  preparedByUids: string[];
  assignedManagerUids: string[];
  statuses: VisitStatus[] | string[];
  visitMonth: string; // "YYYY-MM" or empty
  overdueOnly: boolean;
}

export function isInternalReportFilterActive(f: InternalReportFilters): boolean {
  return (
    f.preparedByUids.length > 0
    || f.assignedManagerUids.length > 0
    || f.statuses.length > 0
    || f.visitMonth !== ""
    || f.overdueOnly
  );
}

export function visitMatches(v: ClientVisitDto, f: InternalReportFilters): boolean {
  if (f.preparedByUids.length && (!v.prepared_by || !f.preparedByUids.includes(v.prepared_by))) {
    return false;
  }
  if (
    f.assignedManagerUids.length
    && (!v.assigned_manager || !f.assignedManagerUids.includes(v.assigned_manager))
  ) {
    return false;
  }
  if (f.statuses.length && !f.statuses.includes(v.current_status)) return false;
  if (f.visitMonth) {
    const ym = v.visit_date.slice(0, 7); // "YYYY-MM"
    if (ym !== f.visitMonth) return false;
  }
  if (f.overdueOnly && !v.is_overdue) return false;
  return true;
}
```

- [ ] **Step 4: Run tests — should pass**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/components/clients/internalReportFilters.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/components/clients/internalReportFilters.ts frontend/task-tracker/src/__tests__/components/clients/internalReportFilters.test.ts
git commit -m "feat(clients): add internalReportFilters helper + tests"
```

### Task 7.3: `internalReportGrouping` helper + tests

**Files:**
- Create: `frontend/task-tracker/src/components/clients/internalReportGrouping.ts`
- Create: `frontend/task-tracker/src/__tests__/components/clients/internalReportGrouping.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { groupVisitsByClient } from "@/components/clients/internalReportGrouping";
import type { ClientVisitDto } from "@/types/api/internalReports";

function v(client_uid: string, visit_date: string, name: string): ClientVisitDto {
  return {
    id: 0, uid: `${client_uid}-${visit_date}`, org_uid: null,
    client: client_uid,
    client_detail: { id: 0, uid: client_uid, name, type: "client", color: "" },
    visit_date,
    prepared_by: null, prepared_by_detail: null,
    assigned_manager: null, assigned_manager_detail: null,
    current_status: "Draft", report_sent_date: null,
    voice_note_sent: false, voice_note_summary: "",
    created_by_detail: null,
    reports: [], audit_events: [],
    is_overdue: false,
    created_at: "", updated_at: "",
  };
}

describe("groupVisitsByClient", () => {
  it("groups by client and sorts visits by descending date inside each group", () => {
    const groups = groupVisitsByClient([
      v("c-1", "2026-04-10", "Acme"),
      v("c-2", "2026-04-15", "Globex"),
      v("c-1", "2026-04-25", "Acme"),
    ]);
    expect(groups).toHaveLength(2);
    const acme = groups.find((g) => g.clientUid === "c-1")!;
    expect(acme.visits.map((x) => x.visit_date)).toEqual(["2026-04-25", "2026-04-10"]);
  });

  it("buckets visits with no client_detail under 'unassigned'", () => {
    const orphan = v("", "2026-04-25", "");
    const orphan2: ClientVisitDto = { ...orphan, client: null, client_detail: null };
    const groups = groupVisitsByClient([orphan2]);
    expect(groups[0].clientUid).toBe("unassigned");
  });
});
```

- [ ] **Step 2: Run — should fail**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/components/clients/internalReportGrouping.test.ts`
Expected: failures.

- [ ] **Step 3: Implement**

`frontend/task-tracker/src/components/clients/internalReportGrouping.ts`:

```ts
import type { ClientVisitDto } from "@/types/api/internalReports";

export interface VisitGroup {
  readonly clientUid: string;
  readonly clientName: string;
  readonly visits: ClientVisitDto[];
}

export function groupVisitsByClient(visits: readonly ClientVisitDto[]): VisitGroup[] {
  const map = new Map<string, VisitGroup>();
  for (const v of visits) {
    const uid = v.client ?? "unassigned";
    const name = v.client_detail?.name ?? "Unassigned";
    const existing = map.get(uid);
    if (existing) {
      existing.visits.push(v);
    } else {
      map.set(uid, { clientUid: uid, clientName: name, visits: [v] });
    }
  }
  for (const g of map.values()) {
    g.visits.sort((a, b) => (a.visit_date < b.visit_date ? 1 : a.visit_date > b.visit_date ? -1 : 0));
  }
  // Stable client order: by name asc.
  return [...map.values()].sort((a, b) => a.clientName.localeCompare(b.clientName));
}
```

- [ ] **Step 4: Run — should pass**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/components/clients/internalReportGrouping.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/components/clients/internalReportGrouping.ts frontend/task-tracker/src/__tests__/components/clients/internalReportGrouping.test.ts
git commit -m "feat(clients): add groupVisitsByClient helper + tests"
```

---

## Phase 8 — UI components + page integration

### Task 8.1: `VisitTimelinePanel`

**Files:**
- Create: `frontend/task-tracker/src/components/clients/VisitTimelinePanel.tsx`

- [ ] **Step 1: Write the component**

```tsx
import type { VisitReportAuditEventDto } from "@/types/api/internalReports";

interface Props {
  events: readonly VisitReportAuditEventDto[];
}

const LABELS: Record<VisitReportAuditEventDto["event_type"], string> = {
  created: "Visit created",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
  resubmitted: "Resubmitted",
  sent_to_client: "Sent to client",
  voice_note_marked: "Voice note marked sent",
};

export default function VisitTimelinePanel({ events }: Props) {
  if (!events.length) return <div style={{ color: "#64748b" }}>No events yet.</div>;
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 13 }}>
      {events.map((e) => (
        <li key={e.uid} style={{ padding: "4px 0", borderBottom: "1px solid #f1f5f9" }}>
          <span style={{ color: "#64748b" }}>{new Date(e.created_at).toLocaleString()}</span>
          {" — "}
          <strong>{LABELS[e.event_type] ?? e.event_type}</strong>
          {e.actor_detail ? <> by {e.actor_detail.full_name}</> : null}
          {e.comment ? <> — &ldquo;{e.comment}&rdquo;</> : null}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Type-check & commit**

```bash
cd frontend/task-tracker && npm run -s typecheck
```

```bash
git add frontend/task-tracker/src/components/clients/VisitTimelinePanel.tsx
git commit -m "feat(clients): add VisitTimelinePanel"
```

### Task 8.2: `VisitSentInfoPanel`

**Files:**
- Create: `frontend/task-tracker/src/components/clients/VisitSentInfoPanel.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState } from "react";
import type { ClientVisitDto, VisitSentInfoForm } from "@/types/api/internalReports";

interface Props {
  visit: ClientVisitDto;
  canEdit: boolean;
  onSave: (form: VisitSentInfoForm) => Promise<void>;
}

export default function VisitSentInfoPanel({ visit, canEdit, onSave }: Props) {
  const [sentDate, setSentDate] = useState<string>(visit.report_sent_date ?? "");
  const [voice, setVoice] = useState<boolean>(visit.voice_note_sent);
  const [summary, setSummary] = useState<string>(visit.voice_note_summary);
  const [saving, setSaving] = useState(false);

  const dirty =
    sentDate !== (visit.report_sent_date ?? "")
    || voice !== visit.voice_note_sent
    || summary !== visit.voice_note_summary;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 13 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        Report sent date
        <input
          type="date"
          disabled={!canEdit}
          value={sentDate}
          onChange={(e) => setSentDate(e.target.value)}
          style={{ padding: 6, border: "1px solid #cbd5e1", borderRadius: 6 }}
        />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 6, alignSelf: "end" }}>
        <input
          type="checkbox"
          disabled={!canEdit}
          checked={voice}
          onChange={(e) => setVoice(e.target.checked)}
        />
        Voice note sent
      </label>
      <label style={{ gridColumn: "1 / span 2", display: "flex", flexDirection: "column", gap: 4 }}>
        Voice note summary
        <textarea
          disabled={!canEdit}
          rows={2}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          style={{ padding: 6, border: "1px solid #cbd5e1", borderRadius: 6 }}
        />
      </label>
      {canEdit && (
        <div style={{ gridColumn: "1 / span 2" }}>
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave({
                  report_sent_date: sentDate || null,
                  voice_note_sent: voice,
                  voice_note_summary: summary,
                });
              } finally {
                setSaving(false);
              }
            }}
            style={{
              padding: "6px 12px",
              background: dirty ? "#2563eb" : "#94a3b8",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: dirty ? "pointer" : "default",
            }}
          >
            {saving ? "Saving…" : "Save sent info"}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check & commit**

```bash
cd frontend/task-tracker && npm run -s typecheck
git add frontend/task-tracker/src/components/clients/VisitSentInfoPanel.tsx
git commit -m "feat(clients): add VisitSentInfoPanel"
```

### Task 8.3: `VisitReviewPanel`

**Files:**
- Create: `frontend/task-tracker/src/components/clients/VisitReviewPanel.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState } from "react";

interface Props {
  onApprove: () => Promise<void>;
  onReject: (comment: string) => Promise<void>;
}

export default function VisitReviewPanel({ onApprove, onReject }: Props) {
  const [showRejectBox, setShowRejectBox] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  if (showRejectBox) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
        <textarea
          placeholder="Reason for rejection (required)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          style={{ padding: 6, border: "1px solid #cbd5e1", borderRadius: 6 }}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            disabled={!comment.trim() || busy}
            onClick={async () => {
              setBusy(true);
              try { await onReject(comment.trim()); } finally { setBusy(false); }
            }}
            style={{ padding: "6px 12px", background: "#b91c1c", color: "#fff", border: "none", borderRadius: 6 }}
          >
            Confirm reject
          </button>
          <button
            type="button"
            onClick={() => { setShowRejectBox(false); setComment(""); }}
            style={{ padding: "6px 12px", background: "#f1f5f9", border: "none", borderRadius: 6 }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try { await onApprove(); } finally { setBusy(false); }
        }}
        style={{ padding: "6px 12px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
      >
        ✓ Approve
      </button>
      <button
        type="button"
        onClick={() => setShowRejectBox(true)}
        style={{ padding: "6px 12px", background: "#fee2e2", color: "#b91c1c", border: "1px solid #fecaca", borderRadius: 6, cursor: "pointer" }}
      >
        ✗ Reject…
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Type-check & commit**

```bash
cd frontend/task-tracker && npm run -s typecheck
git add frontend/task-tracker/src/components/clients/VisitReviewPanel.tsx
git commit -m "feat(clients): add VisitReviewPanel"
```

### Task 8.4: `VisitSubmitModal`

**Files:**
- Create: `frontend/task-tracker/src/components/clients/VisitSubmitModal.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useState } from "react";
import type { MasterItem } from "@/types";
import type { Profile } from "@/types/auth";

export interface SubmitModalCreatePayload {
  mode: "create";
  client: string;
  visit_date: string;
  assigned_manager: string;
  key_points: string;
  observation_attachment: File | null;
  submitImmediately: boolean;
}

export interface SubmitModalEditPayload {
  mode: "edit";
  reportUid: string;
  key_points: string;
  observation_attachment: File | null;
  submitImmediately: boolean;
}

export interface SubmitModalResubmitPayload {
  mode: "resubmit";
  reportUid: string;
  key_points: string;
  observation_attachment: File | null;
}

export type SubmitModalPayload =
  | SubmitModalCreatePayload
  | SubmitModalEditPayload
  | SubmitModalResubmitPayload;

interface CreateProps {
  mode: "create";
  open: boolean;
  defaultClientUid: string;
  clients: MasterItem[];
  managers: Profile[];
  onClose: () => void;
  onSubmit: (p: SubmitModalCreatePayload) => Promise<void>;
}
interface EditProps {
  mode: "edit";
  open: boolean;
  reportUid: string;
  initialKeyPoints: string;
  onClose: () => void;
  onSubmit: (p: SubmitModalEditPayload) => Promise<void>;
}
interface ResubmitProps {
  mode: "resubmit";
  open: boolean;
  reportUid: string;
  priorKeyPoints: string;
  managerComment: string;
  onClose: () => void;
  onSubmit: (p: SubmitModalResubmitPayload) => Promise<void>;
}

type Props = CreateProps | EditProps | ResubmitProps;

export default function VisitSubmitModal(props: Props) {
  const [client, setClient] = useState<string>(
    props.mode === "create" ? props.defaultClientUid : "",
  );
  const [visitDate, setVisitDate] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [assignedManager, setAssignedManager] = useState<string>("");
  const [keyPoints, setKeyPoints] = useState<string>(
    props.mode === "edit"
      ? props.initialKeyPoints
      : props.mode === "resubmit"
        ? props.priorKeyPoints
        : "",
  );
  const [file, setFile] = useState<File | null>(null);
  const [submitImmediately, setSubmitImmediately] = useState<boolean>(props.mode === "resubmit");
  const [busy, setBusy] = useState(false);

  // Reset when re-opened (avoid leaking state between rows).
  useEffect(() => {
    if (!props.open) return;
    if (props.mode === "create") {
      setClient(props.defaultClientUid);
      setVisitDate(new Date().toISOString().slice(0, 10));
      setAssignedManager("");
      setKeyPoints("");
      setFile(null);
      setSubmitImmediately(false);
    }
    if (props.mode === "edit") {
      setKeyPoints(props.initialKeyPoints);
      setFile(null);
      setSubmitImmediately(false);
    }
    if (props.mode === "resubmit") {
      setKeyPoints(props.priorKeyPoints);
      setFile(null);
      setSubmitImmediately(true);
    }
  }, [props.open, props.mode]);

  if (!props.open) return null;

  const submit = async () => {
    setBusy(true);
    try {
      if (props.mode === "create") {
        await props.onSubmit({
          mode: "create",
          client,
          visit_date: visitDate,
          assigned_manager: assignedManager,
          key_points: keyPoints,
          observation_attachment: file,
          submitImmediately,
        });
      } else if (props.mode === "edit") {
        await props.onSubmit({
          mode: "edit",
          reportUid: props.reportUid,
          key_points: keyPoints,
          observation_attachment: file,
          submitImmediately,
        });
      } else {
        await props.onSubmit({
          mode: "resubmit",
          reportUid: props.reportUid,
          key_points: keyPoints,
          observation_attachment: file,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={overlay}>
      <div style={modal}>
        <h3 style={{ margin: "0 0 12px" }}>
          {props.mode === "create" ? "New visit" : props.mode === "edit" ? "Edit draft" : "Resubmit visit report"}
        </h3>
        {props.mode === "resubmit" && (
          <div style={{ background: "#fef3c7", padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
            <strong>Manager rejected the previous report:</strong>
            <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{props.managerComment}</div>
          </div>
        )}

        {props.mode === "create" && (
          <>
            <Field label="Client">
              <select value={client} onChange={(e) => setClient(e.target.value)} style={input}>
                <option value="">Select…</option>
                {/* MasterItem.id IS the uid (see dtoToMasterItem in useMasters.ts). */}
                {props.clients.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
              </select>
            </Field>
            <Field label="Visit date">
              <input type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} style={input} />
            </Field>
            <Field label="Assigned manager">
              <select value={assignedManager} onChange={(e) => setAssignedManager(e.target.value)} style={input}>
                <option value="">Select…</option>
                {props.managers.map((p) => (<option key={p.id} value={p.id}>{p.full_name}</option>))}
              </select>
            </Field>
          </>
        )}

        <Field label="Key points">
          <textarea rows={5} value={keyPoints} onChange={(e) => setKeyPoints(e.target.value)} style={input} />
        </Field>
        <Field label="Observation report">
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>

        {props.mode !== "resubmit" && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginTop: 10 }}>
            <input
              type="checkbox"
              checked={submitImmediately}
              onChange={(e) => setSubmitImmediately(e.target.checked)}
            />
            Submit for approval immediately (otherwise saved as Draft)
          </label>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" onClick={props.onClose} style={btn}>Cancel</button>
          <button type="button" onClick={submit} disabled={busy} style={primaryBtn}>
            {busy ? "Saving…" : (props.mode === "resubmit" || submitImmediately) ? "Save & Submit" : "Save Draft"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: 10, fontSize: 13, fontWeight: 600 }}>
      <div style={{ marginBottom: 4 }}>{label}</div>
      {children}
    </label>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,.4)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
};
const modal: React.CSSProperties = {
  width: 520, maxWidth: "90vw", background: "#fff", padding: 20,
  borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.2)",
};
const input: React.CSSProperties = { width: "100%", padding: 6, border: "1px solid #cbd5e1", borderRadius: 6 };
const btn: React.CSSProperties = { padding: "8px 14px", background: "#f1f5f9", border: "none", borderRadius: 6 };
const primaryBtn: React.CSSProperties = { ...btn, background: "#2563eb", color: "#fff" };
```

- [ ] **Step 2: Type-check & commit**

```bash
cd frontend/task-tracker && npm run -s typecheck
git add frontend/task-tracker/src/components/clients/VisitSubmitModal.tsx
git commit -m "feat(clients): add VisitSubmitModal (create / edit-draft / resubmit)"
```

### Task 8.5: `ClientVisitRow` (revisions table + sent-info + timeline + actions)

**Files:**
- Create: `frontend/task-tracker/src/components/clients/ClientVisitRow.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { Fragment, useState } from "react";
import { openAuthenticatedFile } from "@/lib/api";
import VisitReviewPanel from "./VisitReviewPanel";
import VisitSentInfoPanel from "./VisitSentInfoPanel";
import VisitTimelinePanel from "./VisitTimelinePanel";
import type { ClientVisitDto, VisitSentInfoForm } from "@/types/api/internalReports";

interface Props {
  visit: ClientVisitDto;
  currentUserUid: string;
  isOrgAdmin: boolean;
  onEditDraft: (reportUid: string, currentKeyPoints: string) => void;
  onSubmit: (reportUid: string) => Promise<void>;
  onApprove: (reportUid: string) => Promise<void>;
  onReject: (reportUid: string, comment: string) => Promise<void>;
  onResubmit: (reportUid: string, priorKeyPoints: string, managerComment: string) => void;
  onSetSentInfo: (uid: string, form: VisitSentInfoForm) => Promise<void>;
}

export default function ClientVisitRow({
  visit, currentUserUid, isOrgAdmin,
  onEditDraft, onSubmit, onApprove, onReject, onResubmit, onSetSentInfo,
}: Props) {
  const [open, setOpen] = useState(false);
  const isAuthor = visit.prepared_by === currentUserUid;
  const isAssignedManager = visit.assigned_manager === currentUserUid;
  const canReview = isAssignedManager || isOrgAdmin;
  const canEditSentInfo = isAssignedManager || isOrgAdmin;
  const latest = [...visit.reports].sort((a, b) => b.revision_number - a.revision_number)[0];

  return (
    <Fragment>
      <tr
        onClick={() => setOpen((o) => !o)}
        style={{ borderBottom: "1px solid #e2e8f0", cursor: "pointer", background: open ? "#f8fafc" : "transparent" }}
      >
        <td style={{ ...td, width: 24, color: "#64748b" }}>{open ? "▾" : "▸"}</td>
        <td style={td}>{visit.visit_date}</td>
        <td style={td}>{visit.prepared_by_detail?.full_name ?? "—"}</td>
        <td style={td}>{visit.assigned_manager_detail?.full_name ?? "—"}</td>
        <td style={td}><StatusPill status={visit.current_status} /></td>
        <td style={td}>{visit.report_sent_date ?? "—"}</td>
        <td style={td}>{visit.is_overdue ? <span style={overduePill}>⚠ Overdue</span> : ""}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} style={{ padding: 0, borderBottom: "1px solid #e2e8f0" }}>
            <div style={{ background: "#fff", padding: 14, display: "flex", flexDirection: "column", gap: 18 }}>
              <section>
                <h4 style={sectionH}>Revisions</h4>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#f8fafc", textAlign: "left" }}>
                      <th style={th}>Rev</th>
                      <th style={th}>Status</th>
                      <th style={th}>Submitted</th>
                      <th style={th}>Reviewed by</th>
                      <th style={th}>Comment</th>
                      <th style={th}>File</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visit.reports.map((r) => (
                      <tr key={r.uid}>
                        <td style={td}>#{r.revision_number}</td>
                        <td style={td}><StatusPill status={r.status} /></td>
                        <td style={td}>{r.submitted_at ? new Date(r.submitted_at).toLocaleString() : "—"}</td>
                        <td style={td}>{r.reviewed_by_detail?.full_name ?? "—"}</td>
                        <td style={td}>{r.manager_comment || "—"}</td>
                        <td style={td}>
                          {r.download_url ? (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); void openAuthenticatedFile(r.download_url); }}
                              style={linkBtn}
                            >
                              📎 {r.attachment_filename || "Download"}
                            </button>
                          ) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Author actions on the latest revision */}
                {isAuthor && latest && (
                  <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                    {latest.status === "Draft" && (
                      <>
                        <button type="button" style={primaryBtn}
                          onClick={(e) => { e.stopPropagation(); onEditDraft(latest.uid, latest.key_points); }}>
                          Edit
                        </button>
                        <button type="button" style={primaryBtn}
                          onClick={(e) => { e.stopPropagation(); void onSubmit(latest.uid); }}>
                          Submit
                        </button>
                      </>
                    )}
                    {latest.status === "Pending" && (
                      <button type="button" style={btn}
                        onClick={(e) => { e.stopPropagation(); onEditDraft(latest.uid, latest.key_points); }}>
                        Edit while pending
                      </button>
                    )}
                    {latest.status === "Rejected" && (
                      <button type="button" style={primaryBtn}
                        onClick={(e) => { e.stopPropagation(); onResubmit(latest.uid, latest.key_points, latest.manager_comment); }}>
                        Resubmit
                      </button>
                    )}
                  </div>
                )}

                {/* Manager actions on a Pending latest */}
                {canReview && latest && latest.status === "Pending" && (
                  <div style={{ marginTop: 8 }}>
                    <VisitReviewPanel
                      onApprove={() => onApprove(latest.uid)}
                      onReject={(c) => onReject(latest.uid, c)}
                    />
                  </div>
                )}
              </section>

              {visit.reports.some((r) => r.status === "Approved") && (
                <section>
                  <h4 style={sectionH}>Sent to client</h4>
                  <VisitSentInfoPanel
                    visit={visit}
                    canEdit={canEditSentInfo}
                    onSave={(form) => onSetSentInfo(visit.uid, form)}
                  />
                </section>
              )}

              <section>
                <h4 style={sectionH}>Timeline</h4>
                <VisitTimelinePanel events={visit.audit_events} />
              </section>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, [string, string]> = {
    Draft: ["#f1f5f9", "#475569"],
    Pending: ["#fef3c7", "#92400e"],
    Approved: ["#dcfce7", "#166534"],
    Rejected: ["#fee2e2", "#b91c1c"],
  };
  const [bg, fg] = colors[status] ?? ["#f1f5f9", "#475569"];
  return (
    <span style={{ background: bg, color: fg, padding: "2px 8px", borderRadius: 999, fontSize: 12, fontWeight: 600 }}>
      {status}
    </span>
  );
}

const overduePill: React.CSSProperties = {
  background: "#fee2e2", color: "#b91c1c", padding: "2px 8px",
  borderRadius: 999, fontSize: 12, fontWeight: 700,
};
const td: React.CSSProperties = { padding: "8px 10px", verticalAlign: "top" };
const th: React.CSSProperties = { padding: "8px 10px", fontWeight: 600, borderBottom: "1px solid #e2e8f0" };
const sectionH: React.CSSProperties = { margin: "0 0 8px", fontSize: 14 };
const btn: React.CSSProperties = { padding: "6px 12px", background: "#f1f5f9", border: "none", borderRadius: 6, cursor: "pointer" };
const primaryBtn: React.CSSProperties = { ...btn, background: "#2563eb", color: "#fff" };
const linkBtn: React.CSSProperties = {
  background: "none", border: "none", padding: 0, color: "#2563eb",
  cursor: "pointer", fontSize: 13,
};
```

- [ ] **Step 2: Type-check & commit**

```bash
cd frontend/task-tracker && npm run -s typecheck
git add frontend/task-tracker/src/components/clients/ClientVisitRow.tsx
git commit -m "feat(clients): add ClientVisitRow with revisions+timeline+sent-info"
```

### Task 8.6: `ClientVisitGroupedView` + `ClientInternalReportTab` + page wiring

**Files:**
- Create: `frontend/task-tracker/src/components/clients/ClientVisitGroupedView.tsx`
- Create: `frontend/task-tracker/src/components/clients/ClientInternalReportTab.tsx`
- Modify: `frontend/task-tracker/src/pages/ClientsPage.tsx`

- [ ] **Step 1: Write the grouped view**

`ClientVisitGroupedView.tsx`:

```tsx
import { useState } from "react";
import ClientVisitRow from "./ClientVisitRow";
import type { VisitGroup } from "./internalReportGrouping";
import type { ClientVisitDto, VisitSentInfoForm } from "@/types/api/internalReports";

interface Props {
  groups: VisitGroup[];
  currentUserUid: string;
  isOrgAdmin: boolean;
  onAddVisit: (clientUid: string) => void;
  onEditDraft: (reportUid: string, currentKeyPoints: string) => void;
  onSubmit: (reportUid: string) => Promise<void>;
  onApprove: (reportUid: string) => Promise<void>;
  onReject: (reportUid: string, comment: string) => Promise<void>;
  onResubmit: (reportUid: string, priorKeyPoints: string, managerComment: string) => void;
  onSetSentInfo: (uid: string, form: VisitSentInfoForm) => Promise<void>;
}

export default function ClientVisitGroupedView(p: Props) {
  const [openClients, setOpenClients] = useState<Set<string>>(new Set());
  if (!p.groups.length) return <div style={{ color: "#64748b" }}>No visits yet.</div>;
  return (
    <>
      {p.groups.map((g) => {
        const isOpen = openClients.has(g.clientUid);
        return (
          <div key={g.clientUid}
            style={{ marginBottom: 8, border: "1px solid #e2e8f0", borderRadius: 6, overflow: "hidden" }}>
            <div style={{
              display: "flex", alignItems: "center",
              background: isOpen ? "#eff6ff" : "#f8fafc",
              borderBottom: isOpen ? "1px solid #e2e8f0" : "none",
            }}>
              <button type="button"
                onClick={() => setOpenClients((prev) => {
                  const next = new Set(prev);
                  if (next.has(g.clientUid)) next.delete(g.clientUid);
                  else next.add(g.clientUid);
                  return next;
                })}
                style={{ flex: 1, textAlign: "left", padding: "10px 12px", background: "transparent",
                         border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600,
                         display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 12 }}>{isOpen ? "▾" : "▸"}</span>
                <span>{g.clientName}</span>
                <span style={{ color: "#64748b", fontWeight: 400 }}>
                  ({g.visits.length} visit{g.visits.length === 1 ? "" : "s"})
                </span>
              </button>
              {g.clientUid !== "unassigned" && (
                <button type="button" onClick={() => p.onAddVisit(g.clientUid)}
                  style={{ margin: "0 10px", padding: "5px 10px", background: "#2563eb",
                           color: "#fff", border: "none", borderRadius: 6, fontSize: 12,
                           fontWeight: 600, cursor: "pointer" }}>
                  + New visit
                </button>
              )}
            </div>
            {isOpen && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#fafafa", textAlign: "left" }}>
                    <th style={th}></th>
                    <th style={th}>Visit Date</th>
                    <th style={th}>Prepared By</th>
                    <th style={th}>Manager</th>
                    <th style={th}>Status</th>
                    <th style={th}>Sent Date</th>
                    <th style={th}>Overdue?</th>
                  </tr>
                </thead>
                <tbody>
                  {g.visits.map((v: ClientVisitDto) => (
                    <ClientVisitRow
                      key={v.uid}
                      visit={v}
                      currentUserUid={p.currentUserUid}
                      isOrgAdmin={p.isOrgAdmin}
                      onEditDraft={p.onEditDraft}
                      onSubmit={p.onSubmit}
                      onApprove={p.onApprove}
                      onReject={p.onReject}
                      onResubmit={p.onResubmit}
                      onSetSentInfo={p.onSetSentInfo}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </>
  );
}

const th: React.CSSProperties = { padding: "8px 10px", fontWeight: 600, borderBottom: "1px solid #e2e8f0" };
```

- [ ] **Step 2: Write the tab shell**

`ClientInternalReportTab.tsx`:

```tsx
import { useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useMasters } from "@/hooks/useMasters";
import { useClientVisits } from "@/hooks/useClientVisits";
import MultiSelect from "@/components/ui/MultiSelect";
import ClientVisitGroupedView from "./ClientVisitGroupedView";
import VisitSubmitModal, {
  type SubmitModalCreatePayload,
  type SubmitModalEditPayload,
  type SubmitModalResubmitPayload,
} from "./VisitSubmitModal";
import { groupVisitsByClient } from "./internalReportGrouping";
import {
  isInternalReportFilterActive,
  visitMatches,
  type InternalReportFilters,
} from "./internalReportFilters";
import { reportApiError } from "./errors";
import type { Profile } from "@/types/auth";
import type { VisitStatus } from "@/types/api/internalReports";

interface Props {
  clientUid: string;
  selectedOrg: string | null;
  profile: Profile | null;
  profiles: Profile[];
}

const STATUSES: VisitStatus[] = ["Draft", "Pending", "Approved", "Rejected"];

export default function ClientInternalReportTab({ clientUid, selectedOrg, profile, profiles }: Props) {
  const { isAdminInAny } = useAuth();
  const { clients } = useMasters();
  const isOrgAdmin = isAdminInAny();
  const me = profile?.id ?? "";

  const { visits, loading, createNew, editDraft, submit, approve, reject, resubmit, setSentInfo } =
    useClientVisits();

  const [preparedByUids, setPreparedByUids] = useState<string[]>([]);
  const [assignedManagerUids, setAssignedManagerUids] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [visitMonth, setVisitMonth] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [pendingMyApproval, setPendingMyApproval] = useState(false);

  const [modalState, setModalState] = useState<
    | { mode: "closed" }
    | { mode: "create"; defaultClientUid: string }
    | { mode: "edit"; reportUid: string; initialKeyPoints: string }
    | { mode: "resubmit"; reportUid: string; priorKeyPoints: string; managerComment: string }
  >({ mode: "closed" });

  const filters: InternalReportFilters = useMemo(
    () => ({
      preparedByUids,
      assignedManagerUids: pendingMyApproval && me ? [me] : assignedManagerUids,
      statuses: pendingMyApproval ? ["Pending"] : statuses,
      visitMonth,
      overdueOnly,
    }),
    [preparedByUids, assignedManagerUids, statuses, visitMonth, overdueOnly, pendingMyApproval, me],
  );

  const filteredVisits = useMemo(() => {
    let list = visits;
    if (clientUid) list = list.filter((v) => v.client === clientUid);
    if (selectedOrg) list = list.filter((v) => v.org_uid === selectedOrg);
    return isInternalReportFilterActive(filters)
      ? list.filter((v) => visitMatches(v, filters))
      : list;
  }, [visits, clientUid, selectedOrg, filters]);

  const groups = useMemo(() => groupVisitsByClient(filteredVisits), [filteredVisits]);

  if (loading) return <div>Loading…</div>;

  const onAddVisit = (clientUidForRow: string) => {
    setModalState({ mode: "create", defaultClientUid: clientUidForRow || clientUid });
  };

  const handleCreate = async (p: SubmitModalCreatePayload) => {
    try {
      const created = await createNew({
        client: p.client,
        visit_date: p.visit_date,
        assigned_manager: p.assigned_manager,
        key_points: p.key_points,
        observation_attachment: p.observation_attachment ?? null,
      });
      if (p.submitImmediately && created.reports[0]) {
        await submit(created.reports[0].uid);
      }
      setModalState({ mode: "closed" });
    } catch (err) {
      reportApiError("Save failed", err);
      throw err;
    }
  };

  const handleEdit = async (p: SubmitModalEditPayload) => {
    try {
      await editDraft(p.reportUid, {
        key_points: p.key_points,
        observation_attachment: p.observation_attachment ?? null,
      });
      if (p.submitImmediately) await submit(p.reportUid);
      setModalState({ mode: "closed" });
    } catch (err) { reportApiError("Save failed", err); throw err; }
  };

  const handleResubmit = async (p: SubmitModalResubmitPayload) => {
    try {
      await resubmit(p.reportUid, {
        key_points: p.key_points,
        observation_attachment: p.observation_attachment ?? null,
      });
      // After resubmit a new Draft revision exists. Auto-submit so the manager
      // sees it as Pending — this matches the modal's "Save & Submit" label.
      const v = visits.find((x) => x.reports.some((r) => r.uid === p.reportUid));
      const latest = v ? [...v.reports].sort((a, b) => b.revision_number - a.revision_number)[0] : null;
      if (latest) await submit(latest.uid);
      setModalState({ mode: "closed" });
    } catch (err) { reportApiError("Save failed", err); throw err; }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <MultiSelect label="Prepared by"
          options={profiles.map((p) => p.id)}
          selected={preparedByUids}
          onChange={setPreparedByUids}
          allLabel="All"
          labels={Object.fromEntries(profiles.map((p) => [p.id, p.full_name]))}
        />
        <MultiSelect label="Assigned manager"
          options={profiles.map((p) => p.id)}
          selected={assignedManagerUids}
          onChange={setAssignedManagerUids}
          allLabel="All"
          labels={Object.fromEntries(profiles.map((p) => [p.id, p.full_name]))}
        />
        <MultiSelect label="Status"
          options={STATUSES as string[]}
          selected={statuses}
          onChange={setStatuses}
          allLabel="All"
        />
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 600, color: "#475569" }}>
          VISIT MONTH
          <input type="month" value={visitMonth} onChange={(e) => setVisitMonth(e.target.value)}
            style={{ padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13 }} />
        </label>
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, paddingBottom: 6 }}>
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
          Overdue only
        </label>
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, paddingBottom: 6 }}>
          <input type="checkbox" checked={pendingMyApproval}
            onChange={(e) => setPendingMyApproval(e.target.checked)} />
          Pending my approval
        </label>
        <button type="button"
          onClick={() => setModalState({ mode: "create", defaultClientUid: clientUid })}
          style={{ marginLeft: "auto", padding: "8px 14px", background: "#2563eb",
                   color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          + New Visit
        </button>
      </div>

      <ClientVisitGroupedView
        groups={groups}
        currentUserUid={me}
        isOrgAdmin={isOrgAdmin}
        onAddVisit={onAddVisit}
        onEditDraft={(reportUid, initialKeyPoints) =>
          setModalState({ mode: "edit", reportUid, initialKeyPoints })
        }
        onSubmit={submit}
        onApprove={approve}
        onReject={reject}
        onResubmit={(reportUid, priorKeyPoints, managerComment) =>
          setModalState({ mode: "resubmit", reportUid, priorKeyPoints, managerComment })
        }
        onSetSentInfo={setSentInfo}
      />

      {modalState.mode === "create" && (
        <VisitSubmitModal mode="create" open
          defaultClientUid={modalState.defaultClientUid}
          clients={clients}
          managers={profiles}
          onClose={() => setModalState({ mode: "closed" })}
          onSubmit={handleCreate}
        />
      )}
      {modalState.mode === "edit" && (
        <VisitSubmitModal mode="edit" open
          reportUid={modalState.reportUid}
          initialKeyPoints={modalState.initialKeyPoints}
          onClose={() => setModalState({ mode: "closed" })}
          onSubmit={handleEdit}
        />
      )}
      {modalState.mode === "resubmit" && (
        <VisitSubmitModal mode="resubmit" open
          reportUid={modalState.reportUid}
          priorKeyPoints={modalState.priorKeyPoints}
          managerComment={modalState.managerComment}
          onClose={() => setModalState({ mode: "closed" })}
          onSubmit={handleResubmit}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire the new tab into `ClientsPage.tsx`**

Open `frontend/task-tracker/src/pages/ClientsPage.tsx` and make these changes:

1. Add an import:

```tsx
import ClientInternalReportTab from "@/components/clients/ClientInternalReportTab";
```

2. Replace the `SubTab` type and the tab list to include `internal`:

```tsx
type SubTab = "roadmap" | "mom" | "internal";
```

3. In the sub-tab bar where the array literal lives, add a third entry:

```tsx
{(
  [
    { id: "roadmap", label: "🗺️ Road Map" },
    { id: "mom", label: "📋 MOM & Action Points" },
    { id: "internal", label: "📝 Internal Report" },
  ] as const
).map((t) => (...))}
```

4. After the existing `subTab === "mom"` render block, add:

```tsx
{subTab === "internal" && (
  <ClientInternalReportTab
    clientUid={effectiveClientUid}
    selectedOrg={selectedOrg}
    profile={profile}
    profiles={profiles}
  />
)}
```

- [ ] **Step 4: Type-check & run frontend test suite**

Run:
```bash
cd frontend/task-tracker && npm run -s typecheck
cd frontend/task-tracker && npx vitest run
```

Expected: typecheck passes; all existing + new vitest tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/components/clients/ClientVisitGroupedView.tsx \
        frontend/task-tracker/src/components/clients/ClientInternalReportTab.tsx \
        frontend/task-tracker/src/pages/ClientsPage.tsx
git commit -m "feat(clients): wire Internal Report sub-tab into Clients page"
```

---

## Phase 9 — Browser verification

### Task 9.1: Manual end-to-end checks

> CLAUDE.md requires UI changes to be verified in a browser before claiming
> the work is complete. Follow the checklist below; if anything fails, return
> to the relevant phase and fix it before declaring success.

- [ ] **Step 1: Start backend and frontend dev servers**

In one shell:
```
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```

In another:
```
cd frontend/task-tracker && npm run dev
```

- [ ] **Step 2: Happy path — junior submits, manager approves, sent + voice**

1. Log in as a junior user (employee role).
2. Navigate to **Clients → 📝 Internal Report**.
3. Click **+ New Visit**, fill the form (client, today's date, an admin/manager as the approver, key points, optional file). Tick "Submit for approval immediately". Save.
4. Confirm the row appears as `Pending`.
5. Log in as the assigned manager in another window/profile. The row should appear; the toast "New report awaiting your approval" should pop on submission.
6. Click **✓ Approve**. Confirm the status flips to `Approved`.
7. Open the row's "Sent to client" panel. Enter today's date as `report_sent_date`, tick "Voice note sent", add a summary, save.
8. Check the timeline panel shows: Created → Submitted → Approved → Sent to client → Voice note marked.

- [ ] **Step 3: Reject + resubmit path**

1. Junior creates a new visit, submits.
2. Manager clicks **✗ Reject…**, adds a comment ("missing photos"), confirms.
3. Junior sees the row as `Rejected`, with manager comment visible. Clicks **Resubmit**, the modal opens with prior key points pre-filled and the manager comment shown as a yellow banner. Updates key points, saves.
4. Latest row shows revision **#2** in `Pending`. Manager approves. Row shows two revisions: `#1 Rejected` and `#2 Approved`.

- [ ] **Step 4: Overdue badge & filter**

1. Open a Django shell: `python manage.py shell`
2. Run:
   ```python
   from datetime import date, timedelta
   from core.masters.models import ClientVisit, Master
   v = ClientVisit.objects.first()
   v.visit_date = date.today() - timedelta(days=3)
   v.report_sent_date = None
   v.save()
   ```
3. Reload the Internal Report tab. The row should show `⚠ Overdue`.
4. Tick **Overdue only** in the filter bar. Only that row should remain visible.

- [ ] **Step 5: Visibility checks**

1. As a different junior (not the author), navigate to the tab. Should see no rows.
2. As a manager not assigned to this visit, should also see no rows. (Admins see everything.)

- [ ] **Step 6: Stop both dev servers**

`Ctrl-C` in each terminal.

- [ ] **Step 7: Final commit (if any small fixes were needed during verification)**

If the manual checks found issues, fix them inline and commit:

```bash
git add -A
git commit -m "fix(clients): <describe specific browser-discovered fix>"
```

If everything worked first time, no commit needed.

---

## Done

The Internal Report sub-tab is shippable when:

- All backend tests in Task 1.2, Task 3.7 pass.
- All frontend tests in Tasks 7.1, 7.2, 7.3 pass.
- The browser checks in Task 9.1 all pass.
- `git log --oneline origin/main..HEAD` shows a clean series of commits (one per task) on the `Cleint_InternalReport` branch.
