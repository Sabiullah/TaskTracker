# Client Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a top-level **Clients** nav tab that lets admins and managers record a client's Road Map (deliverables with owners + target dates) and Meetings (MOM with structured Action Points, attachments, and an overdue-action-points summary).

**Architecture:** Four new Django models live in `core/masters/` (`ClientRoadmap`, `ClientMeeting`, `ClientActionPoint`, `ClientMeetingAttachment`). They're all org-scoped via the existing `users.Org` FK pattern and hang off `masters.Master(type="client")`. DRF viewsets reuse `core.permissions.IsAdminOrManagerInAny` + `PerOrgManager` so any org member can read, but only admin/manager of the row's org can write. Frontend adds one lazy-loaded page `ClientsPage.tsx` with two sub-tabs (Road Map, MOM & Action Points) plus an overdue-action-points card and panel. Realtime updates via the existing `core.realtime.broadcast` mechanism.

**Tech Stack:** Django 6.0 + DRF + Channels (backend) · React 19 + Vite + TypeScript (frontend) · WebSocket realtime through `core.realtime` · pytest/Django test runner backend, vitest frontend.

**Spec:** [docs/superpowers/specs/2026-04-21-client-management-design.md](../specs/2026-04-21-client-management-design.md)

---

## Pre-flight — file & symbol map

Before editing, read these so every new symbol matches the codebase style:

- `core/base.py` — `TimeStampedModel`, `UidLookupMixin`
- `core/org_utils.py` — `resolve_create_org`, `scoped`, `visibility_q`
- `core/permissions.py` — `IsAdminOrManagerInAny`, `PerOrgManager`, `IsAdmin`
- `core/realtime.py` — `broadcast(channel, event_type, record)`
- `core/serializers.py` — `OrgScopedMixin`, `UserMinSerializer`
- `core/masters/models.py`, `.../serializers.py`, `.../views.py`, `.../urls.py`, `.../admin.py`
- `core/leads/{models,views,serializers}.py` — template for a CRUD+realtime viewset
- `frontend/task-tracker/src/App.tsx` — `VIEW_MAP` + lazy-load block
- `frontend/task-tracker/src/components/layout/Header.tsx` — nav button + icon map
- `frontend/task-tracker/src/lib/api/{client,ws}.ts` — `apiGet/apiPost/apiPatch/apiDelete/apiPostForm`, `ws.subscribe`
- `frontend/task-tracker/src/hooks/useLeads.ts` — template for a hook that loads + subscribes to realtime
- `frontend/task-tracker/src/hooks/useMasters.ts` — source of the client dropdown list
- `frontend/task-tracker/src/pages/PacePage.tsx` — sub-tab bar styling pattern to reuse

---

## Task 1 — Add the four models + migration

**Files:**
- Modify: `core/masters/models.py`
- Create: `core/masters/migrations/0005_client_management.py` (generated)

- [ ] **Step 1.1: Append models to `core/masters/models.py`**

Append at the bottom of the existing `core/masters/models.py` file (keep the existing `Master` model untouched):

```python
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
    target_date = models.DateField(null=True, blank=True)
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
        return f"Action #{self.pk} on meeting #{self.meeting_id}"


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
```

- [ ] **Step 1.2: Generate the migration**

Run from the repo root:

```bash
python manage.py makemigrations masters --name client_management
```

Expected output contains `Migrations for 'masters':` and `0005_client_management.py` with `CreateModel` operations for `ClientRoadmap`, `ClientMeeting`, `ClientActionPoint`, `ClientMeetingAttachment`. Open the file and verify nothing unexpected was added (e.g. no unrelated `AlterField` on `Master`).

- [ ] **Step 1.3: Apply the migration locally**

```bash
python manage.py migrate masters
```

Expected: `Applying masters.0005_client_management... OK`.

- [ ] **Step 1.4: Commit**

```bash
git add core/masters/models.py core/masters/migrations/0005_client_management.py
git commit -m "feat(masters): add Client Management models (roadmap, meeting, action point, attachment)"
```

---

## Task 2 — Register admin entries

**Files:**
- Modify: `core/masters/admin.py`

- [ ] **Step 2.1: Add admin classes**

Replace the full contents of `core/masters/admin.py` with:

```python
from django.contrib import admin

from .models import (
    ClientActionPoint,
    ClientMeeting,
    ClientMeetingAttachment,
    ClientRoadmap,
    Master,
)


@admin.register(Master)
class MasterAdmin(admin.ModelAdmin):
    list_display = ["name", "type", "org", "is_active", "sort_order", "color", "created_at"]
    list_filter = ["type", "is_active", "org"]
    search_fields = ["name"]
    readonly_fields = ["uid", "created_at", "updated_at"]
    autocomplete_fields = ["org", "created_by"]
    ordering = ["type", "sort_order", "name"]


@admin.register(ClientRoadmap)
class ClientRoadmapAdmin(admin.ModelAdmin):
    list_display = ["title", "client", "owner", "status", "priority", "target_date", "completion_date"]
    list_filter = ["status", "priority", "org"]
    search_fields = ["title", "description", "category"]
    readonly_fields = ["uid", "created_at", "updated_at"]
    autocomplete_fields = ["org", "client", "owner", "created_by"]


class ClientActionPointInline(admin.TabularInline):
    model = ClientActionPoint
    extra = 0
    autocomplete_fields = ["responsibility", "roadmap_link"]
    fields = ["description", "responsibility", "target_date", "completion_date", "status", "priority"]


class ClientMeetingAttachmentInline(admin.TabularInline):
    model = ClientMeetingAttachment
    extra = 0
    readonly_fields = ["uploaded_at", "size_bytes"]


@admin.register(ClientMeeting)
class ClientMeetingAdmin(admin.ModelAdmin):
    list_display = ["client", "meeting_date", "meeting_type", "mode", "conducted_by"]
    list_filter = ["meeting_type", "mode", "org"]
    search_fields = ["agenda", "minutes", "venue"]
    readonly_fields = ["uid", "created_at", "updated_at"]
    autocomplete_fields = ["org", "client", "conducted_by", "created_by"]
    filter_horizontal = ["our_attendees"]
    inlines = [ClientActionPointInline, ClientMeetingAttachmentInline]


@admin.register(ClientActionPoint)
class ClientActionPointAdmin(admin.ModelAdmin):
    list_display = ["description", "meeting", "responsibility", "status", "priority", "target_date", "completion_date"]
    list_filter = ["status", "priority"]
    search_fields = ["description", "remarks"]
    autocomplete_fields = ["meeting", "responsibility", "roadmap_link"]


@admin.register(ClientMeetingAttachment)
class ClientMeetingAttachmentAdmin(admin.ModelAdmin):
    list_display = ["filename", "meeting", "uploaded_by", "size_bytes", "uploaded_at"]
    readonly_fields = ["uid", "uploaded_at", "size_bytes"]
    autocomplete_fields = ["meeting", "uploaded_by"]
```

- [ ] **Step 2.2: Confirm Django system check passes**

```bash
python manage.py check
```

Expected: `System check identified no issues`.

- [ ] **Step 2.3: Commit**

```bash
git add core/masters/admin.py
git commit -m "feat(masters): register Client Management models in Django admin"
```

---

## Task 3 — Add serializers

**Files:**
- Modify: `core/masters/serializers.py`

- [ ] **Step 3.1: Append serializers**

Append to `core/masters/serializers.py` (keep the existing `MasterMinSerializer` and `MasterSerializer`):

```python
from django.contrib.auth import get_user_model

from core.serializers import UserMinSerializer

from .models import (
    ClientActionPoint,
    ClientMeeting,
    ClientMeetingAttachment,
    ClientRoadmap,
)

User = get_user_model()


class ClientRoadmapSerializer(OrgScopedMixin, serializers.ModelSerializer):
    org = serializers.SlugRelatedField(
        slug_field="uid", queryset=Org.objects.all(), required=False, allow_null=True
    )
    org_uid = serializers.UUIDField(source="org.uid", read_only=True, allow_null=True)
    client = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Master.objects.filter(type="client"),
        required=False,
        allow_null=True,
    )
    client_detail = MasterMinSerializer(source="client", read_only=True)
    owner = serializers.SlugRelatedField(
        slug_field="uid", queryset=User.objects.all(), required=False, allow_null=True
    )
    owner_detail = UserMinSerializer(source="owner", read_only=True)
    created_by_detail = UserMinSerializer(source="created_by", read_only=True)

    class Meta:
        model = ClientRoadmap
        fields = [
            "id",
            "uid",
            "org",
            "org_uid",
            "client",
            "client_detail",
            "title",
            "description",
            "owner",
            "owner_detail",
            "target_date",
            "completion_date",
            "status",
            "priority",
            "progress_notes",
            "category",
            "created_by_detail",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "uid",
            "org_uid",
            "client_detail",
            "owner_detail",
            "created_by_detail",
            "created_at",
            "updated_at",
        ]


class ClientMeetingAttachmentSerializer(serializers.ModelSerializer):
    uploaded_by_detail = UserMinSerializer(source="uploaded_by", read_only=True)
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = ClientMeetingAttachment
        fields = [
            "id",
            "uid",
            "meeting",
            "filename",
            "size_bytes",
            "uploaded_by_detail",
            "uploaded_at",
            "download_url",
        ]
        read_only_fields = fields

    def get_download_url(self, obj):
        try:
            return obj.file.url
        except ValueError:
            return ""


class ClientActionPointSerializer(serializers.ModelSerializer):
    responsibility = serializers.SlugRelatedField(
        slug_field="uid", queryset=User.objects.all(), required=False, allow_null=True
    )
    responsibility_detail = UserMinSerializer(source="responsibility", read_only=True)
    roadmap_link = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=ClientRoadmap.objects.all(),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = ClientActionPoint
        fields = [
            "id",
            "uid",
            "meeting",
            "description",
            "responsibility",
            "responsibility_detail",
            "target_date",
            "completion_date",
            "status",
            "priority",
            "remarks",
            "roadmap_link",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "uid",
            "responsibility_detail",
            "created_at",
            "updated_at",
        ]


class ClientMeetingSerializer(OrgScopedMixin, serializers.ModelSerializer):
    org = serializers.SlugRelatedField(
        slug_field="uid", queryset=Org.objects.all(), required=False, allow_null=True
    )
    org_uid = serializers.UUIDField(source="org.uid", read_only=True, allow_null=True)
    client = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Master.objects.filter(type="client"),
        required=False,
        allow_null=True,
    )
    client_detail = MasterMinSerializer(source="client", read_only=True)
    conducted_by = serializers.SlugRelatedField(
        slug_field="uid", queryset=User.objects.all(), required=False, allow_null=True
    )
    conducted_by_detail = UserMinSerializer(source="conducted_by", read_only=True)
    our_attendees = serializers.SlugRelatedField(
        slug_field="uid", queryset=User.objects.all(), many=True, required=False
    )
    our_attendees_detail = UserMinSerializer(source="our_attendees", many=True, read_only=True)
    created_by_detail = UserMinSerializer(source="created_by", read_only=True)
    action_points = ClientActionPointSerializer(many=True, read_only=True)
    attachments = ClientMeetingAttachmentSerializer(many=True, read_only=True)

    class Meta:
        model = ClientMeeting
        fields = [
            "id",
            "uid",
            "org",
            "org_uid",
            "client",
            "client_detail",
            "meeting_date",
            "meeting_time",
            "meeting_type",
            "mode",
            "venue",
            "conducted_by",
            "conducted_by_detail",
            "our_attendees",
            "our_attendees_detail",
            "client_attendees",
            "agenda",
            "minutes",
            "next_meeting_date",
            "action_points",
            "attachments",
            "created_by_detail",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "uid",
            "org_uid",
            "client_detail",
            "conducted_by_detail",
            "our_attendees_detail",
            "action_points",
            "attachments",
            "created_by_detail",
            "created_at",
            "updated_at",
        ]
```

