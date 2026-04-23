# Conveyance Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Conveyance module that lets employees log travel/expense claims with multiple attachments, go through manager/admin approval, and provide admin/manager summary views (employee-wise and client-wise monthly totals with drill-down).

**Architecture:** New Django app `core/conveyance` with two models (`ConveyanceEntry`, `ConveyanceAttachment`). Single unified `/summary/` endpoint drives both pivot views. React page `pages/ConveyancePage.tsx` with three tabs. Multi-org aware via `visibility_q` and `resolve_create_org`. Realtime broadcasts on channel `conveyance-entries`.

**Tech Stack:** Django 6, DRF, SimpleJWT, Channels (realtime), SQLite/Postgres, React 19 + TS + Vite, Vitest.

**Companion spec:** [`docs/superpowers/specs/2026-04-23-conveyance-tab-design.md`](../specs/2026-04-23-conveyance-tab-design.md) — consult for field-level rules, response shapes, and edge cases.

**Execution note:** Plan covers backend (Tasks 1–22) and frontend (Tasks 23–32). Backend is independently shippable. Commit after every task. Follow existing TaskTracker patterns exactly — do not freelance.

---

## Conventions used throughout

- **User/org setup helper** (reused in every test module): create with `_make_org_user(username, role)` that creates `Org`, `User`, and `OrgMembership(role=...)`. Copy this exact helper from `core/masters/tests.py:24-28`.
- **Test authentication:** `client.force_authenticate(user=<user>)`.
- **File paths:** All `core/conveyance/*` paths assume they do not exist yet.
- **Imports:** Follow isort order — stdlib, third-party, Django, local.

---

## Task 1: Scaffold the app skeleton

**Files:**
- Create: `core/conveyance/__init__.py`
- Create: `core/conveyance/apps.py`
- Create: `core/conveyance/models.py`
- Create: `core/conveyance/serializers.py`
- Create: `core/conveyance/views.py`
- Create: `core/conveyance/urls.py`
- Create: `core/conveyance/admin.py`
- Create: `core/conveyance/tests.py`
- Modify: `config/settings.py` (add `core.conveyance` to `INSTALLED_APPS`)
- Modify: `config/urls.py` (include `core.conveyance.urls`)

- [ ] **Step 1: Create the empty files**

```bash
mkdir -p core/conveyance
touch core/conveyance/__init__.py core/conveyance/models.py core/conveyance/serializers.py \
      core/conveyance/views.py core/conveyance/admin.py core/conveyance/tests.py
```

- [ ] **Step 2: Write `core/conveyance/apps.py`**

```python
from django.apps import AppConfig


class ConveyanceConfig(AppConfig):
    name = "core.conveyance"
```

- [ ] **Step 3: Write a stub `core/conveyance/urls.py`**

```python
from django.urls import include, path
from rest_framework.routers import DefaultRouter

router = DefaultRouter()

urlpatterns = [path("", include(router.urls))]
```

- [ ] **Step 4: Register the app in `config/settings.py`**

Add `"core.conveyance",` to `INSTALLED_APPS` in the same block as the other `core.*` apps. Keep alphabetical order if the existing block is alphabetical.

- [ ] **Step 5: Include URLs in `config/urls.py`**

Alongside the other `path("api/", include("core.<app>.urls"))` entries, add:

```python
path("api/", include("core.conveyance.urls")),
```

- [ ] **Step 6: Verify Django sees the app**

Run: `uv run python manage.py check`
Expected: `System check identified no issues (0 silenced).`

- [ ] **Step 7: Commit**

```bash
git add core/conveyance/ config/settings.py config/urls.py
git commit -m "feat(conveyance): scaffold core.conveyance app"
```

---

## Task 2: Add `conveyance_attachment_upload_to` helper

**Files:**
- Modify: `core/filestore/validators.py`

- [ ] **Step 1: Add the helper at the bottom of the file**

```python
def conveyance_attachment_upload_to(instance, filename):
    return _hashed_upload_to("conveyance", instance, filename)
```

Place it immediately after `invoice_upload_to`. Mirror the existing pattern exactly.

- [ ] **Step 2: Verify the helper imports cleanly**

Run: `uv run python -c "from core.filestore.validators import conveyance_attachment_upload_to; print(conveyance_attachment_upload_to(None, 'hello.pdf'))"`
Expected: A string like `conveyance/2026/04/<32-hex>.pdf`.

- [ ] **Step 3: Commit**

```bash
git add core/filestore/validators.py
git commit -m "feat(filestore): add conveyance_attachment_upload_to helper"
```

---

## Task 3: Write the `ConveyanceEntry` model

**Files:**
- Modify: `core/conveyance/models.py`

- [ ] **Step 1: Write the model**

Replace the empty `models.py` with:

```python
import uuid

from django.conf import settings
from django.db import models

from core.base import TimeStampedModel


class ConveyanceEntry(TimeStampedModel):
    # Static-typing hints for pyright — Django's implicit primary key
    # and FK attnames aren't surfaced to stubs.
    id: int
    org_id: int | None
    employee_id: int
    client_id: int

    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("approved", "Approved"),
        ("rejected", "Rejected"),
    ]

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    org = models.ForeignKey(
        "users.Org",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="conveyance_entries",
    )
    employee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="conveyance_entries",
    )
    date = models.DateField(db_index=True)
    client = models.ForeignKey(
        "masters.Master",
        on_delete=models.PROTECT,
        related_name="client_conveyance_entries",
        limit_choices_to={"type": "client"},
    )
    reason = models.TextField(max_length=2000)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    claimable = models.BooleanField(default=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="pending", db_index=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="conveyance_reviews",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_note = models.CharField(max_length=500, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="conveyance_created",
    )

    class Meta:
        ordering = ["-date", "-created_at"]
        verbose_name = "conveyance entry"
        verbose_name_plural = "conveyance entries"
        indexes = [
            models.Index(fields=["org", "date"]),
            models.Index(fields=["org", "employee", "date"]),
            models.Index(fields=["org", "client", "date"]),
            models.Index(fields=["org", "status"]),
        ]

    def __str__(self):
        return f"{self.employee} · {self.date} · ₹{self.amount}"
```

- [ ] **Step 2: Verify Django sees the model**

Run: `uv run python manage.py check`
Expected: `System check identified no issues (0 silenced).`

- [ ] **Step 3: Commit**

```bash
git add core/conveyance/models.py
git commit -m "feat(conveyance): add ConveyanceEntry model"
```

---

## Task 4: Write the `ConveyanceAttachment` child model

**Files:**
- Modify: `core/conveyance/models.py`

- [ ] **Step 1: Append the child model**

At the bottom of `core/conveyance/models.py`, add:

```python
from core.filestore.validators import conveyance_attachment_upload_to  # noqa: E402


class ConveyanceAttachment(TimeStampedModel):
    id: int
    entry_id: int

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    entry = models.ForeignKey(
        ConveyanceEntry,
        on_delete=models.CASCADE,
        related_name="attachments",
    )
    file = models.FileField(upload_to=conveyance_attachment_upload_to)
    label = models.CharField(max_length=100, blank=True)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="conveyance_attachment_uploads",
    )

    class Meta:
        ordering = ["created_at"]
        verbose_name = "conveyance attachment"
        verbose_name_plural = "conveyance attachments"
        indexes = [models.Index(fields=["entry"])]

    def __str__(self):
        base = self.file.name.rsplit("/", 1)[-1] if self.file else "—"
        return f"{self.entry_id} · {self.label or base}"
```

Move the `from core.filestore.validators import ...` line up next to the other top-level imports and drop the `# noqa: E402` — the noqa was just for the inline illustration.

- [ ] **Step 2: Verify check passes**

Run: `uv run python manage.py check`
Expected: `System check identified no issues (0 silenced).`

- [ ] **Step 3: Commit**

```bash
git add core/conveyance/models.py
git commit -m "feat(conveyance): add ConveyanceAttachment child model"
```

---

## Task 5: Generate and apply the initial migration

**Files:**
- Create: `core/conveyance/migrations/__init__.py`
- Create: `core/conveyance/migrations/0001_initial.py` (auto-generated)

- [ ] **Step 1: Create the migrations package**

```bash
mkdir -p core/conveyance/migrations
touch core/conveyance/migrations/__init__.py
```

- [ ] **Step 2: Generate the migration**

Run: `uv run python manage.py makemigrations conveyance`
Expected output mentions `ConveyanceEntry` and `ConveyanceAttachment` with `CreateModel` operations.

- [ ] **Step 3: Apply to the dev DB**

Run: `uv run python manage.py migrate conveyance`
Expected: `Applying conveyance.0001_initial... OK`

- [ ] **Step 4: Verify no additional migration is needed (idempotency)**

Run: `uv run python manage.py makemigrations --check --dry-run conveyance`
Expected: `No changes detected in app 'conveyance'`. Exit code 0.

- [ ] **Step 5: Commit**

```bash
git add core/conveyance/migrations/
git commit -m "feat(conveyance): add initial migration"
```

---

## Task 6: Register models in Django admin

**Files:**
- Modify: `core/conveyance/admin.py`

- [ ] **Step 1: Write the admin**

```python
from django.contrib import admin
from django.urls import reverse
from django.utils.html import format_html

from .models import ConveyanceAttachment, ConveyanceEntry


class ConveyanceAttachmentInline(admin.TabularInline):
    model = ConveyanceAttachment
    extra = 0
    readonly_fields = ["uid", "file_link", "uploaded_by", "created_at", "updated_at"]
    fields = ["uid", "file", "file_link", "label", "uploaded_by", "created_at"]

    @admin.display(description="Download")
    def file_link(self, obj):
        if not obj.file:
            return "—"
        url = reverse("conveyanceattachment-download", kwargs={"uid": str(obj.uid)})
        filename = obj.file.name.rsplit("/", 1)[-1]
        return format_html('<a href="{}" target="_blank">📎 {}</a>', url, filename)


@admin.register(ConveyanceEntry)
class ConveyanceEntryAdmin(admin.ModelAdmin):
    list_display = ["uid", "employee", "date", "client", "amount", "claimable", "status"]
    list_filter = ["status", "claimable"]
    search_fields = ["reason", "employee__username", "client__name"]
    readonly_fields = [
        "uid",
        "reviewed_by",
        "reviewed_at",
        "created_by",
        "created_at",
        "updated_at",
    ]
    autocomplete_fields = ["employee", "client", "org"]
    date_hierarchy = "date"
    inlines = [ConveyanceAttachmentInline]


@admin.register(ConveyanceAttachment)
class ConveyanceAttachmentAdmin(admin.ModelAdmin):
    list_display = ["uid", "entry", "label", "uploaded_by", "created_at"]
    search_fields = ["label", "entry__reason"]
    readonly_fields = ["uid", "uploaded_by", "created_at", "updated_at"]
```

Note: `reverse("conveyanceattachment-download", ...)` will 500 in admin until Task 16 registers that URL. Leave it — it's only used when viewing an inline with attached files, which won't happen before Task 16 is merged. If you need to smoke-test admin before Task 16, temporarily comment out the `file_link` display.

- [ ] **Step 2: Run check**

Run: `uv run python manage.py check`
Expected: `System check identified no issues (0 silenced).`

- [ ] **Step 3: Commit**

```bash
git add core/conveyance/admin.py
git commit -m "feat(conveyance): register admin for ConveyanceEntry and attachment inline"
```

---

## Task 7: Write `ConveyanceAttachmentSerializer`

**Files:**
- Modify: `core/conveyance/serializers.py`

- [ ] **Step 1: Write a failing test**

Add to `core/conveyance/tests.py` (replace the comment placeholder):

```python
from django.test import TestCase
from rest_framework.test import APIRequestFactory

from core.conveyance.models import ConveyanceAttachment, ConveyanceEntry
from core.conveyance.serializers import ConveyanceAttachmentSerializer
from core.masters.models import Master
from users.models import Org, OrgMembership, User


def _make_org_user(username: str, role: str = "admin") -> tuple[Org, User]:
    org = Org.objects.create(name=f"Org-{username}")
    user = User.objects.create_user(username=username, password="pw", full_name=username.title())
    OrgMembership.objects.create(user=user, org=org, role=role)
    return org, user


def _make_client(org: Org, name: str = "Acme") -> Master:
    m = Master.objects.create(name=name, type="client", org=org)
    m.orgs.add(org)
    return m


class ConveyanceAttachmentSerializerTests(TestCase):
    def test_serializes_uid_label_and_download_url(self):
        org, user = _make_org_user("emp")
        master = _make_client(org)
        entry = ConveyanceEntry.objects.create(
            org=org, employee=user, date="2026-04-18", client=master,
            reason="taxi", amount="100.00",
        )
        # No real file — just the metadata fields.
        att = ConveyanceAttachment.objects.create(entry=entry, label="Breakfast")

        factory = APIRequestFactory()
        request = factory.get("/")
        request.user = user

        data = ConveyanceAttachmentSerializer(att, context={"request": request}).data
        assert data["uid"] == str(att.uid)
        assert data["label"] == "Breakfast"
        # Without a real file, file_url should be None.
        assert data["file_url"] is None
        assert data["filename"] is None
```

- [ ] **Step 2: Run and watch it fail (ImportError)**

Run: `uv run python manage.py test core.conveyance.tests.ConveyanceAttachmentSerializerTests -v 2`
Expected: `ImportError: cannot import name 'ConveyanceAttachmentSerializer'`.

- [ ] **Step 3: Implement the serializer**

Write to `core/conveyance/serializers.py`:

```python
from django.urls import reverse
from rest_framework import serializers

from core.serializers import UserMinSerializer

from .models import ConveyanceAttachment


class ConveyanceAttachmentSerializer(serializers.ModelSerializer):
    uploaded_by_detail = UserMinSerializer(source="uploaded_by", read_only=True)
    file_url = serializers.SerializerMethodField()
    filename = serializers.SerializerMethodField()

    class Meta:
        model = ConveyanceAttachment
        fields = [
            "id",
            "uid",
            "label",
            "file",
            "file_url",
            "filename",
            "uploaded_by_detail",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "uid",
            "file_url",
            "filename",
            "uploaded_by_detail",
            "created_at",
        ]
        extra_kwargs = {"file": {"write_only": True, "required": False}}

    def get_filename(self, obj):
        if not obj.file:
            return None
        return obj.file.name.rsplit("/", 1)[-1]

    def get_file_url(self, obj):
        if not obj.file:
            return None
        path = reverse("conveyanceattachment-download", kwargs={"uid": str(obj.uid)})
        request = self.context.get("request")
        return request.build_absolute_uri(path) if request else path
```

Note: the `reverse()` call will fail at serializer-render time until the `conveyanceattachment-download` URL exists (Task 16). Until then, tests that render the serializer must either stub `reverse` or only test instances without files. The assertion `data["file_url"] is None` in Step 1 passes because `get_file_url` short-circuits on empty `obj.file`.

- [ ] **Step 4: Run tests and pass**

Run: `uv run python manage.py test core.conveyance.tests.ConveyanceAttachmentSerializerTests -v 2`
Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add core/conveyance/serializers.py core/conveyance/tests.py
git commit -m "feat(conveyance): add ConveyanceAttachmentSerializer with url + filename"
```

---

## Task 8: Write `ConveyanceEntrySerializer` with nested attachments

**Files:**
- Modify: `core/conveyance/serializers.py`
- Modify: `core/conveyance/tests.py`

- [ ] **Step 1: Write a failing test**

Append to `core/conveyance/tests.py`:

```python
from core.conveyance.serializers import ConveyanceEntrySerializer


class ConveyanceEntrySerializerTests(TestCase):
    def test_serializes_nested_attachments(self):
        org, user = _make_org_user("emp")
        master = _make_client(org)
        entry = ConveyanceEntry.objects.create(
            org=org, employee=user, date="2026-04-18", client=master,
            reason="taxi", amount="100.00",
        )
        ConveyanceAttachment.objects.create(entry=entry, label="Breakfast")
        ConveyanceAttachment.objects.create(entry=entry, label="Lunch")

        factory = APIRequestFactory()
        request = factory.get("/")
        request.user = user

        data = ConveyanceEntrySerializer(entry, context={"request": request}).data
        assert data["uid"] == str(entry.uid)
        assert data["reason"] == "taxi"
        assert str(data["amount"]) == "100.00"
        assert data["status"] == "pending"
        assert data["claimable"] is True
        assert data["client_detail"]["uid"] == str(master.uid)
        assert data["employee_detail"]["uid"] == str(user.uid)
        labels = [a["label"] for a in data["attachments"]]
        assert labels == ["Breakfast", "Lunch"]
```

- [ ] **Step 2: Run — should fail (ImportError)**

Run: `uv run python manage.py test core.conveyance.tests.ConveyanceEntrySerializerTests -v 2`
Expected: `ImportError`.

- [ ] **Step 3: Implement the serializer**

Append to `core/conveyance/serializers.py`:

```python
from core.masters.models import Master
from core.masters.serializers import MasterMinSerializer

from .models import ConveyanceEntry


class ConveyanceEntrySerializer(serializers.ModelSerializer):
    employee_detail = UserMinSerializer(source="employee", read_only=True)
    client_detail = MasterMinSerializer(source="client", read_only=True)
    reviewed_by_detail = UserMinSerializer(source="reviewed_by", read_only=True)
    created_by_detail = UserMinSerializer(source="created_by", read_only=True)
    attachments = ConveyanceAttachmentSerializer(many=True, read_only=True)

    client = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Master.objects.filter(type="client"),
    )

    class Meta:
        model = ConveyanceEntry
        fields = [
            "id",
            "uid",
            "date",
            "employee",
            "employee_detail",
            "client",
            "client_detail",
            "reason",
            "amount",
            "claimable",
            "status",
            "review_note",
            "reviewed_by_detail",
            "reviewed_at",
            "attachments",
            "created_by_detail",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "uid",
            "employee",
            "employee_detail",
            "client_detail",
            "status",
            "review_note",
            "reviewed_by_detail",
            "reviewed_at",
            "attachments",
            "created_by_detail",
            "created_at",
            "updated_at",
        ]
```

Note: `employee` is read-only here because it's set by the viewset, not the client. Admin-on-behalf creation is handled in the viewset (Task 11).

- [ ] **Step 4: Run tests**

Run: `uv run python manage.py test core.conveyance.tests.ConveyanceEntrySerializerTests -v 2`
Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add core/conveyance/serializers.py core/conveyance/tests.py
git commit -m "feat(conveyance): add ConveyanceEntrySerializer with nested attachments"
```

---

## Task 9: `ConveyanceEntryViewSet` — list with visibility

**Files:**
- Modify: `core/conveyance/views.py`
- Modify: `core/conveyance/urls.py`
- Modify: `core/conveyance/tests.py`

- [ ] **Step 1: Write failing tests**

Append to `core/conveyance/tests.py`:

```python
from rest_framework.test import APIClient


def _auth(client: APIClient, user: User) -> None:
    client.force_authenticate(user=user)


def _make_entry(org, employee, client_master, **overrides):
    defaults = dict(
        date="2026-04-18",
        reason="taxi",
        amount="100.00",
        claimable=True,
    )
    defaults.update(overrides)
    return ConveyanceEntry.objects.create(
        org=org, employee=employee, client=client_master, **defaults
    )


class ConveyanceEntryListVisibilityTests(TestCase):
    def setUp(self):
        self.org_a, self.admin_a = _make_org_user("admin_a", role="admin")
        self.manager_a = User.objects.create_user(username="mgr_a", password="pw", full_name="Mgr A")
        OrgMembership.objects.create(user=self.manager_a, org=self.org_a, role="manager")
        self.emp_a = User.objects.create_user(username="emp_a", password="pw", full_name="Emp A")
        OrgMembership.objects.create(user=self.emp_a, org=self.org_a, role="employee")
        self.other_emp_a = User.objects.create_user(username="other_a", password="pw", full_name="Other A")
        OrgMembership.objects.create(user=self.other_emp_a, org=self.org_a, role="employee")

        self.org_b, self.admin_b = _make_org_user("admin_b", role="admin")

        self.client_a = _make_client(self.org_a, "Acme-A")
        self.client_b = _make_client(self.org_b, "Acme-B")

        self.entry_emp_a = _make_entry(self.org_a, self.emp_a, self.client_a, reason="emp-a taxi")
        self.entry_other_emp_a = _make_entry(self.org_a, self.other_emp_a, self.client_a, reason="other taxi")
        self.entry_org_b = _make_entry(self.org_b, self.admin_b, self.client_b, reason="other-org")

        self.api = APIClient()

    def test_employee_sees_only_own(self):
        _auth(self.api, self.emp_a)
        res = self.api.get("/api/conveyance_entries/")
        self.assertEqual(res.status_code, 200, res.data)
        reasons = {e["reason"] for e in res.data["results"]}
        self.assertEqual(reasons, {"emp-a taxi"})

    def test_manager_sees_all_in_own_org(self):
        _auth(self.api, self.manager_a)
        res = self.api.get("/api/conveyance_entries/")
        self.assertEqual(res.status_code, 200)
        reasons = {e["reason"] for e in res.data["results"]}
        self.assertEqual(reasons, {"emp-a taxi", "other taxi"})

    def test_admin_sees_all_in_own_org_not_other_org(self):
        _auth(self.api, self.admin_a)
        res = self.api.get("/api/conveyance_entries/")
        self.assertEqual(res.status_code, 200)
        reasons = {e["reason"] for e in res.data["results"]}
        self.assertEqual(reasons, {"emp-a taxi", "other taxi"})
```

- [ ] **Step 2: Run — should fail (404: no endpoint yet)**

Run: `uv run python manage.py test core.conveyance.tests.ConveyanceEntryListVisibilityTests -v 2`
Expected: all three tests fail with 404 (URL not found).

- [ ] **Step 3: Implement the viewset**

Write to `core/conveyance/views.py`:

```python
from typing import cast

from rest_framework import permissions
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.org_utils import visibility_q
from core.pagination import StandardPagination
from users.models import User

from .models import ConveyanceEntry
from .serializers import ConveyanceEntrySerializer


class ConveyanceEntryViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = ConveyanceEntrySerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardPagination

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = (
            ConveyanceEntry.objects.select_related(
                "employee", "client", "org", "reviewed_by", "created_by"
            )
            .prefetch_related("attachments", "attachments__uploaded_by")
            .filter(visibility_q(user, "employee"))
        )

        employee_uid = self.request.query_params.get("employee_uid")
        client_uid = self.request.query_params.get("client_uid")
        status = self.request.query_params.get("status")
        claimable = self.request.query_params.get("claimable")
        month = self.request.query_params.get("month")
        date_from = self.request.query_params.get("from")
        date_to = self.request.query_params.get("to")
        search = self.request.query_params.get("search")

        if employee_uid:
            qs = qs.filter(employee__uid=employee_uid)
        if client_uid:
            qs = qs.filter(client__uid=client_uid)
        if status in {"pending", "approved", "rejected"}:
            qs = qs.filter(status=status)
        if claimable in {"true", "false"}:
            qs = qs.filter(claimable=(claimable == "true"))
        if month:
            qs = qs.filter(date__startswith=month)
        if date_from:
            qs = qs.filter(date__gte=date_from)
        if date_to:
            qs = qs.filter(date__lte=date_to)
        if search:
            qs = qs.filter(reason__icontains=search)
        return qs

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "request": self.request}
```

- [ ] **Step 4: Register the route**

Replace `core/conveyance/urls.py`:

```python
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import ConveyanceEntryViewSet

router = DefaultRouter()
router.register("conveyance_entries", ConveyanceEntryViewSet, basename="conveyanceentry")

urlpatterns = [path("", include(router.urls))]
```

- [ ] **Step 5: Run tests — all three should pass**

Run: `uv run python manage.py test core.conveyance.tests.ConveyanceEntryListVisibilityTests -v 2`
Expected: `OK` (3 tests).

- [ ] **Step 6: Commit**

```bash
git add core/conveyance/views.py core/conveyance/urls.py core/conveyance/tests.py
git commit -m "feat(conveyance): add list endpoint with visibility_q"
```

---

## Task 10: Entry create (owner default)

**Files:**
- Modify: `core/conveyance/views.py`
- Modify: `core/conveyance/tests.py`

- [ ] **Step 1: Write failing tests**

Append to `core/conveyance/tests.py`:

```python
class ConveyanceEntryCreateTests(TestCase):
    def setUp(self):
        self.org, self.emp = _make_org_user("emp", role="employee")
        self.client_master = _make_client(self.org)
        self.api = APIClient()
        _auth(self.api, self.emp)

    def test_employee_can_create_own_pending_entry(self):
        payload = {
            "date": "2026-04-18",
            "client": str(self.client_master.uid),
            "reason": "client site visit - taxi",
            "amount": "1450.00",
            "claimable": True,
        }
        res = self.api.post("/api/conveyance_entries/", payload, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(ConveyanceEntry.objects.count(), 1)
        entry = ConveyanceEntry.objects.get()
        self.assertEqual(entry.status, "pending")
        self.assertEqual(entry.employee_id, self.emp.id)
        self.assertEqual(entry.created_by_id, self.emp.id)
        assert entry.org is not None
        self.assertEqual(entry.org.id, self.org.id)
```

- [ ] **Step 2: Run — should fail with a 400 or similar**

Run: `uv run python manage.py test core.conveyance.tests.ConveyanceEntryCreateTests -v 2`
Expected: failure (no `perform_create`; org is None).

- [ ] **Step 3: Implement `perform_create`**

Add to `ConveyanceEntryViewSet` in `core/conveyance/views.py`:

```python
    def perform_create(self, serializer):
        from core.org_utils import resolve_create_org
        from rest_framework.exceptions import PermissionDenied, ValidationError

        org, err = resolve_create_org(self.request)
        if err is not None:
            exc_cls = PermissionDenied if err.status_code == 403 else ValidationError
            raise exc_cls(err.data)
        user = cast(User, self.request.user)
        serializer.save(employee=user, created_by=user, org=org)
```

Move the imports to the top of the file alongside the other imports. The inline form above is only to show what's added.

- [ ] **Step 4: Run tests**