- [ ] **Step 3.2: Run system check**

```bash
python manage.py check
```

Expected: `System check identified no issues`.

- [ ] **Step 3.3: Commit**

```bash
git add core/masters/serializers.py
git commit -m "feat(masters): add serializers for Client Management models"
```

---

## Task 4 — Add viewsets, URL routing, and realtime channels

**Files:**
- Modify: `core/masters/views.py`
- Modify: `core/masters/urls.py`

- [ ] **Step 4.1: Append viewsets to `core/masters/views.py`**

Append below the existing `MasterViewSet`. Keep `MasterViewSet` untouched. Update the imports at the top to add the new names — the final import block should read:

```python
from typing import cast

from django.db.models import Q
from rest_framework import permissions
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.org_utils import resolve_admin_org, resolve_create_org, scoped
from core.permissions import IsAdmin, IsAdminOrManagerInAny, PerOrgManager
from core.realtime import broadcast
from users.models import User

from .models import (
    ClientActionPoint,
    ClientMeeting,
    ClientMeetingAttachment,
    ClientRoadmap,
    Master,
)
from .serializers import (
    ClientActionPointSerializer,
    ClientMeetingAttachmentSerializer,
    ClientMeetingSerializer,
    ClientRoadmapSerializer,
    MasterSerializer,
)
```

Then append these viewsets at the bottom of the same file:

```python
class ClientRoadmapViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = ClientRoadmapSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrManagerInAny, PerOrgManager]

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = scoped(
            ClientRoadmap.objects.select_related("client", "owner", "org", "created_by"),
            user,
        )
        client_uid = self.request.query_params.get("client_uid")
        status = self.request.query_params.get("status")
        owner_uid = self.request.query_params.get("owner_uid")
        overdue = self.request.query_params.get("overdue")
        if client_uid:
            qs = qs.filter(client__uid=client_uid)
        if status:
            qs = qs.filter(status=status)
        if owner_uid:
            qs = qs.filter(owner__uid=owner_uid)
        if overdue == "true":
            from django.utils import timezone
            today = timezone.localdate()
            qs = qs.filter(target_date__lt=today).exclude(status__in=["Achieved", "Cancelled"])
        return qs

    def perform_create(self, serializer):
        org, err = resolve_create_org(self.request)
        if err is not None:
            _raise_from_response(err)
        obj = serializer.save(created_by=self.request.user, org=org)
        broadcast("client-roadmap", "INSERT", ClientRoadmapSerializer(obj).data)

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast("client-roadmap", "UPDATE", ClientRoadmapSerializer(obj).data)

    def perform_destroy(self, instance):
        broadcast("client-roadmap", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()


class ClientMeetingViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = ClientMeetingSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrManagerInAny, PerOrgManager]
    parser_classes = [JSONParser, FormParser, MultiPartParser]

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = scoped(
            ClientMeeting.objects.select_related("client", "conducted_by", "org", "created_by").prefetch_related(
                "our_attendees", "action_points", "attachments"
            ),
            user,
        )
        client_uid = self.request.query_params.get("client_uid")
        date_from = self.request.query_params.get("date_from")
        date_to = self.request.query_params.get("date_to")
        if client_uid:
            qs = qs.filter(client__uid=client_uid)
        if date_from:
            qs = qs.filter(meeting_date__gte=date_from)
        if date_to:
            qs = qs.filter(meeting_date__lte=date_to)
        return qs

    def perform_create(self, serializer):
        org, err = resolve_create_org(self.request)
        if err is not None:
            _raise_from_response(err)
        obj = serializer.save(created_by=self.request.user, org=org)
        broadcast("client-meetings", "INSERT", ClientMeetingSerializer(obj).data)

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast("client-meetings", "UPDATE", ClientMeetingSerializer(obj).data)

    def perform_destroy(self, instance):
        broadcast("client-meetings", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()

    @action(detail=True, methods=["post"], url_path="action-points")
    def add_action_point(self, request, uid=None):
        meeting = self.get_object()
        data = dict(request.data or {})
        data["meeting"] = meeting.pk
        ser = ClientActionPointSerializer(data=data, context={"request": request})
        ser.is_valid(raise_exception=True)
        obj = ser.save()
        broadcast("client-action-points", "INSERT", ClientActionPointSerializer(obj).data)
        return Response(ClientActionPointSerializer(obj).data, status=201)

    @action(detail=True, methods=["get", "post"], url_path="attachments")
    def attachments(self, request, uid=None):
        meeting = self.get_object()
        if request.method == "GET":
            qs = meeting.attachments.all()
            return Response(ClientMeetingAttachmentSerializer(qs, many=True).data)
        upload = request.FILES.get("file")
        if not upload:
            raise ValidationError({"file": "File is required."})
        obj = ClientMeetingAttachment.objects.create(
            meeting=meeting,
            file=upload,
            filename=upload.name,
            size_bytes=upload.size or 0,
            uploaded_by=request.user,
        )
        broadcast("client-meetings", "UPDATE", ClientMeetingSerializer(meeting).data)
        return Response(ClientMeetingAttachmentSerializer(obj).data, status=201)


class ClientActionPointViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = ClientActionPointSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrManagerInAny]
    http_method_names = ["get", "patch", "delete", "head", "options"]

    def get_queryset(self):
        user = cast(User, self.request.user)
        return ClientActionPoint.objects.select_related("meeting", "responsibility", "roadmap_link").filter(
            meeting__org_id__in=user.org_ids()
        )

    def check_object_permissions(self, request, obj):
        super().check_object_permissions(request, obj)
        if request.method in permissions.SAFE_METHODS:
            return
        user = cast(User, request.user)
        target_org = getattr(obj.meeting, "org", None)
        if not (user.is_admin_in(target_org) or user.is_manager_in(target_org)):
            raise PermissionDenied("Only admins/managers of this org can modify action points.")

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast("client-action-points", "UPDATE", ClientActionPointSerializer(obj).data)

    def perform_destroy(self, instance):
        broadcast(
            "client-action-points",
            "DELETE",
            {"id": instance.pk, "uid": str(instance.uid), "meeting_id": instance.meeting_id},
        )
        instance.delete()

    @action(detail=False, methods=["get"], url_path="overdue")
    def overdue(self, request):
        from django.utils import timezone

        today = timezone.localdate()
        user = cast(User, request.user)
        qs = (
            ClientActionPoint.objects.select_related(
                "meeting", "meeting__client", "responsibility"
            )
            .filter(meeting__org_id__in=user.org_ids())
            .filter(target_date__lt=today)
            .exclude(status__in=["Completed", "Cancelled"])
            .order_by("target_date")
        )
        return Response(ClientActionPointSerializer(qs, many=True).data)


class ClientMeetingAttachmentViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = ClientMeetingAttachmentSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrManagerInAny]
    http_method_names = ["get", "delete", "head", "options"]

    def get_queryset(self):
        user = cast(User, self.request.user)
        return ClientMeetingAttachment.objects.select_related("meeting").filter(
            meeting__org_id__in=user.org_ids()
        )

    def check_object_permissions(self, request, obj):
        super().check_object_permissions(request, obj)
        if request.method in permissions.SAFE_METHODS:
            return
        user = cast(User, request.user)
        target_org = getattr(obj.meeting, "org", None)
        if not (user.is_admin_in(target_org) or user.is_manager_in(target_org)):
            raise PermissionDenied("Only admins/managers of this org can delete attachments.")

    def perform_destroy(self, instance):
        meeting = instance.meeting
        broadcast(
            "client-meetings",
            "UPDATE",
            ClientMeetingSerializer(meeting).data,
        )
        instance.file.delete(save=False)
        instance.delete()
```

If the existing file has a `from django.db.models import Q` import already present (used by `MasterViewSet.get_queryset`), keep it at the top level instead of importing it inside the function — the top-level import is already in the file.

- [ ] **Step 4.2: Register routes in `core/masters/urls.py`**

Replace the contents of `core/masters/urls.py` with:

```python
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    ClientActionPointViewSet,
    ClientMeetingAttachmentViewSet,
    ClientMeetingViewSet,
    ClientRoadmapViewSet,
    MasterViewSet,
)

router = DefaultRouter()
router.register("masters", MasterViewSet, basename="master")
router.register("client-roadmap", ClientRoadmapViewSet, basename="client-roadmap")
router.register("client-meetings", ClientMeetingViewSet, basename="client-meeting")
router.register("client-action-points", ClientActionPointViewSet, basename="client-action-point")
router.register("client-attachments", ClientMeetingAttachmentViewSet, basename="client-attachment")

urlpatterns = [path("", include(router.urls))]
```

- [ ] **Step 4.3: Run system check**

```bash
python manage.py check
```

Expected: `System check identified no issues`.

- [ ] **Step 4.4: Commit**

```bash
git add core/masters/views.py core/masters/urls.py
git commit -m "feat(masters): add Client Management viewsets and routes"
```

---

## Task 5 — Backend tests

**Files:**
- Create: `core/masters/tests.py` (replace the stub)

- [ ] **Step 5.1: Write the failing tests**

Replace the entire contents of `core/masters/tests.py` with:

```python
import datetime

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from core.masters.models import (
    ClientActionPoint,
    ClientMeeting,
    ClientMeetingAttachment,
    ClientRoadmap,
    Master,
)
from users.models import Org, OrgMembership

User = get_user_model()


def _auth(client: APIClient, user) -> None:
    client.force_authenticate(user=user)


def _make_org_user(username: str, role: str = "admin"):
    org = Org.objects.create(name=f"Org-{username}")
    user = User.objects.create_user(username=username, password="pw", full_name=username.title())
    OrgMembership.objects.create(user=user, org=org, role=role)
    return org, user


def _make_client(org: Org, name: str = "Acme") -> Master:
    m = Master.objects.create(name=name, type="client", org=org)
    m.orgs.add(org)
    return m


class ClientRoadmapCrudTests(TestCase):
    def setUp(self):
        self.org, self.admin = _make_org_user("admin1", role="admin")
        self.client_api = APIClient()
        _auth(self.client_api, self.admin)
        self.client_master = _make_client(self.org)

    def test_admin_creates_roadmap_item(self):
        payload = {
            "client": str(self.client_master.uid),
            "title": "Launch site",
            "target_date": "2026-06-01",
            "priority": "High",
            "status": "In Progress",
        }
        res = self.client_api.post("/api/client-roadmap/", payload, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(ClientRoadmap.objects.count(), 1)
        row = ClientRoadmap.objects.first()
        self.assertEqual(row.org_id, self.org.id)
        self.assertEqual(row.created_by_id, self.admin.id)

    def test_employee_cannot_write_roadmap(self):
        _, employee = _make_org_user("emp1", role="employee")
        OrgMembership.objects.filter(user=employee).delete()
        OrgMembership.objects.create(user=employee, org=self.org, role="employee")

        self.client_api.force_authenticate(user=employee)
        res = self.client_api.post(
            "/api/client-roadmap/",
            {"client": str(self.client_master.uid), "title": "Nope"},
            format="json",
        )
        self.assertEqual(res.status_code, 403, res.data)

    def test_employee_can_read_roadmap(self):
        ClientRoadmap.objects.create(org=self.org, client=self.client_master, title="X")
        _, employee = _make_org_user("emp2", role="employee")
        OrgMembership.objects.filter(user=employee).delete()
        OrgMembership.objects.create(user=employee, org=self.org, role="employee")
        self.client_api.force_authenticate(user=employee)
        res = self.client_api.get("/api/client-roadmap/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 1)


class ClientMeetingCrudTests(TestCase):
    def setUp(self):
        self.org, self.admin = _make_org_user("madmin", role="admin")
        self.client_api = APIClient()
        _auth(self.client_api, self.admin)
        self.client_master = _make_client(self.org)

    def test_create_meeting_and_add_action_point(self):
        res = self.client_api.post(
            "/api/client-meetings/",
            {
                "client": str(self.client_master.uid),
                "meeting_date": "2026-04-20",
                "meeting_type": "Review",
                "mode": "Video",
                "agenda": "Quarterly review",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)
        meeting_uid = res.data["uid"]
        self.assertEqual(ClientMeeting.objects.count(), 1)

        ap_res = self.client_api.post(
            f"/api/client-meetings/{meeting_uid}/action-points/",
            {
                "description": "Ship analytics dashboard",
                "responsibility": str(self.admin.uid),
                "target_date": "2026-05-15",
                "priority": "High",
            },
            format="json",
        )
        self.assertEqual(ap_res.status_code, 201, ap_res.data)
        self.assertEqual(ClientActionPoint.objects.count(), 1)

    def test_cascade_delete_action_points_with_meeting(self):
        meeting = ClientMeeting.objects.create(
            org=self.org, client=self.client_master, meeting_date=datetime.date(2026, 4, 20)
        )
        ClientActionPoint.objects.create(meeting=meeting, description="A")
        ClientActionPoint.objects.create(meeting=meeting, description="B")
        self.assertEqual(ClientActionPoint.objects.count(), 2)

        res = self.client_api.delete(f"/api/client-meetings/{meeting.uid}/")
        self.assertEqual(res.status_code, 204)
        self.assertEqual(ClientActionPoint.objects.count(), 0)

    def test_overdue_endpoint_lists_overdue_only(self):
        meeting = ClientMeeting.objects.create(
            org=self.org, client=self.client_master, meeting_date=datetime.date(2026, 1, 1)
        )
        # Overdue: target in the past, not Completed/Cancelled
        ClientActionPoint.objects.create(
            meeting=meeting, description="Overdue", target_date=datetime.date(2026, 1, 10), status="Open"
        )
        # Completed in the past: should NOT be overdue
        ClientActionPoint.objects.create(
            meeting=meeting,
            description="Done",
            target_date=datetime.date(2026, 1, 10),
            status="Completed",
            completion_date=datetime.date(2026, 1, 11),
        )
        # Future target
        ClientActionPoint.objects.create(
            meeting=meeting,
            description="Future",
            target_date=datetime.date(2099, 1, 1),
            status="Open",
        )

        res = self.client_api.get("/api/client-action-points/overdue/")
        self.assertEqual(res.status_code, 200)
        descs = sorted(row["description"] for row in res.data)
        self.assertEqual(descs, ["Overdue"])


class ClientActionPointUpdateTests(TestCase):
    def setUp(self):
        self.org, self.admin = _make_org_user("aadmin", role="admin")
        self.client_api = APIClient()
        _auth(self.client_api, self.admin)
        self.client_master = _make_client(self.org)
        self.meeting = ClientMeeting.objects.create(
            org=self.org, client=self.client_master, meeting_date=datetime.date(2026, 4, 20)
        )
        self.ap = ClientActionPoint.objects.create(meeting=self.meeting, description="Initial")

    def test_patch_status_and_completion(self):
        res = self.client_api.patch(
            f"/api/client-action-points/{self.ap.uid}/",
            {"status": "Completed", "completion_date": "2026-04-25"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.ap.refresh_from_db()
        self.assertEqual(self.ap.status, "Completed")
        self.assertEqual(self.ap.completion_date, datetime.date(2026, 4, 25))

    def test_cross_org_user_cannot_patch(self):
        other_org, other_admin = _make_org_user("other", role="admin")
        self.client_api.force_authenticate(user=other_admin)
        res = self.client_api.patch(
            f"/api/client-action-points/{self.ap.uid}/",
            {"status": "Completed"},
            format="json",
        )
        # Object falls outside the caller's org queryset → 404 (not 403) by design:
        # `get_queryset` filters to the caller's orgs, so the object doesn't exist from their perspective.
        self.assertIn(res.status_code, (403, 404))


class AttachmentUploadTests(TestCase):
    def setUp(self):
        self.org, self.admin = _make_org_user("attach", role="admin")
        self.client_api = APIClient()
        _auth(self.client_api, self.admin)
        self.client_master = _make_client(self.org)
        self.meeting = ClientMeeting.objects.create(
            org=self.org, client=self.client_master, meeting_date=datetime.date(2026, 4, 20)
        )

    def test_upload_attachment(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        upload = SimpleUploadedFile("notes.txt", b"hello world", content_type="text/plain")
        res = self.client_api.post(
            f"/api/client-meetings/{self.meeting.uid}/attachments/",
            {"file": upload},
            format="multipart",
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(ClientMeetingAttachment.objects.count(), 1)
        att = ClientMeetingAttachment.objects.first()
        self.assertEqual(att.filename, "notes.txt")
        self.assertEqual(att.size_bytes, len(b"hello world"))
        self.assertEqual(att.uploaded_by_id, self.admin.id)
```

- [ ] **Step 5.2: Run the tests — expect FAIL on anything broken, PASS when green**

```bash
python manage.py test core.masters -v 2
```

Expected: `OK` with 8 tests passing (roadmap create, employee read/write, meeting CRUD + action point add, cascade delete, overdue endpoint, action point patch, cross-org block, attachment upload).

If any test fails, fix the underlying code in Tasks 1–4 — the test is the spec.

- [ ] **Step 5.3: Commit**

```bash
git add core/masters/tests.py
git commit -m "test(masters): cover Client Management CRUD, permissions, overdue endpoint"
```

---

## Task 6 — Frontend DTOs & domain types

**Files:**
- Create: `frontend/task-tracker/src/types/api/clients.ts`
- Modify: `frontend/task-tracker/src/types/api/index.ts` (re-export)

- [ ] **Step 6.1: Add the DTOs**

Create `frontend/task-tracker/src/types/api/clients.ts`:

```typescript
import type { MasterDto } from "./masters";

export interface UserMinDto {
  readonly id: number;
  readonly uid: string;
  readonly full_name: string;
  readonly username: string;
  readonly avatar_color?: string;
}

export type RoadmapStatus =
  | "Not Started"
  | "In Progress"
  | "Achieved"
  | "At Risk"
  | "Cancelled";

export type Priority = "High" | "Medium" | "Low";

export type MeetingType = "Review" | "Kickoff" | "Escalation" | "Strategic" | "Ad-hoc";
export type MeetingMode = "In-person" | "Video" | "Phone";

export type ActionPointStatus =
  | "Open"
  | "In Progress"
  | "Completed"
  | "Cancelled";

export interface ClientAttendee {
  readonly name: string;
  readonly designation?: string;
  readonly email?: string;
}

export interface ClientRoadmapDto {
  readonly id: number;
  readonly uid: string;
  readonly org_uid: string | null;
  readonly client: string | null;
  readonly client_detail: Pick<MasterDto, "id" | "uid" | "name" | "type" | "color"> | null;
  readonly title: string;
  readonly description: string;
  readonly owner: string | null;
  readonly owner_detail: UserMinDto | null;
  readonly target_date: string | null;
  readonly completion_date: string | null;
  readonly status: RoadmapStatus;
  readonly priority: Priority;
  readonly progress_notes: string;
  readonly category: string;
  readonly created_by_detail: UserMinDto | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ClientRoadmapWrite {
  readonly client: string;
  readonly title: string;
  readonly description?: string;
  readonly owner?: string | null;
  readonly target_date?: string | null;
  readonly completion_date?: string | null;
  readonly status?: RoadmapStatus;
  readonly priority?: Priority;
  readonly progress_notes?: string;
  readonly category?: string;
  readonly org?: string;
}

export interface ClientActionPointDto {
  readonly id: number;
  readonly uid: string;
  readonly meeting: number;
  readonly description: string;
  readonly responsibility: string | null;
  readonly responsibility_detail: UserMinDto | null;
  readonly target_date: string | null;
  readonly completion_date: string | null;
  readonly status: ActionPointStatus;
  readonly priority: Priority;
  readonly remarks: string;
  readonly roadmap_link: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ClientActionPointWrite {
  readonly description: string;
  readonly responsibility?: string | null;
  readonly target_date?: string | null;
  readonly completion_date?: string | null;
  readonly status?: ActionPointStatus;
  readonly priority?: Priority;
  readonly remarks?: string;
  readonly roadmap_link?: string | null;
}

export interface ClientMeetingAttachmentDto {
  readonly id: number;
  readonly uid: string;
  readonly meeting: number;
  readonly filename: string;
  readonly size_bytes: number;
  readonly uploaded_by_detail: UserMinDto | null;
  readonly uploaded_at: string;
  readonly download_url: string;
}

export interface ClientMeetingDto {
  readonly id: number;
  readonly uid: string;
  readonly org_uid: string | null;
  readonly client: string | null;
  readonly client_detail: Pick<MasterDto, "id" | "uid" | "name" | "type" | "color"> | null;
  readonly meeting_date: string;
  readonly meeting_time: string | null;
  readonly meeting_type: MeetingType;
  readonly mode: MeetingMode;
  readonly venue: string;
  readonly conducted_by: string | null;
  readonly conducted_by_detail: UserMinDto | null;
  readonly our_attendees: readonly string[];
  readonly our_attendees_detail: readonly UserMinDto[];
  readonly client_attendees: readonly ClientAttendee[];
  readonly agenda: string;
  readonly minutes: string;
  readonly next_meeting_date: string | null;
  readonly action_points: readonly ClientActionPointDto[];
  readonly attachments: readonly ClientMeetingAttachmentDto[];
  readonly created_by_detail: UserMinDto | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ClientMeetingWrite {
  readonly client: string;
  readonly meeting_date: string;
  readonly meeting_time?: string | null;
  readonly meeting_type?: MeetingType;
  readonly mode?: MeetingMode;
  readonly venue?: string;
  readonly conducted_by?: string | null;
  readonly our_attendees?: readonly string[];
  readonly client_attendees?: readonly ClientAttendee[];
  readonly agenda?: string;
  readonly minutes?: string;
  readonly next_meeting_date?: string | null;
  readonly org?: string;
}
```

- [ ] **Step 6.2: Re-export from the barrel**

Open `frontend/task-tracker/src/types/api/index.ts` and add `export * from "./clients";` at the end of the file (keep existing exports intact).

- [ ] **Step 6.3: Type-check**

```bash
cd frontend/task-tracker && npx tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 6.4: Commit**

```bash
git add frontend/task-tracker/src/types/api/clients.ts frontend/task-tracker/src/types/api/index.ts
git commit -m "feat(frontend): add DTOs for Client Management API"
```

---

## Task 7 — Frontend hooks for roadmap, meetings, overdue

**Files:**
- Create: `frontend/task-tracker/src/hooks/useClientRoadmap.ts`
- Create: `frontend/task-tracker/src/hooks/useClientMeetings.ts`
- Create: `frontend/task-tracker/src/hooks/useOverdueActionPoints.ts`

- [ ] **Step 7.1: `useClientRoadmap`**

Create `frontend/task-tracker/src/hooks/useClientRoadmap.ts`:

```typescript
import { useCallback, useEffect, useState } from "react";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  ws,
} from "@/lib/api";
import type {
  ClientRoadmapDto,
  ClientRoadmapWrite,
} from "@/types/api/clients";