Run: `uv run python manage.py test core.conveyance.tests.ConveyanceEntryCreateTests -v 2`
Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add core/conveyance/views.py core/conveyance/tests.py
git commit -m "feat(conveyance): support employee-initiated entry creation"
```

---

## Task 11: Admin on-behalf create + cross-org guard

**Files:**
- Modify: `core/conveyance/serializers.py`
- Modify: `core/conveyance/views.py`
- Modify: `core/conveyance/tests.py`

- [ ] **Step 1: Write failing tests**

Append to `core/conveyance/tests.py`:

```python
class ConveyanceEntryAdminOnBehalfTests(TestCase):
    def setUp(self):
        self.org, self.admin = _make_org_user("admin", role="admin")
        self.emp = User.objects.create_user(username="emp", password="pw", full_name="Emp")
        OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")
        self.org_other, self.admin_other = _make_org_user("admin_other", role="admin")
        self.emp_other = User.objects.create_user(username="emp_other", password="pw", full_name="Emp O")
        OrgMembership.objects.create(user=self.emp_other, org=self.org_other, role="employee")
        self.client_master = _make_client(self.org)
        self.api = APIClient()

    def test_admin_can_create_on_behalf_of_same_org_employee(self):
        _auth(self.api, self.admin)
        payload = {
            "date": "2026-04-18",
            "employee_uid": str(self.emp.uid),
            "client": str(self.client_master.uid),
            "reason": "site visit",
            "amount": "500.00",
        }
        res = self.api.post("/api/conveyance_entries/", payload, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        entry = ConveyanceEntry.objects.get()
        self.assertEqual(entry.employee_id, self.emp.id)
        self.assertEqual(entry.created_by_id, self.admin.id)

    def test_non_admin_cannot_pass_employee_uid(self):
        _auth(self.api, self.emp)
        payload = {
            "date": "2026-04-18",
            "employee_uid": str(self.admin.uid),
            "client": str(self.client_master.uid),
            "reason": "bogus",
            "amount": "10.00",
        }
        res = self.api.post("/api/conveyance_entries/", payload, format="json")
        self.assertEqual(res.status_code, 403, res.data)

    def test_admin_cannot_target_user_in_other_org(self):
        _auth(self.api, self.admin)
        payload = {
            "date": "2026-04-18",
            "employee_uid": str(self.emp_other.uid),
            "client": str(self.client_master.uid),
            "reason": "should fail",
            "amount": "10.00",
        }
        res = self.api.post("/api/conveyance_entries/", payload, format="json")
        self.assertEqual(res.status_code, 400, res.data)
```

- [ ] **Step 2: Accept `employee_uid` on the serializer (write-only)**

In `ConveyanceEntrySerializer`, add a write-only `employee_uid` field and add it to `fields`:

```python
    employee_uid = serializers.UUIDField(write_only=True, required=False)
```

Add `"employee_uid"` to the `fields` list.

- [ ] **Step 3: Update `perform_create` to honour `employee_uid`**

Replace the `perform_create` in `core/conveyance/views.py` with:

```python
    def perform_create(self, serializer):
        user = cast(User, self.request.user)
        org, err = resolve_create_org(self.request)
        if err is not None:
            exc_cls = PermissionDenied if err.status_code == 403 else ValidationError
            raise exc_cls(err.data)

        target_employee = user
        employee_uid = self.request.data.get("employee_uid")
        if employee_uid:
            if not user.is_admin_in(org):
                raise PermissionDenied(
                    {"detail": "Only an admin of the target org may set employee_uid"}
                )
            target_employee = (
                User.objects.filter(uid=employee_uid, memberships__org=org).first()
            )
            if target_employee is None:
                raise ValidationError(
                    {"employee_uid": "User is not a member of the target organisation"}
                )
        serializer.save(employee=target_employee, created_by=user, org=org)
```

Move `from rest_framework.exceptions import PermissionDenied, ValidationError` and `from core.org_utils import resolve_create_org, visibility_q` to the top-level imports.

- [ ] **Step 4: Run tests**

Run: `uv run python manage.py test core.conveyance.tests.ConveyanceEntryAdminOnBehalfTests -v 2`
Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add core/conveyance/serializers.py core/conveyance/views.py core/conveyance/tests.py
git commit -m "feat(conveyance): support admin-on-behalf create with cross-org guard"
```

---

## Task 12: Multi-file atomic create

**Files:**
- Modify: `core/conveyance/serializers.py`
- Modify: `core/conveyance/views.py`
- Modify: `core/conveyance/tests.py`

- [ ] **Step 1: Write failing tests**

Append to `core/conveyance/tests.py`:

```python
import io

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import transaction


class ConveyanceMultiFileCreateTests(TestCase):
    def setUp(self):
        self.org, self.emp = _make_org_user("emp", role="employee")
        self.client_master = _make_client(self.org)
        self.api = APIClient()
        _auth(self.api, self.emp)

    def _file(self, name: str, content: bytes = b"x") -> SimpleUploadedFile:
        return SimpleUploadedFile(name, content, content_type="image/jpeg")

    def test_create_with_three_attachments_and_labels(self):
        payload = {
            "date": "2026-04-18",
            "client": str(self.client_master.uid),
            "reason": "client site visit meals",
            "amount": "1450.00",
            "attachments": [
                self._file("breakfast.jpg"),
                self._file("lunch.jpg"),
                self._file("dinner.jpg"),
            ],
            "attachment_labels": ["Breakfast", "Lunch", "Dinner"],
        }
        res = self.api.post("/api/conveyance_entries/", payload, format="multipart")
        self.assertEqual(res.status_code, 201, res.data)
        entry = ConveyanceEntry.objects.get()
        labels = list(entry.attachments.order_by("created_at").values_list("label", flat=True))
        self.assertEqual(labels, ["Breakfast", "Lunch", "Dinner"])

    def test_create_with_fewer_labels_than_files(self):
        payload = {
            "date": "2026-04-18",
            "client": str(self.client_master.uid),
            "reason": "partial labels",
            "amount": "500.00",
            "attachments": [self._file("a.jpg"), self._file("b.jpg"), self._file("c.jpg")],
            "attachment_labels": ["Only one"],
        }
        res = self.api.post("/api/conveyance_entries/", payload, format="multipart")
        self.assertEqual(res.status_code, 201)
        entry = ConveyanceEntry.objects.get()
        labels = list(entry.attachments.order_by("created_at").values_list("label", flat=True))
        self.assertEqual(labels, ["Only one", "", ""])

    def test_create_with_no_attachments(self):
        payload = {
            "date": "2026-04-18",
            "client": str(self.client_master.uid),
            "reason": "no attachments",
            "amount": "10.00",
        }
        res = self.api.post("/api/conveyance_entries/", payload, format="multipart")
        self.assertEqual(res.status_code, 201)
        entry = ConveyanceEntry.objects.get()
        self.assertEqual(entry.attachments.count(), 0)

    def test_oversize_file_rolls_back_entry_and_all_attachments(self):
        big = io.BytesIO(b"0" * (21 * 1024 * 1024))  # 21 MB — over the 20 MB cap
        over = SimpleUploadedFile("big.jpg", big.getvalue(), content_type="image/jpeg")
        payload = {
            "date": "2026-04-18",
            "client": str(self.client_master.uid),
            "reason": "should rollback",
            "amount": "10.00",
            "attachments": [self._file("ok.jpg"), over],
        }
        res = self.api.post("/api/conveyance_entries/", payload, format="multipart")
        self.assertEqual(res.status_code, 400, res.data)
        self.assertEqual(ConveyanceEntry.objects.count(), 0)
        self.assertEqual(ConveyanceAttachment.objects.count(), 0)
```

- [ ] **Step 2: Run — all fail**

Run: `uv run python manage.py test core.conveyance.tests.ConveyanceMultiFileCreateTests -v 2`
Expected: failures — attachments aren't handled.

- [ ] **Step 3: Implement multi-file handling in `perform_create`**

Replace `perform_create` with:

```python
    def perform_create(self, serializer):
        from django.db import transaction

        from core.filestore.validators import validate_upload

        user = cast(User, self.request.user)
        org, err = resolve_create_org(self.request)
        if err is not None:
            exc_cls = PermissionDenied if err.status_code == 403 else ValidationError
            raise exc_cls(err.data)

        target_employee = user
        employee_uid = self.request.data.get("employee_uid")
        if employee_uid:
            if not user.is_admin_in(org):
                raise PermissionDenied(
                    {"detail": "Only an admin of the target org may set employee_uid"}
                )
            target_employee = (
                User.objects.filter(uid=employee_uid, memberships__org=org).first()
            )
            if target_employee is None:
                raise ValidationError(
                    {"employee_uid": "User is not a member of the target organisation"}
                )

        files = self.request.FILES.getlist("attachments")
        labels = self.request.data.getlist("attachment_labels") if hasattr(self.request.data, "getlist") else []

        for f in files:
            validate_upload(f)

        from .models import ConveyanceAttachment

        with transaction.atomic():
            entry = serializer.save(employee=target_employee, created_by=user, org=org)
            for idx, f in enumerate(files):
                label = labels[idx].strip()[:100] if idx < len(labels) else ""
                ConveyanceAttachment.objects.create(
                    entry=entry,
                    file=f,
                    label=label,
                    uploaded_by=user,
                )
```

Note: `validate_upload` is called before the `transaction.atomic()` opens — so if any file is oversize, we return 400 without even creating the entry row. This is what the rollback test verifies.

- [ ] **Step 4: Run tests**

Run: `uv run python manage.py test core.conveyance.tests.ConveyanceMultiFileCreateTests -v 2`
Expected: `OK` (4 tests).

- [ ] **Step 5: Commit**

```bash
git add core/conveyance/views.py core/conveyance/tests.py
git commit -m "feat(conveyance): accept multi-file attachments on entry create"
```

---

## Task 13: Field-level validation

**Files:**
- Modify: `core/conveyance/serializers.py`
- Modify: `core/conveyance/tests.py`

- [ ] **Step 1: Write failing tests**

Append to `core/conveyance/tests.py`:

```python
import datetime


class ConveyanceValidationTests(TestCase):
    def setUp(self):
        self.org, self.emp = _make_org_user("emp", role="employee")
        self.client_master = _make_client(self.org)
        self.api = APIClient()
        _auth(self.api, self.emp)

    def _base_payload(self):
        return {
            "date": "2026-04-18",
            "client": str(self.client_master.uid),
            "reason": "client visit",
            "amount": "100.00",
        }

    def test_future_date_rejected(self):
        p = self._base_payload()
        p["date"] = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
        res = self.api.post("/api/conveyance_entries/", p, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("date", res.data)

    def test_zero_amount_rejected(self):
        p = self._base_payload()
        p["amount"] = "0"
        res = self.api.post("/api/conveyance_entries/", p, format="json")
        self.assertEqual(res.status_code, 400)

    def test_negative_amount_rejected(self):
        p = self._base_payload()
        p["amount"] = "-1.00"
        res = self.api.post("/api/conveyance_entries/", p, format="json")
        self.assertEqual(res.status_code, 400)

    def test_reason_too_short_rejected(self):
        p = self._base_payload()
        p["reason"] = "ab"
        res = self.api.post("/api/conveyance_entries/", p, format="json")
        self.assertEqual(res.status_code, 400)

    def test_client_of_wrong_type_rejected(self):
        non_client = Master.objects.create(name="cat", type="category", org=self.org)
        non_client.orgs.add(self.org)
        p = self._base_payload()
        p["client"] = str(non_client.uid)
        res = self.api.post("/api/conveyance_entries/", p, format="json")
        self.assertEqual(res.status_code, 400)

    def test_client_from_other_org_rejected(self):
        other_org, _ = _make_org_user("admin_b", role="admin")
        other_client = _make_client(other_org, "B-Client")
        p = self._base_payload()
        p["client"] = str(other_client.uid)
        res = self.api.post("/api/conveyance_entries/", p, format="json")
        self.assertEqual(res.status_code, 400)
```

- [ ] **Step 2: Add validators to the serializer**

In `ConveyanceEntrySerializer`, add:

```python
    def validate_date(self, value):
        from django.utils import timezone

        if value > timezone.localdate():
            raise serializers.ValidationError("Date cannot be in the future")
        return value

    def validate_amount(self, value):
        if value <= 0:
            raise serializers.ValidationError("Amount must be greater than zero")
        if value > 9_999_999_999.99:
            raise serializers.ValidationError("Amount is too large")
        return value

    def validate_reason(self, value):
        stripped = (value or "").strip()
        if len(stripped) < 3:
            raise serializers.ValidationError("Reason must be at least 3 characters")
        return stripped

    def validate_client(self, value):
        # ``SlugRelatedField`` already filters to type=client. Also guarantee
        # the client belongs to one of the caller's orgs.
        request = self.context.get("request")
        if request is not None:
            user = request.user
            caller_org_ids = set(user.org_ids()) if hasattr(user, "org_ids") else set()
            client_org_ids = set(value.orgs.values_list("id", flat=True))
            if value.org_id is not None:
                client_org_ids.add(value.org_id)
            if not (caller_org_ids & client_org_ids):
                raise serializers.ValidationError("Client is not in your organisation")
        return value
```

- [ ] **Step 3: Run tests**

Run: `uv run python manage.py test core.conveyance.tests.ConveyanceValidationTests -v 2`
Expected: `OK` (6 tests).

- [ ] **Step 4: Commit**

```bash
git add core/conveyance/serializers.py core/conveyance/tests.py
git commit -m "feat(conveyance): validate date, amount, reason, and client org"
```

---

## Task 14: Update/delete guards (pending-only for non-admin)

**Files:**
- Modify: `core/conveyance/views.py`
- Modify: `core/conveyance/tests.py`

- [ ] **Step 1: Write failing tests**

Append to `core/conveyance/tests.py`:

```python
from rest_framework.exceptions import PermissionDenied as _DrfPermDenied  # noqa: F401


class ConveyanceEditDeleteGuardTests(TestCase):
    def setUp(self):
        self.org, self.admin = _make_org_user("admin", role="admin")
        self.emp = User.objects.create_user(username="emp", password="pw", full_name="Emp")
        OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")
        self.client_master = _make_client(self.org)
        self.entry = _make_entry(self.org, self.emp, self.client_master)
        self.api = APIClient()

    def test_owner_can_edit_pending(self):
        _auth(self.api, self.emp)
        res = self.api.patch(
            f"/api/conveyance_entries/{self.entry.uid}/",
            {"reason": "updated reason"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.entry.refresh_from_db()
        self.assertEqual(self.entry.reason, "updated reason")

    def test_owner_cannot_edit_approved(self):
        self.entry.status = "approved"
        self.entry.save()
        _auth(self.api, self.emp)
        res = self.api.patch(
            f"/api/conveyance_entries/{self.entry.uid}/",
            {"reason": "nope"},
            format="json",
        )
        self.assertEqual(res.status_code, 403, res.data)

    def test_admin_can_edit_approved(self):
        self.entry.status = "approved"
        self.entry.save()
        _auth(self.api, self.admin)
        res = self.api.patch(
            f"/api/conveyance_entries/{self.entry.uid}/",
            {"reason": "admin fix"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)

    def test_owner_can_delete_pending(self):
        _auth(self.api, self.emp)
        res = self.api.delete(f"/api/conveyance_entries/{self.entry.uid}/")
        self.assertEqual(res.status_code, 204)

    def test_owner_cannot_delete_approved(self):
        self.entry.status = "approved"
        self.entry.save()
        _auth(self.api, self.emp)
        res = self.api.delete(f"/api/conveyance_entries/{self.entry.uid}/")
        self.assertEqual(res.status_code, 403)

    def test_admin_can_delete_approved(self):
        self.entry.status = "approved"
        self.entry.save()
        _auth(self.api, self.admin)
        res = self.api.delete(f"/api/conveyance_entries/{self.entry.uid}/")
        self.assertEqual(res.status_code, 204)
```

- [ ] **Step 2: Add guard helpers to the viewset**

Add to `ConveyanceEntryViewSet`:

```python
    def _caller_is_admin_in_entry_org(self, entry) -> bool:
        user = cast(User, self.request.user)
        return bool(entry.org_id and user.is_admin_in(entry.org_id))

    def _assert_mutable_for_caller(self, entry):
        user = cast(User, self.request.user)
        if self._caller_is_admin_in_entry_org(entry):
            return
        if entry.status != "pending":
            raise PermissionDenied({"detail": "Only pending entries can be modified"})
        if entry.employee_id != user.id:
            raise PermissionDenied({"detail": "You can only modify your own entries"})

    def perform_update(self, serializer):
        self._assert_mutable_for_caller(serializer.instance)
        serializer.save()

    def perform_destroy(self, instance):
        self._assert_mutable_for_caller(instance)
        instance.delete()
```

- [ ] **Step 3: Run tests**

Run: `uv run python manage.py test core.conveyance.tests.ConveyanceEditDeleteGuardTests -v 2`
Expected: `OK` (6 tests).

- [ ] **Step 4: Commit**

```bash
git add core/conveyance/views.py core/conveyance/tests.py
git commit -m "feat(conveyance): enforce pending-only edits for non-admin callers"
```

---

## Task 15: Approve action

**Files:**
- Modify: `core/conveyance/views.py`
- Modify: `core/conveyance/tests.py`

- [ ] **Step 1: Write failing tests**

Append to `core/conveyance/tests.py`:

```python
class ConveyanceApproveTests(TestCase):
    def setUp(self):
        self.org, self.admin = _make_org_user("admin", role="admin")
        self.manager = User.objects.create_user(username="mgr", password="pw", full_name="Mgr")
        OrgMembership.objects.create(user=self.manager, org=self.org, role="manager")
        self.emp = User.objects.create_user(username="emp", password="pw", full_name="Emp")
        OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")
        self.client_master = _make_client(self.org)
        self.entry = _make_entry(self.org, self.emp, self.client_master)
        self.api = APIClient()

    def test_manager_can_approve(self):
        _auth(self.api, self.manager)
        res = self.api.post(f"/api/conveyance_entries/{self.entry.uid}/approve/", {}, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        self.entry.refresh_from_db()
        self.assertEqual(self.entry.status, "approved")
        self.assertEqual(self.entry.reviewed_by_id, self.manager.id)
        self.assertIsNotNone(self.entry.reviewed_at)

    def test_employee_cannot_approve(self):
        _auth(self.api, self.emp)
        res = self.api.post(f"/api/conveyance_entries/{self.entry.uid}/approve/", {}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_cannot_review_own_entry(self):
        own = _make_entry(self.org, self.admin, self.client_master, reason="admin expense")
        _auth(self.api, self.admin)
        res = self.api.post(f"/api/conveyance_entries/{own.uid}/approve/", {}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_second_approve_is_conflict(self):
        _auth(self.api, self.admin)
        self.api.post(f"/api/conveyance_entries/{self.entry.uid}/approve/", {}, format="json")
        res = self.api.post(f"/api/conveyance_entries/{self.entry.uid}/approve/", {}, format="json")
        self.assertEqual(res.status_code, 409)

    def test_approve_writes_audit_log(self):
        from core.audit.models import AuditLog

        _auth(self.api, self.admin)
        res = self.api.post(f"/api/conveyance_entries/{self.entry.uid}/approve/", {}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(
            AuditLog.objects.filter(
                action="conveyance.approve", resource_id=str(self.entry.uid)
            ).exists()
        )
```

- [ ] **Step 2: Implement the action**

Add to `ConveyanceEntryViewSet`:

```python
    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request, uid=None):
        from django.utils import timezone

        from core.audit.models import log as audit_log
        from core.realtime import broadcast

        entry: ConveyanceEntry = self.get_object()
        user = cast(User, request.user)
        if entry.employee_id == user.id:
            raise PermissionDenied({"detail": "Cannot review your own entry"})
        if not user.is_manager_in(entry.org_id):
            raise PermissionDenied(
                {"detail": "Manager or admin role required in the entry's organisation"}
            )
        if entry.status != "pending":
            return Response(
                {"detail": f"Entry is already {entry.status}"},
                status=409,
            )
        entry.status = "approved"
        entry.reviewed_by = user
        entry.reviewed_at = timezone.now()
        entry.review_note = (request.data.get("review_note") or "").strip()[:500]
        entry.save()
        audit_log(
            user,
            "conveyance.approve",
            resource_type="conveyance_entry",
            resource_id=entry.uid,
            changes={"status": "approved"},
            request=request,
        )
        data = ConveyanceEntrySerializer(entry, context={"request": request}).data
        broadcast("conveyance-entries", "UPDATE", data)
        return Response(data)
```

Move imports to the top of the file. Add `from rest_framework.decorators import action` and `from rest_framework.response import Response` if not already imported.

- [ ] **Step 3: Run tests**

Run: `uv run python manage.py test core.conveyance.tests.ConveyanceApproveTests -v 2`
Expected: `OK` (5 tests).

- [ ] **Step 4: Commit**

```bash
git add core/conveyance/views.py core/conveyance/tests.py
git commit -m "feat(conveyance): add approve action with audit and broadcast"
```

---

## Task 16: Reject action

**Files:**
- Modify: `core/conveyance/views.py`
- Modify: `core/conveyance/tests.py`

- [ ] **Step 1: Write failing tests**

Append to `core/conveyance/tests.py`:

```python
class ConveyanceRejectTests(TestCase):
    def setUp(self):
        self.org, self.admin = _make_org_user("admin", role="admin")
        self.emp = User.objects.create_user(username="emp", password="pw", full_name="Emp")
        OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")
        self.client_master = _make_client(self.org)
        self.entry = _make_entry(self.org, self.emp, self.client_master)
        self.api = APIClient()
        _auth(self.api, self.admin)

    def test_reject_requires_review_note(self):
        res = self.api.post(
            f"/api/conveyance_entries/{self.entry.uid}/reject/",
            {},
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("review_note", str(res.data))

    def test_reject_short_review_note_rejected(self):
        res = self.api.post(
            f"/api/conveyance_entries/{self.entry.uid}/reject/",
            {"review_note": "no"},
            format="json",
        )
        self.assertEqual(res.status_code, 400)

    def test_admin_can_reject_with_note(self):
        res = self.api.post(
            f"/api/conveyance_entries/{self.entry.uid}/reject/",
            {"review_note": "missing receipts"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.entry.refresh_from_db()
        self.assertEqual(self.entry.status, "rejected")
        self.assertEqual(self.entry.review_note, "missing receipts")
        self.assertEqual(self.entry.reviewed_by_id, self.admin.id)
```

- [ ] **Step 2: Implement the action**

Add to `ConveyanceEntryViewSet`:

```python
    @action(detail=True, methods=["post"], url_path="reject")
    def reject(self, request, uid=None):
        from django.utils import timezone

        from core.audit.models import log as audit_log
        from core.realtime import broadcast

        entry: ConveyanceEntry = self.get_object()
        user = cast(User, request.user)
        note = (request.data.get("review_note") or "").strip()
        if len(note) < 3:
            return Response(
                {"review_note": "A rejection note of at least 3 characters is required"},
                status=400,
            )
        if entry.employee_id == user.id:
            raise PermissionDenied({"detail": "Cannot review your own entry"})
        if not user.is_manager_in(entry.org_id):
            raise PermissionDenied(
                {"detail": "Manager or admin role required in the entry's organisation"}
            )
        if entry.status != "pending":
            return Response(
                {"detail": f"Entry is already {entry.status}"},
                status=409,
            )
        entry.status = "rejected"
        entry.reviewed_by = user
        entry.reviewed_at = timezone.now()
        entry.review_note = note[:500]
        entry.save()
        audit_log(
            user,
            "conveyance.reject",
            resource_type="conveyance_entry",
            resource_id=entry.uid,
            changes={"status": "rejected", "reason": entry.review_note},
            request=request,
        )
        data = ConveyanceEntrySerializer(entry, context={"request": request}).data
        broadcast("conveyance-entries", "UPDATE", data)
        return Response(data)
```

- [ ] **Step 3: Run tests**

Run: `uv run python manage.py test core.conveyance.tests.ConveyanceRejectTests -v 2`
Expected: `OK` (3 tests).

- [ ] **Step 4: Commit**

```bash
git add core/conveyance/views.py core/conveyance/tests.py
git commit -m "feat(conveyance): add reject action with required review note"
```

---

## Task 17: `ConveyanceAttachmentViewSet` — retrieve + download

**Files:**
- Modify: `core/conveyance/views.py`
- Modify: `core/conveyance/urls.py`
- Modify: `core/conveyance/tests.py`

- [ ] **Step 1: Write failing tests**

Append to `core/conveyance/tests.py`:

```python
class ConveyanceAttachmentDownloadTests(TestCase):
    def setUp(self):
        self.org, self.emp = _make_org_user("emp", role="employee")
        self.client_master = _make_client(self.org)
        self.entry = _make_entry(self.org, self.emp, self.client_master)
        self.attachment = ConveyanceAttachment.objects.create(
            entry=self.entry,
            file=SimpleUploadedFile("bill.jpg", b"hello", content_type="image/jpeg"),
            label="Breakfast",
            uploaded_by=self.emp,
        )
        self.api = APIClient()

    def test_owner_can_download(self):
        _auth(self.api, self.emp)
        res = self.api.get(f"/api/conveyance_attachments/{self.attachment.uid}/download/")
        self.assertEqual(res.status_code, 200)

    def test_anonymous_cannot_download(self):
        res = self.api.get(f"/api/conveyance_attachments/{self.attachment.uid}/download/")
        self.assertIn(res.status_code, (401, 403))

    def test_cross_org_user_gets_404(self):
        other_org, other_user = _make_org_user("other_admin", role="admin")
        _auth(self.api, other_user)
        res = self.api.get(f"/api/conveyance_attachments/{self.attachment.uid}/download/")
        self.assertEqual(res.status_code, 404)
```

- [ ] **Step 2: Add the viewset**

Append to `core/conveyance/views.py`:

```python
from rest_framework.viewsets import GenericViewSet
from rest_framework.mixins import CreateModelMixin, DestroyModelMixin, RetrieveModelMixin


class ConveyanceAttachmentViewSet(
    UidLookupMixin,
    RetrieveModelMixin,
    CreateModelMixin,
    DestroyModelMixin,
    GenericViewSet,
):
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        from .models import ConveyanceAttachment

        user = cast(User, self.request.user)
        return (
            ConveyanceAttachment.objects.select_related("entry", "entry__employee", "uploaded_by")
            .filter(entry__in=ConveyanceEntry.objects.filter(visibility_q(user, "employee")))
        )

    def get_serializer_class(self):
        from .serializers import ConveyanceAttachmentSerializer

        return ConveyanceAttachmentSerializer

    def get_serializer_context(self):
        return {**super().get_serializer_context(), "request": self.request}

    @action(detail=True, methods=["get"], url_path="download")
    def download(self, request, uid=None):
        import mimetypes

        from django.http import FileResponse, Http404

        attachment = self.get_object()
        if not attachment.file:
            raise Http404("No file attached")
        filename = attachment.file.name.rsplit("/", 1)[-1]
        content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        force_download = request.query_params.get("download") in {"1", "true"}
        response = FileResponse(
            attachment.file.open("rb"),
            filename=filename,
            content_type=content_type,
        )
        disposition = "attachment" if force_download else "inline"
        response["Content-Disposition"] = f'{disposition}; filename="{filename}"'
        return response
```

- [ ] **Step 3: Register the route**

Update `core/conveyance/urls.py`:

```python
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import ConveyanceAttachmentViewSet, ConveyanceEntryViewSet

router = DefaultRouter()
router.register("conveyance_entries", ConveyanceEntryViewSet, basename="conveyanceentry")
router.register("conveyance_attachments", ConveyanceAttachmentViewSet, basename="conveyanceattachment")

urlpatterns = [path("", include(router.urls))]
```

- [ ] **Step 4: Run tests**

Run: `uv run python manage.py test core.conveyance.tests.ConveyanceAttachmentDownloadTests -v 2`
Expected: `OK` (3 tests).

- [ ] **Step 5: Commit**

```bash
git add core/conveyance/views.py core/conveyance/urls.py core/conveyance/tests.py
git commit -m "feat(conveyance): add attachment viewset with auth-gated download"
```

---

## Task 18: Attachment create endpoint (add more to existing entry)

**Files:**
- Modify: `core/conveyance/views.py`
- Modify: `core/conveyance/tests.py`

- [ ] **Step 1: Write failing tests**

Append to `core/conveyance/tests.py`:

```python
class ConveyanceAttachmentCreateTests(TestCase):
    def setUp(self):
        self.org, self.admin = _make_org_user("admin", role="admin")
        self.emp = User.objects.create_user(username="emp", password="pw", full_name="Emp")
        OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")
        self.client_master = _make_client(self.org)
        self.entry = _make_entry(self.org, self.emp, self.client_master)
        self.api = APIClient()

    def _file(self, name="extra.jpg"):
        return SimpleUploadedFile(name, b"x", content_type="image/jpeg")

    def test_owner_adds_attachment_to_pending(self):
        _auth(self.api, self.emp)
        res = self.api.post(
            "/api/conveyance_attachments/",
            {"entry_uid": str(self.entry.uid), "file": self._file(), "label": "Coffee"},
            format="multipart",
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(self.entry.attachments.count(), 1)

    def test_owner_cannot_add_to_approved(self):
        self.entry.status = "approved"
        self.entry.save()
        _auth(self.api, self.emp)
        res = self.api.post(
            "/api/conveyance_attachments/",
            {"entry_uid": str(self.entry.uid), "file": self._file()},
            format="multipart",
        )
        self.assertEqual(res.status_code, 403)

    def test_admin_can_add_to_approved(self):
        self.entry.status = "approved"
        self.entry.save()
        _auth(self.api, self.admin)
        res = self.api.post(
            "/api/conveyance_attachments/",
            {"entry_uid": str(self.entry.uid), "file": self._file()},
            format="multipart",
        )
        self.assertEqual(res.status_code, 201)

    def test_adding_to_invisible_entry_returns_404(self):
        other_org, other_user = _make_org_user("other_admin", role="admin")
        _auth(self.api, other_user)
        res = self.api.post(
            "/api/conveyance_attachments/",
            {"entry_uid": str(self.entry.uid), "file": self._file()},
            format="multipart",
        )
        self.assertEqual(res.status_code, 404)
```

- [ ] **Step 2: Override `create` on `ConveyanceAttachmentViewSet`**

Add to the viewset:

```python
    def create(self, request, *args, **kwargs):
        from django.shortcuts import get_object_or_404

        from core.filestore.validators import validate_upload
        from core.realtime import broadcast

        from .models import ConveyanceAttachment

        user = cast(User, request.user)
        entry_uid = request.data.get("entry_uid")
        if not entry_uid:
            return Response({"entry_uid": "Required"}, status=400)

        entry_qs = ConveyanceEntry.objects.filter(visibility_q(user, "employee"))
        entry = get_object_or_404(entry_qs, uid=entry_uid)

        is_admin_in_org = bool(entry.org_id and user.is_admin_in(entry.org_id))
        if not is_admin_in_org:
            if entry.employee_id != user.id:
                raise PermissionDenied({"detail": "Not allowed to add attachments to this entry"})
            if entry.status != "pending":
                raise PermissionDenied({"detail": "Only pending entries accept new attachments"})

        uploaded = request.FILES.get("file")
        if not uploaded:
            return Response({"file": "Required"}, status=400)
        validate_upload(uploaded)

        label = (request.data.get("label") or "").strip()[:100]
        attachment = ConveyanceAttachment.objects.create(
            entry=entry, file=uploaded, label=label, uploaded_by=user
        )
        broadcast(
            "conveyance-entries",
            "UPDATE",
            ConveyanceEntrySerializer(entry, context={"request": request}).data,
        )
        return Response(
            self.get_serializer(attachment).data,
            status=201,
        )
```

- [ ] **Step 3: Run tests**

Run: `uv run python manage.py test core.conveyance.tests.ConveyanceAttachmentCreateTests -v 2`
Expected: `OK` (4 tests).

- [ ] **Step 4: Commit**

```bash
git add core/conveyance/views.py core/conveyance/tests.py
git commit -m "feat(conveyance): accept ad-hoc attachment uploads onto existing entries"
```

---

## Task 19: Attachment delete endpoint

**Files:**
- Modify: `core/conveyance/views.py`
- Modify: `core/conveyance/tests.py`

- [ ] **Step 1: Write failing tests**

Append to `core/conveyance/tests.py`:

```python
import os


class ConveyanceAttachmentDestroyTests(TestCase):
    def setUp(self):
        self.org, self.admin = _make_org_user("admin", role="admin")
        self.emp = User.objects.create_user(username="emp", password="pw", full_name="Emp")
        OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")
        self.client_master = _make_client(self.org)
        self.entry = _make_entry(self.org, self.emp, self.client_master)
        self.attachment = ConveyanceAttachment.objects.create(
            entry=self.entry,
            file=SimpleUploadedFile("bill.jpg", b"x", content_type="image/jpeg"),
            uploaded_by=self.emp,
        )
        self.api = APIClient()

    def test_owner_deletes_pending_attachment(self):
        path = self.attachment.file.path
        self.assertTrue(os.path.exists(path))
        _auth(self.api, self.emp)
        res = self.api.delete(f"/api/conveyance_attachments/{self.attachment.uid}/")
        self.assertEqual(res.status_code, 204)
        self.assertFalse(os.path.exists(path))
        self.assertEqual(self.entry.attachments.count(), 0)

    def test_owner_cannot_delete_on_approved_entry(self):
        self.entry.status = "approved"
        self.entry.save()
        _auth(self.api, self.emp)
        res = self.api.delete(f"/api/conveyance_attachments/{self.attachment.uid}/")
        self.assertEqual(res.status_code, 403)

    def test_admin_can_delete_on_approved_entry(self):
        self.entry.status = "approved"
        self.entry.save()
        _auth(self.api, self.admin)
        res = self.api.delete(f"/api/conveyance_attachments/{self.attachment.uid}/")
        self.assertEqual(res.status_code, 204)
```

- [ ] **Step 2: Override `destroy` on the viewset**

Add to `ConveyanceAttachmentViewSet`:

```python
    def destroy(self, request, *args, **kwargs):
        from core.realtime import broadcast

        attachment = self.get_object()
        entry = attachment.entry
        user = cast(User, request.user)

        is_admin_in_org = bool(entry.org_id and user.is_admin_in(entry.org_id))
        if not is_admin_in_org:
            if entry.employee_id != user.id:
                raise PermissionDenied({"detail": "Not allowed"})
            if entry.status != "pending":
                raise PermissionDenied({"detail": "Only pending entries accept attachment removal"})

        if attachment.file:
            attachment.file.delete(save=False)
        attachment.delete()
        broadcast(
            "conveyance-entries",
            "UPDATE",
            ConveyanceEntrySerializer(entry, context={"request": request}).data,
        )
        return Response(status=204)
```

- [ ] **Step 3: Run tests**

Run: `uv run python manage.py test core.conveyance.tests.ConveyanceAttachmentDestroyTests -v 2`
Expected: `OK` (3 tests).

- [ ] **Step 4: Commit**

```bash
git add core/conveyance/views.py core/conveyance/tests.py
git commit -m "feat(conveyance): delete attachment with file cleanup and broadcast"
```

---

## Task 20: Entry delete cascades attachment file cleanup

**Files:**
- Modify: `core/conveyance/views.py`
- Modify: `core/conveyance/tests.py`

Django's `on_delete=CASCADE` on `entry` removes the `ConveyanceAttachment` row, but the file on disk is **not** removed automatically. Do that explicitly before the cascade fires.

- [ ] **Step 1: Write failing test**

Append to `core/conveyance/tests.py`:

```python
class ConveyanceEntryDeleteCascadeTests(TestCase):
    def setUp(self):
        self.org, self.emp = _make_org_user("emp", role="employee")
        self.client_master = _make_client(self.org)
        self.entry = _make_entry(self.org, self.emp, self.client_master)
        self.att1 = ConveyanceAttachment.objects.create(
            entry=self.entry,
            file=SimpleUploadedFile("a.jpg", b"a", content_type="image/jpeg"),
        )
        self.att2 = ConveyanceAttachment.objects.create(
            entry=self.entry,
            file=SimpleUploadedFile("b.jpg", b"b", content_type="image/jpeg"),
        )
        self.api = APIClient()
        _auth(self.api, self.emp)

    def test_entry_delete_removes_attachment_files(self):
        paths = [self.att1.file.path, self.att2.file.path]
        for p in paths:
            self.assertTrue(os.path.exists(p))
        res = self.api.delete(f"/api/conveyance_entries/{self.entry.uid}/")
        self.assertEqual(res.status_code, 204)
        self.assertEqual(ConveyanceAttachment.objects.count(), 0)
        for p in paths:
            self.assertFalse(os.path.exists(p), f"file still exists: {p}")
```

- [ ] **Step 2: Update `perform_destroy` on `ConveyanceEntryViewSet`**

Replace `perform_destroy`:

```python
    def perform_destroy(self, instance):
        self._assert_mutable_for_caller(instance)
        for attachment in instance.attachments.all():
            if attachment.file:
                attachment.file.delete(save=False)
        instance.delete()
```

- [ ] **Step 3: Run tests**

Run: `uv run python manage.py test core.conveyance.tests.ConveyanceEntryDeleteCascadeTests -v 2`
Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add core/conveyance/views.py core/conveyance/tests.py
git commit -m "feat(conveyance): remove attachment files when the parent entry is deleted"
```

---

## Task 21: Summary — single-month mode

**Files:**
- Modify: `core/conveyance/views.py`
- Modify: `core/conveyance/tests.py`

- [ ] **Step 1: Write failing tests**

Append to `core/conveyance/tests.py`:

```python
from decimal import Decimal


class ConveyanceSummarySingleModeTests(TestCase):
    def setUp(self):
        self.org, self.admin = _make_org_user("admin", role="admin")
        self.emp_a = User.objects.create_user(username="emp_a", password="pw", full_name="A")
        OrgMembership.objects.create(user=self.emp_a, org=self.org, role="employee")
        self.emp_b = User.objects.create_user(username="emp_b", password="pw", full_name="B")
        OrgMembership.objects.create(user=self.emp_b, org=self.org, role="employee")
        self.client_master = _make_client(self.org)
        self.api = APIClient()
        _auth(self.api, self.admin)

    def _approved(self, emp, date, amount, claimable=True, reason="x"):
        e = _make_entry(
            self.org, emp, self.client_master,
            date=date, amount=amount, claimable=claimable, reason=reason,
        )
        e.status = "approved"
        e.reviewed_by = self.admin
        e.reviewed_at = "2026-04-20T00:00:00Z"
        e.save()
        return e

    def test_requires_group_by(self):
        res = self.api.get("/api/conveyance_entries/summary/")
        self.assertEqual(res.status_code, 400)

    def test_group_by_employee_single_month_sums(self):
        self._approved(self.emp_a, "2026-04-01", "100.00")
        self._approved(self.emp_a, "2026-04-10", "200.00")
        self._approved(self.emp_b, "2026-04-15", "50.00")
        self._approved(self.emp_a, "2026-03-30", "999.00")  # excluded (wrong month)
        self._approved(self.emp_a, "2026-04-02", "77.00", claimable=False)  # excluded (non-claimable)
        # pending entry (excluded):
        _make_entry(self.org, self.emp_a, self.client_master, date="2026-04-20", amount="11.00")

        res = self.api.get("/api/conveyance_entries/summary/?group_by=employee&mode=single&month=2026-04")
        self.assertEqual(res.status_code, 200, res.data)
        rows = {r["key_label"]: r for r in res.data["rows"]}
        self.assertEqual(Decimal(rows["A"]["total"]), Decimal("300.00"))
        self.assertEqual(rows["A"]["entry_count"], 2)
        self.assertEqual(Decimal(rows["B"]["total"]), Decimal("50.00"))
        self.assertEqual(rows["B"]["entry_count"], 1)
        self.assertEqual(Decimal(res.data["grand_total"]), Decimal("350.00"))

    def test_top_entries_capped_at_three_ordered_desc(self):
        self._approved(self.emp_a, "2026-04-01", "100.00", reason="r1")
        self._approved(self.emp_a, "2026-04-02", "300.00", reason="r3")
        self._approved(self.emp_a, "2026-04-03", "200.00", reason="r2")
        self._approved(self.emp_a, "2026-04-04", "50.00", reason="r4")
        res = self.api.get("/api/conveyance_entries/summary/?group_by=employee&mode=single&month=2026-04")
        row = res.data["rows"][0]
        amounts = [Decimal(e["amount"]) for e in row["top_entries"]]
        self.assertEqual(amounts, [Decimal("300.00"), Decimal("200.00"), Decimal("100.00")])
```

- [ ] **Step 2: Implement the summary action**

Add to `ConveyanceEntryViewSet`:

```python
    @action(detail=False, methods=["get"], url_path="summary")
    def summary(self, request):
        import datetime
        from decimal import Decimal

        from django.db.models import Count, Sum
        from django.db.models.functions import TruncMonth

        user = cast(User, request.user)
        group_by = request.query_params.get("group_by")
        if group_by not in {"employee", "client"}:
            return Response({"detail": "group_by must be 'employee' or 'client'"}, status=400)

        mode = request.query_params.get("mode", "single")
        if mode not in {"single", "trailing"}:
            return Response({"detail": "mode must be 'single' or 'trailing'"}, status=400)

        # Orgs where caller is admin or manager. Plain-employee orgs excluded.
        privileged_org_ids = list(
            user.memberships.filter(role__in=["admin", "manager"])
            .values_list("org_id", flat=True)
        )
        if not privileged_org_ids:
            raise PermissionDenied({"detail": "Manager or admin role required"})

        base = ConveyanceEntry.objects.filter(
            org_id__in=privileged_org_ids,
            status="approved",
            claimable=True,
        )

        key_field = "employee" if group_by == "employee" else "client"
        key_uid_path = f"{key_field}__uid"
        key_label_expr = (
            "employee__full_name" if group_by == "employee" else "client__name"
        )

        if mode == "single":
            month_str = request.query_params.get("month")
            if month_str:
                try:
                    year, month = [int(x) for x in month_str.split("-")]
                    month_start = datetime.date(year, month, 1)
                except (ValueError, TypeError):
                    return Response({"detail": "Invalid month format (expected YYYY-MM)"}, status=400)
            else:
                today = datetime.date.today()
                month_start = today.replace(day=1)
            next_month = (
                month_start.replace(year=month_start.year + 1, month=1)
                if month_start.month == 12
                else month_start.replace(month=month_start.month + 1)
            )

            scoped = base.filter(date__gte=month_start, date__lt=next_month)
            aggregates = (
                scoped.values(key_uid_path, key_label_expr)
                .annotate(total=Sum("amount"), entry_count=Count("id"))
                .order_by("-total")
            )

            rows = []
            grand = Decimal("0.00")
            for row in aggregates:
                uid = row[key_uid_path]
                label = row[key_label_expr] or ""
                total = row["total"] or Decimal("0.00")
                grand += total
                # Top 3 entries by amount for tooltip
                top_qs = scoped.filter(**{key_uid_path: uid}).order_by("-amount")[:3]
                top = [
                    {
                        "uid": str(e.uid),
                        "date": e.date.isoformat(),
                        "reason": (e.reason or "")[:120],
                        "amount": str(e.amount),
                    }
                    for e in top_qs
                ]
                rows.append(
                    {
                        "key_uid": str(uid),
                        "key_label": label,
                        "total": str(total),
                        "entry_count": row["entry_count"],
                        "top_entries": top,
                    }
                )
            return Response(
                {
                    "mode": "single",
                    "month": month_start.isoformat()[:7],
                    "group_by": group_by,
                    "rows": rows,
                    "grand_total": str(grand),
                }
            )

        # Trailing mode is implemented in Task 22 — fall through for now.
        return Response({"detail": "trailing mode not implemented yet"}, status=501)
```

- [ ] **Step 3: Run tests**

Run: `uv run python manage.py test core.conveyance.tests.ConveyanceSummarySingleModeTests -v 2`
Expected: `OK` (3 tests).

- [ ] **Step 4: Commit**

```bash
git add core/conveyance/views.py core/conveyance/tests.py
git commit -m "feat(conveyance): add summary endpoint — single-month mode"
```

---

## Task 22: Summary — trailing mode + clamping + zero-fill + employee-only restriction

**Files:**
- Modify: `core/conveyance/views.py`
- Modify: `core/conveyance/tests.py`

- [ ] **Step 1: Write failing tests**

Append to `core/conveyance/tests.py`:

```python
class ConveyanceSummaryTrailingAndGuardsTests(TestCase):
    def setUp(self):
        self.org, self.admin = _make_org_user("admin", role="admin")
        self.emp = User.objects.create_user(username="emp", password="pw", full_name="Emp")
        OrgMembership.objects.create(user=self.emp, org=self.org, role="employee")
        self.plain_emp_org, self.plain_emp = _make_org_user("plain", role="employee")
        self.client_master = _make_client(self.org)
        self.api = APIClient()

    def _approved(self, date, amount, reason="r"):
        e = _make_entry(
            self.org, self.emp, self.client_master,
            date=date, amount=amount, reason=reason,
        )
        e.status = "approved"
        e.reviewed_by = self.admin
        e.save()
        return e

    def test_plain_employee_forbidden(self):
        _auth(self.api, self.plain_emp)
        res = self.api.get("/api/conveyance_entries/summary/?group_by=employee&mode=single")
        self.assertEqual(res.status_code, 403)

    def test_trailing_mode_zero_fills_months(self):
        _auth(self.api, self.admin)
        self._approved("2026-04-10", "100.00")
        res = self.api.get(
            "/api/conveyance_entries/summary/"
            "?group_by=employee&mode=trailing&months=3&end=2026-04"
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["months"], ["2026-02", "2026-03", "2026-04"])
        self.assertEqual(len(res.data["rows"]), 1)
        monthly = res.data["rows"][0]["monthly"]
        self.assertEqual(Decimal(monthly["2026-02"]), Decimal("0.00"))
        self.assertEqual(Decimal(monthly["2026-03"]), Decimal("0.00"))
        self.assertEqual(Decimal(monthly["2026-04"]), Decimal("100.00"))
        self.assertEqual(Decimal(res.data["rows"][0]["total"]), Decimal("100.00"))

    def test_trailing_months_clamped_to_one_through_twelve(self):
        _auth(self.api, self.admin)
        self._approved("2026-04-10", "10.00")
        res = self.api.get(
            "/api/conveyance_entries/summary/"
            "?group_by=employee&mode=trailing&months=99&end=2026-04"
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data["months"]), 12)
        res = self.api.get(
            "/api/conveyance_entries/summary/"
            "?group_by=employee&mode=trailing&months=0&end=2026-04"
        )
        self.assertEqual(len(res.data["months"]), 1)