export interface UseClientRoadmapReturn {
  items: ClientRoadmapDto[];
  loading: boolean;
  reload: (clientUid?: string) => Promise<void>;
  create: (body: ClientRoadmapWrite) => Promise<ClientRoadmapDto>;
  update: (uid: string, body: Partial<ClientRoadmapWrite>) => Promise<ClientRoadmapDto>;
  remove: (uid: string) => Promise<void>;
}

export function useClientRoadmap(clientUid?: string): UseClientRoadmapReturn {
  const [items, setItems] = useState<ClientRoadmapDto[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(
    async (uid?: string): Promise<void> => {
      const query = uid ?? clientUid ? { client_uid: (uid ?? clientUid) as string } : undefined;
      const data = await apiGet<ClientRoadmapDto[]>("/client-roadmap/", query);
      setItems(data);
    },
    [clientUid],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reload();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const unsub = ws.subscribe<ClientRoadmapDto>("client-roadmap", (evt) => {
      if (evt.event === "INSERT" && evt.record) {
        const next = evt.record;
        if (clientUid && next.client !== clientUid) return;
        setItems((prev) => (prev.some((r) => r.uid === next.uid) ? prev : [next, ...prev]));
      } else if (evt.event === "UPDATE" && evt.record) {
        const next = evt.record;
        setItems((prev) => prev.map((r) => (r.uid === next.uid ? next : r)));
      } else if (evt.event === "DELETE" && evt.record) {
        const deletedUid = (evt.record as { uid?: string }).uid;
        if (deletedUid) setItems((prev) => prev.filter((r) => r.uid !== deletedUid));
      }
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [reload, clientUid]);

  const create = useCallback(async (body: ClientRoadmapWrite) => {
    const dto = await apiPost<ClientRoadmapDto>("/client-roadmap/", body);
    setItems((prev) => [dto, ...prev]);
    return dto;
  }, []);

  const update = useCallback(
    async (uid: string, body: Partial<ClientRoadmapWrite>) => {
      const dto = await apiPatch<ClientRoadmapDto>(`/client-roadmap/${uid}/`, body);
      setItems((prev) => prev.map((r) => (r.uid === uid ? dto : r)));
      return dto;
    },
    [],
  );

  const remove = useCallback(async (uid: string) => {
    await apiDelete(`/client-roadmap/${uid}/`);
    setItems((prev) => prev.filter((r) => r.uid !== uid));
  }, []);

  return { items, loading, reload, create, update, remove };
}
```

- [ ] **Step 7.2: `useClientMeetings`**

Create `frontend/task-tracker/src/hooks/useClientMeetings.ts`:

```typescript
import { useCallback, useEffect, useState } from "react";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPostForm,
  ws,
} from "@/lib/api";
import type {
  ClientActionPointDto,
  ClientActionPointWrite,
  ClientMeetingAttachmentDto,
  ClientMeetingDto,
  ClientMeetingWrite,
} from "@/types/api/clients";

export interface UseClientMeetingsReturn {
  meetings: ClientMeetingDto[];
  loading: boolean;
  reload: (clientUid?: string) => Promise<void>;
  createMeeting: (body: ClientMeetingWrite) => Promise<ClientMeetingDto>;
  updateMeeting: (
    uid: string,
    body: Partial<ClientMeetingWrite>,
  ) => Promise<ClientMeetingDto>;
  deleteMeeting: (uid: string) => Promise<void>;
  addActionPoint: (
    meetingUid: string,
    body: ClientActionPointWrite,
  ) => Promise<ClientActionPointDto>;
  updateActionPoint: (
    apUid: string,
    body: Partial<ClientActionPointWrite>,
  ) => Promise<ClientActionPointDto>;
  deleteActionPoint: (apUid: string) => Promise<void>;
  uploadAttachment: (
    meetingUid: string,
    file: File,
  ) => Promise<ClientMeetingAttachmentDto>;
  deleteAttachment: (attachmentUid: string) => Promise<void>;
}

function replaceActionPoint(
  meetings: ClientMeetingDto[],
  ap: ClientActionPointDto,
): ClientMeetingDto[] {
  return meetings.map((m) =>
    m.id === ap.meeting
      ? {
          ...m,
          action_points: m.action_points.some((x) => x.uid === ap.uid)
            ? m.action_points.map((x) => (x.uid === ap.uid ? ap : x))
            : [...m.action_points, ap],
        }
      : m,
  );
}

export function useClientMeetings(clientUid?: string): UseClientMeetingsReturn {
  const [meetings, setMeetings] = useState<ClientMeetingDto[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(
    async (uid?: string): Promise<void> => {
      const query = (uid ?? clientUid) ? { client_uid: (uid ?? clientUid) as string } : undefined;
      const data = await apiGet<ClientMeetingDto[]>("/client-meetings/", query);
      setMeetings(data);
    },
    [clientUid],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reload();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const unsubMeetings = ws.subscribe<ClientMeetingDto>("client-meetings", (evt) => {
      if (evt.event === "INSERT" && evt.record) {
        const next = evt.record;
        if (clientUid && next.client !== clientUid) return;
        setMeetings((prev) => (prev.some((m) => m.uid === next.uid) ? prev : [next, ...prev]));
      } else if (evt.event === "UPDATE" && evt.record) {
        const next = evt.record;
        setMeetings((prev) => prev.map((m) => (m.uid === next.uid ? next : m)));
      } else if (evt.event === "DELETE" && evt.record) {
        const deletedUid = (evt.record as { uid?: string }).uid;
        if (deletedUid) setMeetings((prev) => prev.filter((m) => m.uid !== deletedUid));
      }
    });

    const unsubAP = ws.subscribe<ClientActionPointDto>("client-action-points", (evt) => {
      if (evt.event === "INSERT" && evt.record) {
        setMeetings((prev) => replaceActionPoint(prev, evt.record!));
      } else if (evt.event === "UPDATE" && evt.record) {
        setMeetings((prev) => replaceActionPoint(prev, evt.record!));
      } else if (evt.event === "DELETE" && evt.record) {
        const payload = evt.record as { uid?: string; meeting_id?: number };
        if (!payload.uid || payload.meeting_id === undefined) return;
        setMeetings((prev) =>
          prev.map((m) =>
            m.id === payload.meeting_id
              ? { ...m, action_points: m.action_points.filter((ap) => ap.uid !== payload.uid) }
              : m,
          ),
        );
      }
    });

    return () => {
      cancelled = true;
      unsubMeetings();
      unsubAP();
    };
  }, [reload, clientUid]);

  const createMeeting = useCallback(async (body: ClientMeetingWrite) => {
    const dto = await apiPost<ClientMeetingDto>("/client-meetings/", body);
    setMeetings((prev) => [dto, ...prev]);
    return dto;
  }, []);

  const updateMeeting = useCallback(
    async (uid: string, body: Partial<ClientMeetingWrite>) => {
      const dto = await apiPatch<ClientMeetingDto>(`/client-meetings/${uid}/`, body);
      setMeetings((prev) => prev.map((m) => (m.uid === uid ? dto : m)));
      return dto;
    },
    [],
  );

  const deleteMeeting = useCallback(async (uid: string) => {
    await apiDelete(`/client-meetings/${uid}/`);
    setMeetings((prev) => prev.filter((m) => m.uid !== uid));
  }, []);

  const addActionPoint = useCallback(
    async (meetingUid: string, body: ClientActionPointWrite) => {
      const dto = await apiPost<ClientActionPointDto>(
        `/client-meetings/${meetingUid}/action-points/`,
        body,
      );
      setMeetings((prev) => replaceActionPoint(prev, dto));
      return dto;
    },
    [],
  );

  const updateActionPoint = useCallback(
    async (apUid: string, body: Partial<ClientActionPointWrite>) => {
      const dto = await apiPatch<ClientActionPointDto>(
        `/client-action-points/${apUid}/`,
        body,
      );
      setMeetings((prev) => replaceActionPoint(prev, dto));
      return dto;
    },
    [],
  );

  const deleteActionPoint = useCallback(async (apUid: string) => {
    await apiDelete(`/client-action-points/${apUid}/`);
    setMeetings((prev) =>
      prev.map((m) => ({
        ...m,
        action_points: m.action_points.filter((ap) => ap.uid !== apUid),
      })),
    );
  }, []);

  const uploadAttachment = useCallback(
    async (meetingUid: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      const dto = await apiPostForm<ClientMeetingAttachmentDto>(
        `/client-meetings/${meetingUid}/attachments/`,
        form,
      );
      setMeetings((prev) =>
        prev.map((m) =>
          m.uid === meetingUid ? { ...m, attachments: [dto, ...m.attachments] } : m,
        ),
      );
      return dto;
    },
    [],
  );

  const deleteAttachment = useCallback(async (attachmentUid: string) => {
    await apiDelete(`/client-attachments/${attachmentUid}/`);
    setMeetings((prev) =>
      prev.map((m) => ({
        ...m,
        attachments: m.attachments.filter((a) => a.uid !== attachmentUid),
      })),
    );
  }, []);

  return {
    meetings,
    loading,
    reload,
    createMeeting,
    updateMeeting,
    deleteMeeting,
    addActionPoint,
    updateActionPoint,
    deleteActionPoint,
    uploadAttachment,
    deleteAttachment,
  };
}
```

- [ ] **Step 7.3: `useOverdueActionPoints`**

Create `frontend/task-tracker/src/hooks/useOverdueActionPoints.ts`:

```typescript
import { useCallback, useEffect, useState } from "react";
import { apiGet, ws } from "@/lib/api";
import type { ClientActionPointDto } from "@/types/api/clients";

export interface UseOverdueActionPointsReturn {
  overdue: ClientActionPointDto[];
  loading: boolean;
  reload: () => Promise<void>;
}

export function useOverdueActionPoints(): UseOverdueActionPointsReturn {
  const [overdue, setOverdue] = useState<ClientActionPointDto[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const data = await apiGet<ClientActionPointDto[]>("/client-action-points/overdue/");
    setOverdue(data);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reload();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    // Any action-point mutation could change the overdue list — refetch on every event.
    const unsub = ws.subscribe<ClientActionPointDto>("client-action-points", () => {
      void reload();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [reload]);

  return { overdue, loading, reload };
}
```

- [ ] **Step 7.4: Type-check**

```bash
cd frontend/task-tracker && npx tsc -b --noEmit
```

Expected: no errors.

- [ ] **Step 7.5: Commit**

```bash
git add frontend/task-tracker/src/hooks/useClientRoadmap.ts frontend/task-tracker/src/hooks/useClientMeetings.ts frontend/task-tracker/src/hooks/useOverdueActionPoints.ts
git commit -m "feat(frontend): add hooks for Client Management (roadmap, meetings, overdue)"
```

---

## Task 8 — ClientsPage skeleton + nav registration

**Files:**
- Create: `frontend/task-tracker/src/pages/ClientsPage.tsx`
- Modify: `frontend/task-tracker/src/App.tsx`
- Modify: `frontend/task-tracker/src/components/layout/Header.tsx`

- [ ] **Step 8.1: Scaffold `ClientsPage.tsx`**

Create `frontend/task-tracker/src/pages/ClientsPage.tsx` with the top bar, sub-tabs, and placeholders that Tasks 9–11 will fill in:

```tsx
import { useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useMasters } from "@/hooks/useMasters";
import { useOverdueActionPoints } from "@/hooks/useOverdueActionPoints";
import type { Profile } from "@/types/auth";

interface ClientsPageProps {
  profile: Profile | null;
  profiles: Profile[];
  selectedOrg: string | null;
}

type SubTab = "roadmap" | "mom" | "overdue";

export default function ClientsPage({ profile, profiles, selectedOrg }: ClientsPageProps) {
  const { isAdminInAny, isManagerInAny } = useAuth();
  const canWrite = isAdminInAny() || isManagerInAny();
  const { clients } = useMasters();
  const { overdue } = useOverdueActionPoints();
  const [subTab, setSubTab] = useState<SubTab>("roadmap");
  const [selectedClientUid, setSelectedClientUid] = useState<string>("");

  const scopedClients = useMemo(
    () =>
      selectedOrg
        ? clients.filter((c) => c.orgs.includes(selectedOrg))
        : clients,
    [clients, selectedOrg],
  );

  return (
    <div style={{ padding: 16 }}>
      {/* Top strip: client selector + overdue card */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <label style={{ fontSize: 13, fontWeight: 600 }}>Client</label>
        <select
          value={selectedClientUid}
          onChange={(e) => setSelectedClientUid(e.target.value)}
          style={{ padding: "6px 10px", border: "1px solid #cbd5e1", borderRadius: 6, minWidth: 240 }}
        >
          <option value="">— Select a client —</option>
          {scopedClients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => setSubTab("overdue")}
          style={{
            marginLeft: "auto",
            padding: "8px 14px",
            background: overdue.length ? "#fee2e2" : "#f1f5f9",
            color: overdue.length ? "#b91c1c" : "#475569",
            border: `1px solid ${overdue.length ? "#fecaca" : "#e2e8f0"}`,
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          ⚠ {overdue.length} overdue action point{overdue.length === 1 ? "" : "s"}
        </button>
      </div>

      {/* Sub-tab bar */}
      <div
        style={{
          display: "flex",
          gap: 6,
          background: "#f1f5f9",
          padding: 4,
          borderRadius: 8,
          width: "fit-content",
          marginBottom: 12,
        }}
      >
        {(
          [
            { id: "roadmap", label: "🗺️ Road Map" },
            { id: "mom", label: "📋 MOM & Action Points" },
            { id: "overdue", label: "⚠ Overdue" },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubTab(t.id)}
            style={{
              padding: "7px 18px",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              background: subTab === t.id ? "#fff" : "transparent",
              color: subTab === t.id ? "#1e293b" : "#64748b",
              boxShadow: subTab === t.id ? "0 1px 3px rgba(0,0,0,.1)" : "none",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === "roadmap" && (
        <ClientRoadmapTabPlaceholder clientUid={selectedClientUid} canWrite={canWrite} />
      )}
      {subTab === "mom" && (
        <ClientMOMTabPlaceholder
          clientUid={selectedClientUid}
          profile={profile}
          profiles={profiles}
          canWrite={canWrite}
        />
      )}
      {subTab === "overdue" && <OverdueActionPointsPlaceholder />}
    </div>
  );
}

// These four placeholders are replaced in Tasks 9–11. Keeping them here keeps
// this file compiling between tasks.

function ClientRoadmapTabPlaceholder(_props: { clientUid: string; canWrite: boolean }) {
  return <div style={{ color: "#64748b" }}>Road Map tab — implemented in Task 9.</div>;
}

function ClientMOMTabPlaceholder(_props: {
  clientUid: string;
  profile: Profile | null;
  profiles: Profile[];
  canWrite: boolean;
}) {
  return <div style={{ color: "#64748b" }}>MOM tab — implemented in Task 10.</div>;
}

function OverdueActionPointsPlaceholder() {
  return <div style={{ color: "#64748b" }}>Overdue panel — implemented in Task 11.</div>;
}
```

- [ ] **Step 8.2: Register the view in `App.tsx`**

In `frontend/task-tracker/src/App.tsx` add a lazy import near the other `const ... = lazy(...)` lines (around line 26):

```tsx
const ClientsPage = lazy(() => import("./pages/ClientsPage"));
```

Then inside the `VIEW_MAP` object (around line 283) add after the `leads` entry:

```tsx
    clients: (
      <ClientsPage
        profile={profile}
        profiles={profiles}
        selectedOrg={selectedOrg}
      />
    ),
```

- [ ] **Step 8.3: Add the nav button to `Header.tsx`**

Open `frontend/task-tracker/src/components/layout/Header.tsx`. In the icon map (where `leads: (...)`, `pacemeet: (...)` etc. live) add a new entry after `leads`:

```tsx
    clients: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <path d="M3 21v-2a4 4 0 014-4h3" />
        <circle cx="9" cy="7" r="4" />
        <path d="M16 3.13a4 4 0 010 7.75" />
        <path d="M14 14l4 4 6-6" />
      </svg>
    ),
```

Then find where the nav items are rendered (search for `leads` inside the rendered nav). Add a **Clients** button alongside the existing nav items — match the style/props of the neighbouring `leads` button exactly; the new button's `value` (or `onClick` target) must be the string `"clients"` so it flips `view` to that key.

- [ ] **Step 8.4: Type-check + lint**

```bash
cd frontend/task-tracker && npx tsc -b --noEmit && npm run lint
```

Expected: no errors.

- [ ] **Step 8.5: Manual smoke test**

Start the backend and frontend locally (`python manage.py runserver` + `cd frontend/task-tracker && npm run dev`), log in, click the **Clients** nav. The page shows the client dropdown, overdue button (count 0), sub-tab bar, and placeholder sub-tab text.

- [ ] **Step 8.6: Commit**

```bash
git add frontend/task-tracker/src/pages/ClientsPage.tsx frontend/task-tracker/src/App.tsx frontend/task-tracker/src/components/layout/Header.tsx
git commit -m "feat(frontend): scaffold Clients page, nav tab, and sub-tab bar"
```

---

## Task 9 — Road Map tab + modal

**Files:**
- Create: `frontend/task-tracker/src/components/clients/ClientRoadmapTab.tsx`
- Create: `frontend/task-tracker/src/components/clients/ClientRoadmapModal.tsx`
- Modify: `frontend/task-tracker/src/pages/ClientsPage.tsx` (swap in real component)

- [ ] **Step 9.1: Build the modal**

Create `frontend/task-tracker/src/components/clients/ClientRoadmapModal.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { Profile } from "@/types/auth";
import type {
  ClientRoadmapDto,
  ClientRoadmapWrite,
  Priority,
  RoadmapStatus,
} from "@/types/api/clients";

interface Props {
  open: boolean;
  clientUid: string;
  existing: ClientRoadmapDto | null;
  profiles: Profile[];
  onClose: () => void;
  onSubmit: (body: ClientRoadmapWrite) => Promise<void>;
}

const STATUSES: RoadmapStatus[] = [
  "Not Started",
  "In Progress",
  "Achieved",
  "At Risk",
  "Cancelled",
];
const PRIORITIES: Priority[] = ["High", "Medium", "Low"];

export default function ClientRoadmapModal({
  open,
  clientUid,
  existing,
  profiles,
  onClose,
  onSubmit,
}: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ownerUid, setOwnerUid] = useState<string>("");
  const [targetDate, setTargetDate] = useState<string>("");
  const [completionDate, setCompletionDate] = useState<string>("");
  const [status, setStatus] = useState<RoadmapStatus>("Not Started");
  const [priority, setPriority] = useState<Priority>("Medium");
  const [category, setCategory] = useState("");
  const [progressNotes, setProgressNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(existing?.title ?? "");
    setDescription(existing?.description ?? "");
    setOwnerUid(existing?.owner ?? "");
    setTargetDate(existing?.target_date ?? "");
    setCompletionDate(existing?.completion_date ?? "");
    setStatus(existing?.status ?? "Not Started");
    setPriority(existing?.priority ?? "Medium");
    setCategory(existing?.category ?? "");
    setProgressNotes(existing?.progress_notes ?? "");
  }, [open, existing]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !clientUid) return;
    setSaving(true);
    try {
      await onSubmit({
        client: clientUid,
        title: title.trim(),
        description,
        owner: ownerUid || null,
        target_date: targetDate || null,
        completion_date: completionDate || null,
        status,
        priority,
        category,
        progress_notes: progressNotes,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, .4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{
          background: "#fff",
          padding: 20,
          borderRadius: 8,
          width: 520,
          maxWidth: "92vw",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <h3 style={{ margin: 0 }}>{existing ? "Edit roadmap item" : "Add roadmap item"}</h3>

        <label style={labelStyle}>Title*</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} required style={inputStyle} />

        <label style={labelStyle}>Description</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} style={inputStyle} />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <label style={labelStyle}>Owner</label>
            <select value={ownerUid} onChange={(e) => setOwnerUid(e.target.value)} style={inputStyle}>
              <option value="">— Unassigned —</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Category</label>
            <input value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Target date</label>
            <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Completion date</label>
            <input
              type="date"
              value={completionDate}
              onChange={(e) => setCompletionDate(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as RoadmapStatus)} style={inputStyle}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Priority</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} style={inputStyle}>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label style={labelStyle}>Progress notes</label>
        <textarea value={progressNotes} onChange={(e) => setProgressNotes(e.target.value)} rows={2} style={inputStyle} />

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
          <button type="button" onClick={onClose} style={btnSecondary}>
            Cancel
          </button>
          <button type="submit" disabled={saving || !title.trim() || !clientUid} style={btnPrimary}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#475569" };
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  fontSize: 13,
};
const btnPrimary: React.CSSProperties = {
  padding: "8px 14px",
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontWeight: 600,
};
const btnSecondary: React.CSSProperties = {
  padding: "8px 14px",
  background: "#f1f5f9",
  color: "#1e293b",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  cursor: "pointer",
};
```

- [ ] **Step 9.2: Build the tab**

Create `frontend/task-tracker/src/components/clients/ClientRoadmapTab.tsx`:

```tsx
import { useMemo, useState } from "react";
import { useClientRoadmap } from "@/hooks/useClientRoadmap";
import ClientRoadmapModal from "./ClientRoadmapModal";
import type { Profile } from "@/types/auth";
import type {
  ClientRoadmapDto,
  Priority,
  RoadmapStatus,
} from "@/types/api/clients";

interface Props {
  clientUid: string;
  profiles: Profile[];
  canWrite: boolean;
}

const STATUSES: RoadmapStatus[] = ["Not Started", "In Progress", "Achieved", "At Risk", "Cancelled"];
const PRIORITIES: Priority[] = ["High", "Medium", "Low"];

export default function ClientRoadmapTab({ clientUid, profiles, canWrite }: Props) {
  const { items, loading, create, update, remove } = useClientRoadmap(clientUid || undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ClientRoadmapDto | null>(null);
  const [statusFilter, setStatusFilter] = useState<RoadmapStatus | "">("");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "">("");
  const [overdueOnly, setOverdueOnly] = useState(false);

  const filtered = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return items.filter((r) => {
      if (clientUid && r.client !== clientUid) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (priorityFilter && r.priority !== priorityFilter) return false;
      if (overdueOnly) {
        if (!r.target_date) return false;
        if (r.status === "Achieved" || r.status === "Cancelled") return false;
        if (r.target_date >= today) return false;
      }
      return true;
    });
  }, [items, clientUid, statusFilter, priorityFilter, overdueOnly]);

  if (!clientUid) {
    return <div style={{ color: "#64748b" }}>Select a client to view their road map.</div>;
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as RoadmapStatus | "")} style={filterStyle}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as Priority | "")} style={filterStyle}>
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
          Overdue only
        </label>
        {canWrite && (
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
            style={btnPrimary}
          >
            + Add roadmap item
          </button>
        )}
      </div>

      {loading ? (
        <div>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ color: "#64748b" }}>No roadmap items yet.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f8fafc", textAlign: "left" }}>
              <th style={thStyle}>Title</th>
              <th style={thStyle}>Owner</th>
              <th style={thStyle}>Category</th>
              <th style={thStyle}>Target</th>
              <th style={thStyle}>Completion</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Priority</th>
              <th style={thStyle}>Progress</th>
              {canWrite && <th style={thStyle}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.uid} style={{ borderBottom: "1px solid #e2e8f0" }}>
                <td style={tdStyle}>{r.title}</td>
                <td style={tdStyle}>{r.owner_detail?.full_name ?? "—"}</td>
                <td style={tdStyle}>{r.category || "—"}</td>
                <td style={tdStyle}>{r.target_date ?? "—"}</td>
                <td style={tdStyle}>{r.completion_date ?? "—"}</td>
                <td style={tdStyle}>{r.status}</td>
                <td style={tdStyle}>{r.priority}</td>
                <td style={tdStyle}>{r.progress_notes || "—"}</td>
                {canWrite && (
                  <td style={tdStyle}>
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(r);
                        setModalOpen(true);
                      }}
                      style={btnLink}
                    >
                      Edit
                    </button>
                    {" · "}
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm("Delete this roadmap item?")) void remove(r.uid);
                      }}
                      style={{ ...btnLink, color: "#b91c1c" }}
                    >
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ClientRoadmapModal
        open={modalOpen}
        clientUid={clientUid}
        existing={editing}
        profiles={profiles}
        onClose={() => setModalOpen(false)}
        onSubmit={async (body) => {
          if (editing) {
            await update(editing.uid, body);
          } else {
            await create(body);
          }
        }}
      />
    </div>
  );
}