```

- [ ] **Step 2: Implement trailing mode**

Replace the "trailing mode not implemented yet" line in the summary action with:

```python
        # Trailing mode
        months_param = request.query_params.get("months", "6")
        try:
            n_months = int(months_param)
        except (TypeError, ValueError):
            n_months = 6
        n_months = max(1, min(12, n_months))

        end_str = request.query_params.get("end")
        if end_str:
            try:
                year, month = [int(x) for x in end_str.split("-")]
                end_month_start = datetime.date(year, month, 1)
            except (ValueError, TypeError):
                return Response({"detail": "Invalid end format (expected YYYY-MM)"}, status=400)
        else:
            today = datetime.date.today()
            end_month_start = today.replace(day=1)

        months = []
        cursor = end_month_start
        for _ in range(n_months):
            months.append(cursor)
            if cursor.month == 1:
                cursor = cursor.replace(year=cursor.year - 1, month=12)
            else:
                cursor = cursor.replace(month=cursor.month - 1)
        months.reverse()

        window_start = months[0]
        window_end_exclusive = (
            end_month_start.replace(year=end_month_start.year + 1, month=1)
            if end_month_start.month == 12
            else end_month_start.replace(month=end_month_start.month + 1)
        )

        scoped = base.filter(date__gte=window_start, date__lt=window_end_exclusive)
        pivot = (
            scoped.annotate(month=TruncMonth("date"))
            .values(key_uid_path, key_label_expr, "month")
            .annotate(total=Sum("amount"))
        )

        months_labels = [m.isoformat()[:7] for m in months]
        by_key: dict[str, dict] = {}
        for row in pivot:
            uid = str(row[key_uid_path])
            label = row[key_label_expr] or ""
            bucket = by_key.setdefault(
                uid,
                {
                    "key_uid": uid,
                    "key_label": label,
                    "monthly": {m: "0.00" for m in months_labels},
                    "total": Decimal("0.00"),
                },
            )
            mstr = row["month"].strftime("%Y-%m")
            bucket["monthly"][mstr] = str(row["total"] or Decimal("0.00"))
            bucket["total"] += row["total"] or Decimal("0.00")

        rows_out = []
        column_totals = {m: Decimal("0.00") for m in months_labels}
        grand = Decimal("0.00")
        for bucket in sorted(by_key.values(), key=lambda b: b["total"], reverse=True):
            for m in months_labels:
                column_totals[m] += Decimal(bucket["monthly"][m])
            grand += bucket["total"]
            bucket["total"] = str(bucket["total"])
            rows_out.append(bucket)

        return Response(
            {
                "mode": "trailing",
                "months": months_labels,
                "group_by": group_by,
                "rows": rows_out,
                "column_totals": {m: str(v) for m, v in column_totals.items()},
                "grand_total": str(grand),
            }
        )