const filterStyle: React.CSSProperties = {
  padding: "6px 8px",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  fontSize: 13,
};
const btnPrimary: React.CSSProperties = {
  padding: "6px 12px",
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontWeight: 600,
};
const btnLink: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  color: "#2563eb",
  cursor: "pointer",
  fontSize: 13,
};
const thStyle: React.CSSProperties = { padding: "8px 10px", fontWeight: 600, borderBottom: "1px solid #e2e8f0" };
const tdStyle: React.CSSProperties = { padding: "8px 10px", verticalAlign: "top" };
```

- [ ] **Step 9.3: Swap the placeholder in `ClientsPage.tsx`**

In `frontend/task-tracker/src/pages/ClientsPage.tsx`:

1. Replace the import block so we pull in the new component:

```tsx
import ClientRoadmapTab from "@/components/clients/ClientRoadmapTab";
```

2. Replace the `ClientRoadmapTabPlaceholder` usage with `<ClientRoadmapTab clientUid={selectedClientUid} profiles={profiles} canWrite={canWrite} />`.

3. Delete the now-unused `ClientRoadmapTabPlaceholder` function.

- [ ] **Step 9.4: Type-check + lint**

```bash
cd frontend/task-tracker && npx tsc -b --noEmit && npm run lint
```

- [ ] **Step 9.5: Manual smoke test**

In the browser: open Clients, pick a client, click "+ Add roadmap item", fill the modal, save. Row appears in the table. Edit updates it. Delete removes it. Employee role sees the table but no Add/Edit/Delete controls.

- [ ] **Step 9.6: Commit**

```bash
git add frontend/task-tracker/src/components/clients/ClientRoadmapTab.tsx frontend/task-tracker/src/components/clients/ClientRoadmapModal.tsx frontend/task-tracker/src/pages/ClientsPage.tsx
git commit -m "feat(frontend): implement Road Map tab with filters, modal, and per-row actions"
```

---

## Task 10 — MOM tab, meeting modal, action points, attachments

**Files:**
- Create: `frontend/task-tracker/src/components/clients/ClientMOMTab.tsx`
- Create: `frontend/task-tracker/src/components/clients/ClientMeetingModal.tsx`
- Create: `frontend/task-tracker/src/components/clients/ClientActionPointsTable.tsx`
- Create: `frontend/task-tracker/src/components/clients/ClientMeetingAttachments.tsx`
- Modify: `frontend/task-tracker/src/pages/ClientsPage.tsx` (swap in real MOM tab)

- [ ] **Step 10.1: Meeting modal**

Create `frontend/task-tracker/src/components/clients/ClientMeetingModal.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { Profile } from "@/types/auth";
import type {
  ClientMeetingDto,
  ClientMeetingWrite,
  MeetingMode,
  MeetingType,
} from "@/types/api/clients";