```

- [ ] **Step 3: Run tests**

Run: `uv run python manage.py test core.conveyance.tests.ConveyanceSummaryTrailingAndGuardsTests -v 2`
Expected: `OK` (3 tests).

- [ ] **Step 4: Run the full backend test suite**

Run: `uv run python manage.py test core.conveyance -v 2`
Expected: all tests pass. If any earlier class now fails due to shared fixture drift, fix it in place.

- [ ] **Step 5: Run the full linting and typing gates**

```bash
uv run ruff check core/conveyance
uv run ruff format --check core/conveyance
uv run python manage.py check
uv run mypy core/conveyance
uv run pyright core/conveyance
```

Expected: no errors. Fix anything that surfaces.

- [ ] **Step 6: Commit**

```bash
git add core/conveyance/views.py core/conveyance/tests.py
git commit -m "feat(conveyance): add summary trailing mode with month clamping and zero-fill"
```

---

# Frontend Phase (Tasks 23–32)

**Prerequisites for this phase:** Backend Tasks 1–22 are merged and the dev server responds on `/api/conveyance_entries/` and `/api/conveyance_attachments/`.

Run `npm install` inside `frontend/task-tracker/` once before starting if you haven't already.

---

## Task 23: Types + API helpers + Vitest for helpers

**Files:**
- Create: `frontend/task-tracker/src/types/conveyance.ts`
- Create: `frontend/task-tracker/src/utils/conveyanceApi.ts`
- Create: `frontend/task-tracker/src/utils/__tests__/conveyanceApi.test.ts`

- [ ] **Step 1: Write the types file**

```typescript
// frontend/task-tracker/src/types/conveyance.ts
export type ConveyanceStatus = "pending" | "approved" | "rejected";

export interface UserMin {
  uid: string;
  username: string;
  full_name: string;
}

export interface MasterMin {
  uid: string;
  name: string;
  type: string;
}

export interface ConveyanceAttachment {
  uid: string;
  label: string;
  file_url: string | null;
  filename: string | null;
  uploaded_by_detail: UserMin | null;
  created_at: string;
}

export interface ConveyanceEntry {
  uid: string;
  date: string;
  employee_detail: UserMin;
  client_detail: MasterMin;
  reason: string;
  amount: string;
  claimable: boolean;
  status: ConveyanceStatus;
  review_note: string;
  reviewed_by_detail: UserMin | null;
  reviewed_at: string | null;
  attachments: ConveyanceAttachment[];
  created_by_detail: UserMin | null;
  created_at: string;
  updated_at: string;
}

export type SummaryGroupBy = "employee" | "client";
export type SummaryMode = "single" | "trailing";

export interface SummaryTopEntry {
  uid: string;
  date: string;
  reason: string;
  amount: string;
}

export interface SummarySingleRow {
  key_uid: string;
  key_label: string;
  total: string;
  entry_count: number;
  top_entries: SummaryTopEntry[];
}

export interface SummarySingleResponse {
  mode: "single";
  month: string;
  group_by: SummaryGroupBy;
  rows: SummarySingleRow[];
  grand_total: string;
}

export interface SummaryTrailingRow {
  key_uid: string;
  key_label: string;
  monthly: Record<string, string>;
  total: string;
}

export interface SummaryTrailingResponse {
  mode: "trailing";
  months: string[];
  group_by: SummaryGroupBy;
  rows: SummaryTrailingRow[];
  column_totals: Record<string, string>;
  grand_total: string;
}

export type SummaryResponse = SummarySingleResponse | SummaryTrailingResponse;
```

- [ ] **Step 2: Write the API helper**

```typescript
// frontend/task-tracker/src/utils/conveyanceApi.ts
import { apiGet, apiPost, apiPatch, apiDelete } from "../lib/api";
import type {
  ConveyanceAttachment,
  ConveyanceEntry,
  SummaryGroupBy,
  SummaryMode,
  SummaryResponse,
} from "../types/conveyance";