interface Props {
  open: boolean;
  clientUid: string;
  existing: ClientMeetingDto | null;
  profiles: Profile[];
  onClose: () => void;
  onSubmit: (body: ClientMeetingWrite) => Promise<void>;
}

const TYPES: MeetingType[] = ["Review", "Kickoff", "Escalation", "Strategic", "Ad-hoc"];
const MODES: MeetingMode[] = ["In-person", "Video", "Phone"];

export default function ClientMeetingModal({
  open,
  clientUid,
  existing,
  profiles,
  onClose,
  onSubmit,
}: Props) {
  const [meetingDate, setMeetingDate] = useState("");
  const [meetingTime, setMeetingTime] = useState("");
  const [meetingType, setMeetingType] = useState<MeetingType>("Review");
  const [mode, setMode] = useState<MeetingMode>("Video");
  const [venue, setVenue] = useState("");
  const [conductedBy, setConductedBy] = useState("");
  const [ourAttendees, setOurAttendees] = useState<string[]>([]);
  const [clientAttendeesText, setClientAttendeesText] = useState("");
  const [agenda, setAgenda] = useState("");
  const [minutes, setMinutes] = useState("");
  const [nextMeetingDate, setNextMeetingDate] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMeetingDate(existing?.meeting_date ?? new Date().toISOString().slice(0, 10));
    setMeetingTime(existing?.meeting_time ?? "");
    setMeetingType(existing?.meeting_type ?? "Review");
    setMode(existing?.mode ?? "Video");
    setVenue(existing?.venue ?? "");
    setConductedBy(existing?.conducted_by ?? "");
    setOurAttendees([...(existing?.our_attendees ?? [])]);
    setClientAttendeesText(
      (existing?.client_attendees ?? [])
        .map((a) => [a.name, a.designation, a.email].filter(Boolean).join(" · "))
        .join("\n"),
    );
    setAgenda(existing?.agenda ?? "");
    setMinutes(existing?.minutes ?? "");
    setNextMeetingDate(existing?.next_meeting_date ?? "");
  }, [open, existing]);

  if (!open) return null;

  const parseClientAttendees = () =>
    clientAttendeesText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, designation, email] = line.split("·").map((s) => s.trim());
        return { name, designation: designation || "", email: email || "" };
      });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientUid || !meetingDate) return;
    setSaving(true);
    try {
      await onSubmit({
        client: clientUid,
        meeting_date: meetingDate,
        meeting_time: meetingTime || null,
        meeting_type: meetingType,
        mode,
        venue,
        conducted_by: conductedBy || null,
        our_attendees: ourAttendees,
        client_attendees: parseClientAttendees(),
        agenda,
        minutes,
        next_meeting_date: nextMeetingDate || null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, .4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{
          background: "#fff",
          padding: 20,
          borderRadius: 8,
          width: 640,
          maxWidth: "94vw",
          maxHeight: "90vh",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <h3 style={{ margin: 0 }}>{existing ? "Edit meeting" : "New meeting"}</h3>

        <div style={grid2}>
          <div>
            <label style={labelStyle}>Date*</label>
            <input type="date" value={meetingDate} onChange={(e) => setMeetingDate(e.target.value)} required style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Time</label>
            <input type="time" value={meetingTime} onChange={(e) => setMeetingTime(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Type</label>
            <select value={meetingType} onChange={(e) => setMeetingType(e.target.value as MeetingType)} style={inputStyle}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Mode</label>
            <select value={mode} onChange={(e) => setMode(e.target.value as MeetingMode)} style={inputStyle}>
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Venue / link</label>
            <input value={venue} onChange={(e) => setVenue(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Conducted by</label>
            <select value={conductedBy} onChange={(e) => setConductedBy(e.target.value)} style={inputStyle}>
              <option value="">—</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label style={labelStyle}>Our attendees (Ctrl/Cmd-click to multi-select)</label>
        <select
          multiple
          value={ourAttendees}
          onChange={(e) =>
            setOurAttendees(Array.from(e.target.selectedOptions, (o) => o.value))
          }
          style={{ ...inputStyle, minHeight: 90 }}
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>

        <label style={labelStyle}>Client attendees — one per line, format: Name · Designation · email</label>
        <textarea
          value={clientAttendeesText}
          onChange={(e) => setClientAttendeesText(e.target.value)}
          rows={3}
          style={inputStyle}
          placeholder="Rajesh Kumar · CFO · rajesh@client.com"
        />

        <label style={labelStyle}>Agenda</label>
        <textarea value={agenda} onChange={(e) => setAgenda(e.target.value)} rows={3} style={inputStyle} />

        <label style={labelStyle}>Minutes</label>
        <textarea value={minutes} onChange={(e) => setMinutes(e.target.value)} rows={5} style={inputStyle} />

        <label style={labelStyle}>Next meeting date</label>
        <input
          type="date"
          value={nextMeetingDate}
          onChange={(e) => setNextMeetingDate(e.target.value)}
          style={inputStyle}
        />

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
          <button type="button" onClick={onClose} style={btnSecondary}>Cancel</button>
          <button type="submit" disabled={saving || !meetingDate || !clientUid} style={btnPrimary}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: "#475569" };
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  fontSize: 13,
};
const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 };
const btnPrimary: React.CSSProperties = {
  padding: "8px 14px",
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontWeight: 600,
};
const btnSecondary: React.CSSProperties = {
  padding: "8px 14px",
  background: "#f1f5f9",
  color: "#1e293b",
  border: "1px solid #cbd5e1",
  borderRadius: 6,
  cursor: "pointer",
};
```

- [ ] **Step 10.2: Action points table**

Create `frontend/task-tracker/src/components/clients/ClientActionPointsTable.tsx`:

```tsx
import { useState } from "react";
import type { Profile } from "@/types/auth";
import type {
  ActionPointStatus,
  ClientActionPointDto,
  ClientActionPointWrite,
  ClientRoadmapDto,
  Priority,
} from "@/types/api/clients";

interface Props {
  meetingUid: string;
  actionPoints: readonly ClientActionPointDto[];
  profiles: Profile[];
  roadmapItems: readonly ClientRoadmapDto[];
  canWrite: boolean;
  onAdd: (meetingUid: string, body: ClientActionPointWrite) => Promise<void>;
  onUpdate: (apUid: string, body: Partial<ClientActionPointWrite>) => Promise<void>;
  onDelete: (apUid: string) => Promise<void>;
}

const STATUSES: ActionPointStatus[] = ["Open", "In Progress", "Completed", "Cancelled"];
const PRIORITIES: Priority[] = ["High", "Medium", "Low"];

export default function ClientActionPointsTable({
  meetingUid,
  actionPoints,
  profiles,
  roadmapItems,
  canWrite,
  onAdd,
  onUpdate,
  onDelete,
}: Props) {
  const [draft, setDraft] = useState<ClientActionPointWrite>({ description: "" });
  const [adding, setAdding] = useState(false);

  const submitDraft = async () => {
    if (!draft.description.trim()) return;
    setAdding(true);
    try {
      await onAdd(meetingUid, draft);
      setDraft({ description: "" });
    } finally {
      setAdding(false);
    }
  };

  return (
    <div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#f8fafc", textAlign: "left" }}>
            <th style={thStyle}>Description</th>
            <th style={thStyle}>Responsibility</th>
            <th style={thStyle}>Target</th>
            <th style={thStyle}>Completion</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Priority</th>
            <th style={thStyle}>Linked roadmap</th>
            <th style={thStyle}>Remarks</th>
            {canWrite && <th style={thStyle}></th>}
          </tr>
        </thead>
        <tbody>
          {actionPoints.map((ap) => (
            <Row
              key={ap.uid}
              ap={ap}
              profiles={profiles}
              roadmapItems={roadmapItems}
              canWrite={canWrite}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          ))}
          {canWrite && (
            <tr style={{ background: "#fafafa" }}>
              <td style={tdStyle}>
                <input
                  placeholder="New action point…"
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  style={cellInput}
                />
              </td>
              <td style={tdStyle}>
                <select
                  value={draft.responsibility ?? ""}
                  onChange={(e) => setDraft({ ...draft, responsibility: e.target.value || null })}
                  style={cellInput}
                >
                  <option value="">—</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name}
                    </option>
                  ))}
                </select>
              </td>
              <td style={tdStyle}>
                <input
                  type="date"
                  value={draft.target_date ?? ""}
                  onChange={(e) => setDraft({ ...draft, target_date: e.target.value || null })}
                  style={cellInput}
                />
              </td>
              <td style={tdStyle}>
                <input
                  type="date"
                  value={draft.completion_date ?? ""}
                  onChange={(e) => setDraft({ ...draft, completion_date: e.target.value || null })}
                  style={cellInput}
                />
              </td>
              <td style={tdStyle}>
                <select
                  value={draft.status ?? "Open"}
                  onChange={(e) => setDraft({ ...draft, status: e.target.value as ActionPointStatus })}
                  style={cellInput}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </td>
              <td style={tdStyle}>
                <select
                  value={draft.priority ?? "Medium"}
                  onChange={(e) => setDraft({ ...draft, priority: e.target.value as Priority })}
                  style={cellInput}
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </td>
              <td style={tdStyle}>
                <select
                  value={draft.roadmap_link ?? ""}
                  onChange={(e) => setDraft({ ...draft, roadmap_link: e.target.value || null })}
                  style={cellInput}
                >
                  <option value="">—</option>
                  {roadmapItems.map((r) => (
                    <option key={r.uid} value={r.uid}>
                      {r.title}
                    </option>
                  ))}
                </select>
              </td>
              <td style={tdStyle}>
                <input
                  value={draft.remarks ?? ""}
                  onChange={(e) => setDraft({ ...draft, remarks: e.target.value })}
                  style={cellInput}
                />
              </td>
              <td style={tdStyle}>
                <button type="button" onClick={submitDraft} disabled={adding || !draft.description.trim()} style={btnSmall}>
                  Add
                </button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Row({
  ap,
  profiles,
  roadmapItems,
  canWrite,
  onUpdate,
  onDelete,
}: {
  ap: ClientActionPointDto;
  profiles: Profile[];
  roadmapItems: readonly ClientRoadmapDto[];
  canWrite: boolean;
  onUpdate: (apUid: string, body: Partial<ClientActionPointWrite>) => Promise<void>;
  onDelete: (apUid: string) => Promise<void>;
}) {
  const [local, setLocal] = useState<Partial<ClientActionPointWrite>>({});
  const merged: ClientActionPointDto = {
    ...ap,
    ...local,
    roadmap_link: local.roadmap_link ?? ap.roadmap_link,
  };
  const dirty = Object.keys(local).length > 0;

  return (
    <tr style={{ borderBottom: "1px solid #e2e8f0" }}>
      <td style={tdStyle}>
        {canWrite ? (
          <input value={merged.description} onChange={(e) => setLocal({ ...local, description: e.target.value })} style={cellInput} />
        ) : (
          merged.description
        )}
      </td>
      <td style={tdStyle}>
        {canWrite ? (
          <select
            value={merged.responsibility ?? ""}
            onChange={(e) => setLocal({ ...local, responsibility: e.target.value || null })}
            style={cellInput}
          >
            <option value="">—</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
        ) : (
          ap.responsibility_detail?.full_name ?? "—"
        )}
      </td>
      <td style={tdStyle}>
        {canWrite ? (
          <input
            type="date"
            value={merged.target_date ?? ""}
            onChange={(e) => setLocal({ ...local, target_date: e.target.value || null })}
            style={cellInput}
          />
        ) : (
          merged.target_date ?? "—"
        )}
      </td>
      <td style={tdStyle}>
        {canWrite ? (
          <input
            type="date"
            value={merged.completion_date ?? ""}
            onChange={(e) => setLocal({ ...local, completion_date: e.target.value || null })}
            style={cellInput}
          />
        ) : (
          merged.completion_date ?? "—"
        )}
      </td>
      <td style={tdStyle}>
        {canWrite ? (
          <select
            value={merged.status}
            onChange={(e) => setLocal({ ...local, status: e.target.value as ActionPointStatus })}
            style={cellInput}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ) : (
          merged.status
        )}
      </td>
      <td style={tdStyle}>
        {canWrite ? (
          <select
            value={merged.priority}
            onChange={(e) => setLocal({ ...local, priority: e.target.value as Priority })}
            style={cellInput}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        ) : (
          merged.priority
        )}
      </td>
      <td style={tdStyle}>
        {canWrite ? (
          <select
            value={merged.roadmap_link ?? ""}
            onChange={(e) => setLocal({ ...local, roadmap_link: e.target.value || null })}
            style={cellInput}
          >
            <option value="">—</option>
            {roadmapItems.map((r) => (
              <option key={r.uid} value={r.uid}>
                {r.title}
              </option>
            ))}
          </select>
        ) : (
          roadmapItems.find((r) => r.uid === merged.roadmap_link)?.title ?? "—"
        )}
      </td>
      <td style={tdStyle}>
        {canWrite ? (
          <input value={merged.remarks ?? ""} onChange={(e) => setLocal({ ...local, remarks: e.target.value })} style={cellInput} />
        ) : (
          merged.remarks || "—"
        )}
      </td>
      {canWrite && (
        <td style={tdStyle}>
          {dirty && (
            <button
              type="button"
              onClick={async () => {
                await onUpdate(ap.uid, local);
                setLocal({});
              }}
              style={btnSmall}
            >
              Save
            </button>
          )}{" "}
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Delete this action point?")) void onDelete(ap.uid);
            }}
            style={{ ...btnSmall, background: "#fee2e2", color: "#b91c1c" }}
          >
            ×
          </button>
        </td>
      )}
    </tr>
  );
}

const cellInput: React.CSSProperties = {
  width: "100%",
  padding: "4px 6px",
  border: "1px solid transparent",
  borderRadius: 4,
  fontSize: 13,
  background: "transparent",
};
const thStyle: React.CSSProperties = { padding: "6px 8px", fontWeight: 600, borderBottom: "1px solid #e2e8f0" };
const tdStyle: React.CSSProperties = { padding: "4px 6px", verticalAlign: "top" };
const btnSmall: React.CSSProperties = {
  padding: "4px 8px",
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
};
```

- [ ] **Step 10.3: Attachments component**

Create `frontend/task-tracker/src/components/clients/ClientMeetingAttachments.tsx`:

```tsx
import { useRef, useState } from "react";
import { openAuthenticatedFile } from "@/lib/api";
import type { ClientMeetingAttachmentDto } from "@/types/api/clients";

interface Props {
  attachments: readonly ClientMeetingAttachmentDto[];
  canWrite: boolean;
  onUpload: (file: File) => Promise<void>;
  onDelete: (attachmentUid: string) => Promise<void>;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ClientMeetingAttachments({ attachments, canWrite, onUpload, onDelete }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (f: File | null) => {
    if (!f) return;
    setUploading(true);
    try {
      await onUpload(f);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div>
      {canWrite && (
        <div style={{ marginBottom: 8 }}>
          <input ref={fileRef} type="file" onChange={(e) => void handleFile(e.target.files?.[0] ?? null)} />
          {uploading && <span style={{ marginLeft: 8, color: "#64748b" }}>Uploading…</span>}
        </div>
      )}
      {attachments.length === 0 ? (
        <div style={{ color: "#64748b", fontSize: 13 }}>No attachments.</div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {attachments.map((a) => (
            <li
              key={a.uid}
              style={{ display: "flex", gap: 10, alignItems: "center", padding: "4px 0", fontSize: 13 }}
            >
              <button
                type="button"
                onClick={() => void openAuthenticatedFile(a.download_url)}
                style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", padding: 0 }}
              >
                📎 {a.filename}
              </button>
              <span style={{ color: "#94a3b8" }}>{formatSize(a.size_bytes)}</span>
              {canWrite && (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Delete ${a.filename}?`)) void onDelete(a.uid);
                  }}
                  style={{ background: "none", border: "none", color: "#b91c1c", cursor: "pointer" }}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 10.4: MOM tab**

Create `frontend/task-tracker/src/components/clients/ClientMOMTab.tsx`:

```tsx
import { useState } from "react";
import { useClientMeetings } from "@/hooks/useClientMeetings";
import { useClientRoadmap } from "@/hooks/useClientRoadmap";
import ClientMeetingModal from "./ClientMeetingModal";
import ClientActionPointsTable from "./ClientActionPointsTable";
import ClientMeetingAttachments from "./ClientMeetingAttachments";
import type { Profile } from "@/types/auth";
import type { ClientMeetingDto } from "@/types/api/clients";

interface Props {
  clientUid: string;
  profile: Profile | null;
  profiles: Profile[];
  canWrite: boolean;
}

export default function ClientMOMTab({ clientUid, profile: _profile, profiles, canWrite }: Props) {
  const {
    meetings,
    loading,
    createMeeting,
    updateMeeting,
    deleteMeeting,
    addActionPoint,
    updateActionPoint,
    deleteActionPoint,
    uploadAttachment,
    deleteAttachment,
  } = useClientMeetings(clientUid || undefined);
  const { items: roadmapItems } = useClientRoadmap(clientUid || undefined);

  const [selectedUid, setSelectedUid] = useState<string>("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ClientMeetingDto | null>(null);

  if (!clientUid) return <div style={{ color: "#64748b" }}>Select a client to view meetings.</div>;
  if (loading) return <div>Loading…</div>;

  const selected = meetings.find((m) => m.uid === selectedUid) ?? meetings[0];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 12 }}>
      {/* Left: meeting list */}
      <div>
        {canWrite && (
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
            style={btnPrimary}
          >
            + New meeting
          </button>
        )}
        <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
          {meetings.length === 0 && <li style={{ color: "#64748b" }}>No meetings yet.</li>}
          {meetings.map((m) => {
            const active = selected?.uid === m.uid;
            return (
              <li
                key={m.uid}
                onClick={() => setSelectedUid(m.uid)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 6,
                  cursor: "pointer",
                  background: active ? "#eff6ff" : "transparent",
                  border: `1px solid ${active ? "#bfdbfe" : "transparent"}`,
                  marginBottom: 4,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13 }}>{m.meeting_date}</div>
                <div style={{ fontSize: 12, color: "#64748b" }}>
                  {m.meeting_type} · {m.mode}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Right: selected meeting */}
      <div>
        {!selected ? (
          <div style={{ color: "#64748b" }}>No meeting selected.</div>
        ) : (
          <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>
                {selected.meeting_date} · {selected.meeting_type} · {selected.mode}
              </h3>
              {canWrite && (
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(selected);
                      setModalOpen(true);
                    }}
                    style={btnLink}
                  >
                    Edit header
                  </button>
                  {" · "}
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm("Delete this meeting and its action points?")) {
                        void deleteMeeting(selected.uid).then(() => setSelectedUid(""));
                      }
                    }}
                    style={{ ...btnLink, color: "#b91c1c" }}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 13 }}>
              <div><strong>Venue:</strong> {selected.venue || "—"}</div>
              <div><strong>Conducted by:</strong> {selected.conducted_by_detail?.full_name ?? "—"}</div>
              <div>
                <strong>Our attendees:</strong>{" "}
                {selected.our_attendees_detail.map((u) => u.full_name).join(", ") || "—"}
              </div>
              <div>
                <strong>Client attendees:</strong>{" "}
                {selected.client_attendees.map((a) => a.name).join(", ") || "—"}
              </div>
              <div><strong>Next meeting:</strong> {selected.next_meeting_date ?? "—"}</div>
            </div>

            <h4 style={sectionHeading}>Agenda</h4>
            <div style={paragraph}>{selected.agenda || <em>None</em>}</div>

            <h4 style={sectionHeading}>Minutes</h4>
            <div style={paragraph}>{selected.minutes || <em>None</em>}</div>

            <h4 style={sectionHeading}>Attachments</h4>
            <ClientMeetingAttachments
              attachments={selected.attachments}
              canWrite={canWrite}
              onUpload={(f) => uploadAttachment(selected.uid, f).then(() => undefined)}
              onDelete={(uid) => deleteAttachment(uid)}
            />

            <h4 style={sectionHeading}>Action Points</h4>
            <ClientActionPointsTable
              meetingUid={selected.uid}
              actionPoints={selected.action_points}
              profiles={profiles}
              roadmapItems={roadmapItems}
              canWrite={canWrite}
              onAdd={(meetingUid, body) => addActionPoint(meetingUid, body).then(() => undefined)}
              onUpdate={(apUid, body) => updateActionPoint(apUid, body).then(() => undefined)}
              onDelete={(apUid) => deleteActionPoint(apUid)}
            />
          </div>
        )}
      </div>

      <ClientMeetingModal
        open={modalOpen}
        clientUid={clientUid}
        existing={editing}
        profiles={profiles}
        onClose={() => setModalOpen(false)}
        onSubmit={async (body) => {
          if (editing) {
            await updateMeeting(editing.uid, body);
          } else {
            const created = await createMeeting(body);
            setSelectedUid(created.uid);
          }
        }}
      />
    </div>
  );
}

const sectionHeading: React.CSSProperties = { margin: "16px 0 6px", fontSize: 14 };
const paragraph: React.CSSProperties = { whiteSpace: "pre-wrap", fontSize: 13, color: "#1e293b" };
const btnPrimary: React.CSSProperties = {
  padding: "6px 12px",
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontWeight: 600,
  width: "100%",
};
const btnLink: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  color: "#2563eb",
  cursor: "pointer",
  fontSize: 13,
};
```

- [ ] **Step 10.5: Swap the placeholder in `ClientsPage.tsx`**

Import the new component and replace `ClientMOMTabPlaceholder` with `<ClientMOMTab clientUid={selectedClientUid} profile={profile} profiles={profiles} canWrite={canWrite} />`. Delete the unused placeholder function.

- [ ] **Step 10.6: Type-check + lint**

```bash
cd frontend/task-tracker && npx tsc -b --noEmit && npm run lint
```

- [ ] **Step 10.7: Manual smoke test**

Open a client, create a meeting, add an action point inline, upload an attachment, mark the action point Completed with a completion date, reload the page — every change persists.

- [ ] **Step 10.8: Commit**

```bash
git add frontend/task-tracker/src/components/clients/ClientMeetingModal.tsx frontend/task-tracker/src/components/clients/ClientActionPointsTable.tsx frontend/task-tracker/src/components/clients/ClientMeetingAttachments.tsx frontend/task-tracker/src/components/clients/ClientMOMTab.tsx frontend/task-tracker/src/pages/ClientsPage.tsx
git commit -m "feat(frontend): implement MOM tab, action points table, and attachments"
```

---

## Task 11 — Overdue action points panel

**Files:**
- Create: `frontend/task-tracker/src/components/clients/OverdueActionPointsPanel.tsx`
- Modify: `frontend/task-tracker/src/pages/ClientsPage.tsx` (swap in real panel)

- [ ] **Step 11.1: Panel**

Create `frontend/task-tracker/src/components/clients/OverdueActionPointsPanel.tsx`:

```tsx
import { useMemo } from "react";
import { useOverdueActionPoints } from "@/hooks/useOverdueActionPoints";
import { useClientMeetings } from "@/hooks/useClientMeetings";

interface Props {
  onSelectMeeting: (meetingUid: string) => void;
}

export default function OverdueActionPointsPanel({ onSelectMeeting }: Props) {
  const { overdue, loading } = useOverdueActionPoints();
  // Pull every meeting the caller can see so we can look up client/date labels.
  const { meetings } = useClientMeetings();

  const byClient = useMemo(() => {
    const map = new Map<
      string,
      { clientName: string; rows: Array<{ apUid: string; desc: string; target: string; meetingUid: string; meetingDate: string }> }
    >();
    for (const ap of overdue) {
      const meeting = meetings.find((m) => m.id === ap.meeting);
      const clientName = meeting?.client_detail?.name ?? "Unknown client";
      const key = meeting?.client ?? `unknown-${ap.meeting}`;
      const bucket = map.get(key) ?? { clientName, rows: [] };
      bucket.rows.push({
        apUid: ap.uid,
        desc: ap.description,
        target: ap.target_date ?? "",
        meetingUid: meeting?.uid ?? "",
        meetingDate: meeting?.meeting_date ?? "",
      });
      map.set(key, bucket);
    }
    return Array.from(map.values()).sort((a, b) => a.clientName.localeCompare(b.clientName));
  }, [overdue, meetings]);

  if (loading) return <div>Loading…</div>;
  if (overdue.length === 0) return <div style={{ color: "#64748b" }}>No overdue action points 🎉</div>;

  return (
    <div>
      {byClient.map((group) => (
        <div key={group.clientName} style={{ marginBottom: 16 }}>
          <h4 style={{ margin: "0 0 6px", fontSize: 14 }}>{group.clientName}</h4>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#fef2f2", textAlign: "left" }}>
                <th style={thStyle}>Description</th>
                <th style={thStyle}>Target</th>
                <th style={thStyle}>Meeting</th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((r) => (
                <tr key={r.apUid} style={{ borderBottom: "1px solid #fecaca" }}>
                  <td style={tdStyle}>{r.desc}</td>
                  <td style={tdStyle}>{r.target}</td>
                  <td style={tdStyle}>
                    {r.meetingUid ? (
                      <button
                        type="button"
                        onClick={() => onSelectMeeting(r.meetingUid)}
                        style={{ background: "none", border: "none", color: "#2563eb", cursor: "pointer", padding: 0 }}
                      >
                        {r.meetingDate || "Open"}
                      </button>
                    ) : (
                      r.meetingDate
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: "6px 8px", fontWeight: 600, borderBottom: "1px solid #fecaca" };
const tdStyle: React.CSSProperties = { padding: "6px 8px", verticalAlign: "top" };
```

- [ ] **Step 11.2: Swap the placeholder in `ClientsPage.tsx`**

Import `OverdueActionPointsPanel`. Replace the `OverdueActionPointsPlaceholder` usage with:

```tsx
<OverdueActionPointsPanel
  onSelectMeeting={(meetingUid) => {
    // Clicking a meeting row: stay in Overdue tab — deep-linking to the
    // MOM tab for a specific meeting is covered by the user switching
    // the sub-tab back manually. We could add deep-linking later.
    void meetingUid;
  }}
/>
```

Delete the unused placeholder function.

- [ ] **Step 11.3: Type-check + lint**

```bash
cd frontend/task-tracker && npx tsc -b --noEmit && npm run lint
```

- [ ] **Step 11.4: Manual smoke test**

Create an action point with `target_date` in the past and status `Open`. The overdue count badge in the top-right shows the count; clicking it (or the Overdue sub-tab) shows the panel grouped by client.

- [ ] **Step 11.5: Commit**

```bash
git add frontend/task-tracker/src/components/clients/OverdueActionPointsPanel.tsx frontend/task-tracker/src/pages/ClientsPage.tsx
git commit -m "feat(frontend): add overdue action points panel grouped by client"
```

---

## Task 12 — Full verification sweep

- [ ] **Step 12.1: Django system + migrations check**

```bash
python manage.py check
python manage.py makemigrations --check --dry-run
```

Expected: both exit 0 with no pending migrations.

- [ ] **Step 12.2: Backend tests**

```bash
python manage.py test core.masters -v 2
```

Expected: `OK`. All tests from Task 5 pass.

- [ ] **Step 12.3: Frontend type-check, lint, build**

```bash
cd frontend/task-tracker
npx tsc -b --noEmit
npm run lint
npm run build
```

Expected: no errors. `npm run build` writes to `dist/`.

- [ ] **Step 12.4: Ruff**

From the repo root (if ruff is installed per `pyproject.toml`):

```bash
ruff check core/masters
```

Expected: `All checks passed!`. Fix any E/F/I/B/UP issues inline.

- [ ] **Step 12.5: End-to-end manual smoke**

With backend + frontend running, as an admin user:
1. Navigate to **Clients** tab — loads with no console errors.
2. Pick a client that has none of these records — the Road Map and MOM tabs are empty with placeholders.
3. Add a roadmap item with owner, target date, priority. It appears immediately.
4. Create a meeting with date, type, mode, agenda, minutes, attendees (both sets).
5. Open the meeting detail; inline-add an action point with target date + priority, linked to the roadmap item. Status defaults to Open.
6. Upload a small file as an attachment; click the link to open it.
7. Mark the action point Completed with a completion date; overdue badge count is unaffected (since this one was not overdue).
8. Add a second action point with target in the past, status Open. The overdue badge increments. Click it → panel shows the new row grouped by client.
9. Switch to a non-admin/manager account; verify the **Clients** tab is read-only (no Add/Edit/Delete/Upload controls).

- [ ] **Step 12.6: Final commit + push (merges anything still pending)**

If any steps above produced tweaks (lint fixes etc.), stage them:

```bash
git add -u
git commit -m "chore(clients): verification-sweep fixes"  # only if there were any changes
git push
```

---

## Self-review summary

Spec coverage verified against `docs/superpowers/specs/2026-04-21-client-management-design.md`:

- §4.1 `ClientRoadmap` — Task 1 (model) + Task 3 (serializer) + Task 4 (viewset) + Task 5 (tests) + Task 9 (UI)
- §4.2 `ClientMeeting` — Task 1/3/4/5/10
- §4.3 `ClientActionPoint` — Task 1/3/4/5/10
- §4.4 `ClientMeetingAttachment` — Task 1/3/4/5 + Task 10 (upload UI)
- §5 API routes (roadmap, meetings, action-points, attachments, overdue) — Task 4
- §6 Permissions (admin/manager write, any org member read) — Task 4 + Task 5 tests
- §7 Frontend nav + page + sub-tabs + overdue card + panel — Tasks 8/9/10/11
- §10 Migration + rollout — Task 1
- Branch push / remote tracking — already handled (branch `Client_Mgmt_Tab` tracks `origin`).

No placeholders, no "TODO" steps, every code step contains the full code. Task 5 tests are written before the models/views they cover are merged, but because the models come in Task 1 (and Tasks 2–4 fill in admin/serializer/views), running Task 5's suite before Task 4 will fail — that's the expected TDD red-before-green. All later tasks pass the suite again as the surface becomes real.