export interface ListFilters {
  employee_uid?: string;
  client_uid?: string;
  status?: "pending" | "approved" | "rejected";
  claimable?: "true" | "false";
  month?: string;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
}

export function listEntries(filters: ListFilters = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === "") continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return apiGet<{ results: ConveyanceEntry[]; count: number }>(
    `/api/conveyance_entries/${qs ? `?${qs}` : ""}`
  );
}

export function createEntry(form: FormData) {
  return apiPost<ConveyanceEntry>("/api/conveyance_entries/", form);
}

export function updateEntry(uid: string, body: Partial<ConveyanceEntry>) {
  return apiPatch<ConveyanceEntry>(`/api/conveyance_entries/${uid}/`, body);
}

export function deleteEntry(uid: string) {
  return apiDelete(`/api/conveyance_entries/${uid}/`);
}

export function approveEntry(uid: string, reviewNote?: string) {
  return apiPost<ConveyanceEntry>(`/api/conveyance_entries/${uid}/approve/`, {
    review_note: reviewNote ?? "",
  });
}

export function rejectEntry(uid: string, reviewNote: string) {
  return apiPost<ConveyanceEntry>(`/api/conveyance_entries/${uid}/reject/`, {
    review_note: reviewNote,
  });
}

export function addAttachment(entryUid: string, file: File, label: string) {
  const form = new FormData();
  form.append("entry_uid", entryUid);
  form.append("file", file);
  form.append("label", label);
  return apiPost<ConveyanceAttachment>("/api/conveyance_attachments/", form);
}

export function deleteAttachment(uid: string) {
  return apiDelete(`/api/conveyance_attachments/${uid}/`);
}

export interface SummaryParams {
  group_by: SummaryGroupBy;
  mode: SummaryMode;
  month?: string;
  months?: number;
  end?: string;
}

export function fetchSummary(params: SummaryParams) {
  const qp = new URLSearchParams();
  qp.set("group_by", params.group_by);
  qp.set("mode", params.mode);
  if (params.month) qp.set("month", params.month);
  if (params.months != null) qp.set("months", String(params.months));
  if (params.end) qp.set("end", params.end);
  return apiGet<SummaryResponse>(`/api/conveyance_entries/summary/?${qp.toString()}`);
}
```

Note: `apiPost` must accept both JSON and `FormData` — check the existing helper in `src/lib/api.ts`. If it doesn't, add a branch that passes `FormData` through without JSON-stringifying and without a `Content-Type` header (let the browser set the multipart boundary).

- [ ] **Step 3: Write Vitest for the helpers**

```typescript
// frontend/task-tracker/src/utils/__tests__/conveyanceApi.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ results: [], count: 0 }),
  });
  vi.stubGlobal("fetch", fetchMock);
});

import { listEntries, fetchSummary } from "../conveyanceApi";

describe("conveyanceApi", () => {
  it("omits empty filters from the querystring", async () => {
    await listEntries({ month: "2026-04", status: undefined });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("month=2026-04");
    expect(url).not.toContain("status=");
  });

  it("builds a correct trailing summary URL", async () => {
    await fetchSummary({ group_by: "client", mode: "trailing", months: 6, end: "2026-04" });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("group_by=client");
    expect(url).toContain("mode=trailing");
    expect(url).toContain("months=6");
    expect(url).toContain("end=2026-04");
  });
});
```

- [ ] **Step 4: Run the Vitest file**

```bash
cd frontend/task-tracker
npm run test -- src/utils/__tests__/conveyanceApi.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/types/conveyance.ts \
        frontend/task-tracker/src/utils/conveyanceApi.ts \
        frontend/task-tracker/src/utils/__tests__/conveyanceApi.test.ts
git commit -m "feat(conveyance-ui): add types and API helpers"
```

---

## Task 24: Page shell + routing + nav entry

**Files:**
- Create: `frontend/task-tracker/src/pages/ConveyancePage.tsx`
- Create: `frontend/task-tracker/src/components/conveyance/ConveyancePage.tsx`
- Modify: `frontend/task-tracker/src/App.tsx`
- Modify: existing sidebar/nav component (grep for the existing "Invoice" nav entry and add "Conveyance" next to it)

- [ ] **Step 1: Create the page stub**

```typescript
// frontend/task-tracker/src/pages/ConveyancePage.tsx
import { useState } from "react";

type Tab = "transactions" | "employeeTotals" | "clientTotals";

interface Props {
  profile: { uid: string; role_in_selected_org?: string } | null;
  selectedOrg: { uid: string } | null;
}

export default function ConveyancePage({ profile, selectedOrg }: Props) {
  const [tab, setTab] = useState<Tab>("transactions");
  const isManagerOrAdmin = ["admin", "manager"].includes(profile?.role_in_selected_org ?? "");

  return (
    <div className="p-4">
      <div role="tablist" className="flex gap-2 border-b mb-4">
        <button role="tab" aria-selected={tab === "transactions"} onClick={() => setTab("transactions")}>
          Transactions
        </button>
        {isManagerOrAdmin && (
          <>
            <button role="tab" aria-selected={tab === "employeeTotals"} onClick={() => setTab("employeeTotals")}>
              Employee Totals
            </button>
            <button role="tab" aria-selected={tab === "clientTotals"} onClick={() => setTab("clientTotals")}>
              Client Totals
            </button>
          </>
        )}
      </div>
      {tab === "transactions" && <div>Transactions tab (Task 25)</div>}
      {tab === "employeeTotals" && <div>Employee totals (Task 30)</div>}
      {tab === "clientTotals" && <div>Client totals (Task 30)</div>}
    </div>
  );
}
```

(Note: use the exact access-flag naming the rest of the app uses; grep the codebase and replace `role_in_selected_org` to match.)

- [ ] **Step 2: Wire into `App.tsx`**

Near the other `const XxxPage = lazy(() => import("./pages/XxxPage"))` declarations in `App.tsx`, add:

```typescript
const ConveyancePage = lazy(() => import("./pages/ConveyancePage"));
```

Add a `"conveyance":` entry to the page map, passing `profile` and `selectedOrg` the same way the neighbours do.

- [ ] **Step 3: Add the sidebar nav entry**

Grep for the existing `"Invoices"` or `"invoice"` nav label. Add a new row/button next to it labelled **Conveyance** that calls the app's navigation API with the key `"conveyance"`. Mirror the feature-access gate used on adjacent entries if there is one; otherwise make it visible to every authenticated user.

- [ ] **Step 4: Verify the page renders**

```bash
cd frontend/task-tracker
npm run dev
# In another terminal, verify http://localhost:5173 loads and clicking the
# new sidebar entry shows the three tabs.
```

- [ ] **Step 5: Lint + build**

```bash
npm run lint
npm run build
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add frontend/task-tracker/src/pages/ConveyancePage.tsx frontend/task-tracker/src/App.tsx <sidebar-file>
git commit -m "feat(conveyance-ui): add page shell with tab bar and nav entry"
```

---

## Task 25: Transactions tab — list, filters, URL sync

**Files:**
- Create: `frontend/task-tracker/src/components/conveyance/ConveyanceTransactions.tsx`
- Create: `frontend/task-tracker/src/components/conveyance/ConveyanceFilters.tsx`
- Create: `frontend/task-tracker/src/components/conveyance/__tests__/ConveyanceFilters.test.tsx`
- Modify: `frontend/task-tracker/src/pages/ConveyancePage.tsx`

- [ ] **Step 1: Build `ConveyanceFilters`**

A controlled component with inputs for Employee (admin/manager only), Client, Month, Status, Claimable, Search. Takes `value: ListFilters`, `onChange: (v: ListFilters) => void`, plus an `isManagerOrAdmin` bool to gate the Employee selector.

On every change, serialize filter state to URL query params (`useSearchParams` from `react-router`-style helper — mirror whatever the existing pages use; `InvoicePage` is a good reference).

Key behaviour to test: setting `{month: "2026-04", status: "approved"}` results in `?month=2026-04&status=approved` in the URL; parsing those params back yields the same object.

- [ ] **Step 2: Vitest for filters**

```typescript
// ConveyanceFilters.test.tsx
import { describe, it, expect } from "vitest";
import { parseFiltersFromSearch, serializeFiltersToSearch } from "../ConveyanceFilters";

describe("filters URL sync", () => {
  it("round-trips a populated filter", () => {
    const input = { month: "2026-04", status: "approved" as const, claimable: "true" as const };
    const qs = serializeFiltersToSearch(input);
    const parsed = parseFiltersFromSearch(new URLSearchParams(qs));
    expect(parsed).toEqual(input);
  });

  it("drops empty values", () => {
    const qs = serializeFiltersToSearch({ month: "", search: undefined });
    expect(qs).toBe("");
  });
});
```

Implement `parseFiltersFromSearch` and `serializeFiltersToSearch` as named exports from the filters module so the tests can import them.

- [ ] **Step 3: Build `ConveyanceTransactions`**

A component that:
- Reads filter state from the URL on mount (via `parseFiltersFromSearch`).
- Calls `listEntries(filters)` on mount and on filter change.
- Renders a table with columns `Date · Employee · Client · Reason · Amount · Claimable · Status · Attachments · Actions` (Attachments column is a placeholder `—` for now — real UI lands in Task 27).
- Shows a loading state, empty state, and error toast.

- [ ] **Step 4: Mount it in the page**

Replace the `"Transactions tab (Task 25)"` placeholder in `ConveyancePage.tsx` with `<ConveyanceTransactions />`.

- [ ] **Step 5: Verify in browser**

Seed a few entries via the admin; open the Conveyance tab; confirm they appear and that changing a filter updates the URL and the list.

- [ ] **Step 6: Run Vitest + lint + build**

```bash
cd frontend/task-tracker
npm run test
npm run lint
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add frontend/task-tracker/src/components/conveyance/ \
        frontend/task-tracker/src/pages/ConveyancePage.tsx
git commit -m "feat(conveyance-ui): add Transactions tab with filters and URL sync"
```

---

## Task 26: Form dialog — create entry with multi-file attachments

**Files:**
- Create: `frontend/task-tracker/src/components/conveyance/ConveyanceFormDialog.tsx`
- Create: `frontend/task-tracker/src/components/conveyance/__tests__/ConveyanceFormDialog.test.tsx`

- [ ] **Step 1: Write the dialog component**

Build a modal with:
- `Date` input (default = today; future dates disabled by `max` attribute).
- `Client` searchable dropdown — reuse existing `useMasters()` hook filtered to `type=client`.
- `Reason` textarea.
- `Amount` number input (`min=0.01`, `step=0.01`).
- `Claimable` toggle (default on).
- **Attachments area**: `<input type="file" multiple>`. Selected files render below as a list with filename, size, and a per-row `Label` text input plus a remove button. Client-side 20 MB/file limit — flag oversize files inline and disable submit until resolved.

On submit, build a `FormData`:

```typescript
const form = new FormData();
form.append("date", date);
form.append("client", clientUid);
form.append("reason", reason);
form.append("amount", amount);
form.append("claimable", claimable ? "true" : "false");
for (const { file, label } of filesWithLabels) {
  form.append("attachments", file);
  form.append("attachment_labels", label);
}
```

Call `createEntry(form)`. On success: close dialog, emit an `onCreated(entry)` callback so the parent list can reconcile.

- [ ] **Step 2: Tests**

```typescript
// ConveyanceFormDialog.test.tsx — key tests
// - Submit is disabled when any file is > 20 MB.
// - Submit is disabled when reason < 3 chars or amount <= 0 or client missing.
// - Given 3 files with 3 labels, FormData contains 3 "attachments" entries and
//   3 "attachment_labels" entries in order.
// - Given 3 files with 1 label, the remaining 2 "attachment_labels" entries are
//   empty strings.
```

Use `render` + `fireEvent` from `@testing-library/react` and `vi.fn()` for the `createEntry` mock.

- [ ] **Step 3: Wire into Transactions tab**

Add an **Add entry** button above the table that opens `ConveyanceFormDialog`. On `onCreated`, prepend the new entry to the list.

- [ ] **Step 4: Smoke test in browser**

Create an entry with 3 files + 3 labels. Verify in Django admin that the entry has 3 attachment rows with correct labels and files on disk.

- [ ] **Step 5: Run Vitest + lint + build, then commit**

```bash
cd frontend/task-tracker
npm run test src/components/conveyance/__tests__/ConveyanceFormDialog.test.tsx
npm run lint
npm run build
git add frontend/task-tracker/src/components/conveyance/ConveyanceFormDialog.tsx \
        frontend/task-tracker/src/components/conveyance/__tests__/ConveyanceFormDialog.test.tsx \
        frontend/task-tracker/src/components/conveyance/ConveyanceTransactions.tsx
git commit -m "feat(conveyance-ui): add create-entry dialog with multi-file attachments"
```

---

## Task 27: Attachment list popover

**Files:**
- Create: `frontend/task-tracker/src/components/conveyance/ConveyanceAttachmentList.tsx`
- Create: `frontend/task-tracker/src/components/conveyance/__tests__/ConveyanceAttachmentList.test.tsx`
- Modify: `frontend/task-tracker/src/components/conveyance/ConveyanceTransactions.tsx`

- [ ] **Step 1: Write the component**

```tsx
// ConveyanceAttachmentList.tsx
import type { ConveyanceAttachment } from "../../types/conveyance";

interface Props {
  attachments: ConveyanceAttachment[];
  canDelete: boolean;
  onDelete?: (uid: string) => void;
}

export default function ConveyanceAttachmentList({ attachments, canDelete, onDelete }: Props) {
  if (attachments.length === 0) return <span>—</span>;
  if (attachments.length === 1) {
    const a = attachments[0];
    return (
      <a href={a.file_url ?? "#"} target="_blank" rel="noreferrer" title={a.label || a.filename || ""}>
        📎 {a.label || a.filename}
      </a>
    );
  }
  return (
    <details>
      <summary>📎 {attachments.length}</summary>
      <ul className="mt-1 text-sm">
        {attachments.map(a => (
          <li key={a.uid} className="flex items-center gap-2">
            <a href={a.file_url ?? "#"} target="_blank" rel="noreferrer">
              {a.label || a.filename}
            </a>
            {canDelete && onDelete && (
              <button type="button" onClick={() => onDelete(a.uid)} aria-label={`Delete ${a.label || a.filename}`}>
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
```

- [ ] **Step 2: Test**

```tsx
// Key tests in ConveyanceAttachmentList.test.tsx:
// - attachments.length === 0 -> renders a dash.
// - length === 1 -> renders a single <a> without a <details>.
// - length > 1 -> renders a <summary> with count and list of links.
// - canDelete=false -> no delete buttons present.
// - onDelete is called with correct uid when a delete button is clicked.
```

- [ ] **Step 3: Mount in Transactions table**

Replace the Attachments column placeholder in `ConveyanceTransactions.tsx` with `<ConveyanceAttachmentList attachments={row.attachments} canDelete={false} />`. The edit flow in Task 28 turns on `canDelete`.

- [ ] **Step 4: Test + lint + build + commit**

```bash
cd frontend/task-tracker
npm run test src/components/conveyance/__tests__/ConveyanceAttachmentList.test.tsx
npm run lint
npm run build
git add frontend/task-tracker/src/components/conveyance/ConveyanceAttachmentList.tsx \
        frontend/task-tracker/src/components/conveyance/__tests__/ConveyanceAttachmentList.test.tsx \
        frontend/task-tracker/src/components/conveyance/ConveyanceTransactions.tsx
git commit -m "feat(conveyance-ui): render attachment list with popover"
```

---

## Task 28: Edit flow with attachment add/delete

**Files:**
- Modify: `frontend/task-tracker/src/components/conveyance/ConveyanceFormDialog.tsx`
- Modify: `frontend/task-tracker/src/components/conveyance/ConveyanceTransactions.tsx`

- [ ] **Step 1: Extend `ConveyanceFormDialog` to accept an existing entry**

Add a prop `entry?: ConveyanceEntry`. When present:
- Populate all fields from `entry`.
- Split the attachments section into two lists:
  - **Existing attachments** — render `<ConveyanceAttachmentList attachments={entry.attachments} canDelete onDelete={handleDelete}/>`, where `handleDelete` calls `deleteAttachment(uid)` and updates local state.
  - **Add more** — same multi-file + label input as create mode, but on submit, `POST` each to `/api/conveyance_attachments/` via `addAttachment(entry.uid, file, label)` (not bundled with the PATCH).
- The primary submit button calls `updateEntry(entry.uid, patch)` with only the mutable fields.
- `onSaved(entry)` callback fires once on success.

Visibility rules implemented client-side (defensive — server still enforces):
- If `entry.status !== "pending"` and the caller is not admin in the entry's org, disable all inputs (dialog opens in read-only mode).

- [ ] **Step 2: Add Edit / Delete buttons to the Transactions row**

Buttons and their visibility rules:
- **Edit** — visible when `canEdit(row, currentUser)`; opens `ConveyanceFormDialog` with `entry={row}`.
- **Delete** — same visibility; opens a confirm modal, then calls `deleteEntry(uid)`.

`canEdit(row, user)` = `user.isAdminInEntryOrg(row) || (row.status === "pending" && row.employee_detail.uid === user.uid)`.

- [ ] **Step 3: Smoke test and commit**

```bash
cd frontend/task-tracker
npm run test
npm run lint
npm run build
git add frontend/task-tracker/src/components/conveyance/
git commit -m "feat(conveyance-ui): support editing entries and adding/removing attachments"
```

---

## Task 29: Approve / Reject UI

**Files:**
- Create: `frontend/task-tracker/src/components/conveyance/ConveyanceRejectDialog.tsx`
- Modify: `frontend/task-tracker/src/components/conveyance/ConveyanceTransactions.tsx`

- [ ] **Step 1: `ConveyanceRejectDialog`**

Modal with a textarea for `review_note` (min 3 chars enforced client-side; disable submit until valid) and a Cancel / Reject pair. On submit, calls `rejectEntry(uid, note)` and fires `onRejected`.

- [ ] **Step 2: Add row actions**

For each row where `row.status === "pending"` AND `currentUser.isManagerOrAdminInEntryOrg(row)` AND `row.employee_detail.uid !== currentUser.uid`:
- **Approve** — calls `approveEntry(uid)` (no note needed; uses empty string).
- **Reject** — opens `ConveyanceRejectDialog`.

On success, replace the row in local state with the API response.

- [ ] **Step 3: Test + lint + build + commit**

```bash
cd frontend/task-tracker
npm run test
npm run lint
npm run build
git add frontend/task-tracker/src/components/conveyance/
git commit -m "feat(conveyance-ui): wire approve and reject actions with reject-note dialog"
```

---

## Task 30: Summary — single-month view

**Files:**
- Create: `frontend/task-tracker/src/components/conveyance/ConveyanceSummary.tsx`
- Create: `frontend/task-tracker/src/components/conveyance/__tests__/ConveyanceSummaryTable.test.tsx`
- Modify: `frontend/task-tracker/src/pages/ConveyancePage.tsx`

- [ ] **Step 1: Build `ConveyanceSummary`**

Takes a `groupBy: SummaryGroupBy` prop. Internal state:
- `mode: "single" | "trailing"` (default `"single"`).
- `month: string` (default current `YYYY-MM`).
- `months: number` (default 6).
- `end: string` (default current `YYYY-MM`).

On mount and whenever these change, call `fetchSummary(...)`. Switch-render based on `response.mode`.

**Single-mode table** columns: `key_label · entry_count · total`. Each row is wrapped in a link that navigates to the Transactions tab with `?tab=transactions&<groupBy>_uid=<key_uid>&month=<YYYY-MM>&status=approved&claimable=true`. Use the existing `<Link>` component the app uses (mirror how `InvoicePage` summary rows link).

Hover tooltip on the `total` cell renders `top_entries` in a small popover: each line = `{date} · {reason} · ₹{amount}`. If `entry_count > top_entries.length`, append "…and N more".

Grand-total row at the bottom.

- [ ] **Step 2: Test**

```tsx
// ConveyanceSummaryTable.test.tsx — key tests
// - Given a SummarySingleResponse with 2 rows, both rows render with the
//   correct link hrefs (include group_by key uid + month + status=approved).
// - The grand-total row renders with the sum.
// - On hover, the tooltip for a row renders all its top_entries.
// - When entry_count > 3, the tooltip shows "...and N more" where
//   N === entry_count - top_entries.length.
```

- [ ] **Step 3: Mount in the page**

Replace both `"Employee totals (Task 30)"` and `"Client totals (Task 30)"` with `<ConveyanceSummary groupBy="employee"/>` and `<ConveyanceSummary groupBy="client"/>` respectively.

- [ ] **Step 4: Verify in browser**

With seeded approved claimable entries, confirm:
- Switching month updates totals.
- Clicking a row navigates to Transactions pre-filtered correctly.
- Hovering the total shows top_entries with money and date.

- [ ] **Step 5: Test + lint + build + commit**

```bash
cd frontend/task-tracker
npm run test
npm run lint
npm run build
git add frontend/task-tracker/src/components/conveyance/ \
        frontend/task-tracker/src/pages/ConveyancePage.tsx
git commit -m "feat(conveyance-ui): add single-month summary with drill-down and tooltip"
```

---

## Task 31: Summary — trailing pivot + per-cell tooltip drill-down

**Files:**
- Modify: `frontend/task-tracker/src/components/conveyance/ConveyanceSummary.tsx`

- [ ] **Step 1: Render the trailing pivot**

When `mode === "trailing"`, render a table with:
- First column: `key_label`.
- One column per month in `response.months` (oldest → `end`).
- Last column: row `total`.

Each month cell (including the `"0.00"` zero-filled ones) is a link to Transactions with `?tab=transactions&<groupBy>_uid=<key_uid>&month=<that-month>&status=approved&claimable=true`.

Column totals row fixed to the bottom; grand total cell in the bottom-right.

- [ ] **Step 2: Per-cell tooltip**

On hover over a cell:
1. Check an in-memory cache `Map<string, SummaryTopEntry[]>` keyed by `${key_uid}|${month}`.
2. If absent, call `fetchSummary({ group_by, mode: "single", month, ...})` — filter the response to the row whose `key_uid` matches, store its `top_entries` in the cache.
3. Render the tooltip content as in Task 30.

Debounce cache fetches (250ms) so rapid mouse movement doesn't spam the API.

- [ ] **Step 3: Mode toggle control**

Add a toggle at the top of the summary section between **Single month** and **Trailing** modes, and the controls for `months` (number input 1–12) and `end` (YYYY-MM picker). Disable the irrelevant controls per mode.

- [ ] **Step 4: Smoke test + commit**

```bash
cd frontend/task-tracker
npm run test
npm run lint
npm run build
git add frontend/task-tracker/src/components/conveyance/ConveyanceSummary.tsx
git commit -m "feat(conveyance-ui): add trailing pivot with per-cell drill-down tooltip"
```

---

## Task 32: Realtime subscription + final polish

**Files:**
- Modify: `frontend/task-tracker/src/pages/ConveyancePage.tsx`

- [ ] **Step 1: Subscribe to the channel**

Locate the existing WebSocket helper used by other pages (grep for `subscribeToChannel` / `useRealtime` / similar; the Invoices page uses it). In `ConveyancePage.tsx`, subscribe to `"conveyance-entries"` and, on each event:
- `INSERT` → prepend the serialized entry into Transactions local state (if filters match) and mark summary tabs as stale.
- `UPDATE` → replace the matching uid in Transactions; mark summary tabs as stale.
- `DELETE` → remove the matching uid from Transactions; mark summary tabs as stale.

Add a small banner in the Summary tabs that appears when `stale === true`: "Data has changed · Refresh". Clicking it re-fetches the summary.

- [ ] **Step 2: Final gate — run everything**

```bash
cd frontend/task-tracker
npm run test
npm run lint
npm run build
cd ../..
uv run python manage.py test core.conveyance -v 2
uv run ruff check .
uv run mypy core/conveyance
uv run pyright core/conveyance
uv run python manage.py check
```

All green.

- [ ] **Step 3: Commit**

```bash
git add frontend/task-tracker/src/pages/ConveyancePage.tsx
git commit -m "feat(conveyance-ui): subscribe to conveyance-entries channel with stale-summary banner"
```

---

# Post-implementation checklist

- [ ] Admin can create, approve, reject, and delete entries across all states.
- [ ] Employee can create own entry with multiple attachments, edit while pending, and see their own totals excluded from admin aggregate views.
- [ ] Manager can approve/reject entries in their org but not in orgs where they're a plain employee.
- [ ] Uploading an oversized attachment returns a 400 and leaves no entry behind.
- [ ] Summary drill-down links produce the correct filtered Transactions view.
- [ ] Realtime updates propagate across two browser windows.
- [ ] Deleting an entry removes all its attachment files from disk.

---

# Spec coverage map (self-review)

| Spec section | Covered by |
|---|---|
| 3.1 New app | Task 1 |
| 3.2 `ConveyanceEntry` model | Task 3 |
| 3.3 `ConveyanceAttachment` model | Task 4 |
| 3.4 Upload helper | Task 2 |
| 3.5 Role-based visibility | Task 9 |
| 3.6 Approval authority | Task 15, 16 |
| 4.1 List/Create | Task 9, 10, 11, 12 |
| 4.2 Retrieve/Update/Delete | Task 14 |
| 4.3 Approve | Task 15 |
| 4.4 Reject | Task 16 |
| 4.5 Add attachment | Task 18 |
| 4.6 Delete attachment | Task 19 |
| 4.7 Download attachment | Task 17 |
| 4.8 Summary (single + trailing) | Task 21, 22 |
| 5.1 Tab bar | Task 24 |
| 5.2 Transactions | Task 25, 26, 27, 28, 29 |
| 5.3 Summary tabs | Task 30, 31 |
| 5.4 Supporting files | Task 23 |
| 5.5 Realtime | Task 32 |
| 6.1 Entry field validation | Task 13 |
| 6.2 Attachment serializer validation | Task 7, 18 |
| 6.3 Viewset-level guards | Task 14, 20 |
| 6.4 Approve/Reject edge cases | Task 15, 16 |
| 6.5 Summary edge cases | Task 21, 22 |
| 6.6 Multi-tenant safety | Task 9, 11, 15, 17, 18 |
| 6.7 Audit & realtime | Task 15, 16, 18, 19, 32 |
| 7 Testing plan | Covered inline per task |
| 8 Migration safety | Task 5 |
