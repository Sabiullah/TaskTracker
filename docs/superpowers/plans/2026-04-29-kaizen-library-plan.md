# Kaizen Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cross-organisation Kaizen Library: any employee can raise a takeaway from a client engagement; an admin (in any org) approves or rejects with a required reason. Approved/Pending entries are visible to everyone regardless of org; rejected entries soft-hide from the default list.

**Architecture:** New Django app `core/kaizen` with a single `Kaizen` model (status: Pending → Approved/Rejected). Standard DRF `ModelViewSet` plus two custom admin actions (`approve` / `reject`). The list endpoint deliberately bypasses the `visibility_q`/org-scope filter so the library is global. New React page modelled on `GrowthPlanPage` with inline-edit rows, a `RejectModal`, and a status pill. Realtime via the existing Channels broadcast on a new `"kaizen"` channel.

**Tech Stack:** Django 6, DRF, Django Channels (existing), React 19 + Vite + TypeScript (existing). No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-04-29-kaizen-library-design.md`](../specs/2026-04-29-kaizen-library-design.md).

---

## File Layout

**Backend (created):**

| File | Purpose |
|---|---|
| `core/kaizen/__init__.py` | empty |
| `core/kaizen/apps.py` | `KaizenConfig` |
| `core/kaizen/models.py` | `Kaizen` model + `STATUS_CHOICES` |
| `core/kaizen/serializers.py` | `KaizenSerializer` |
| `core/kaizen/views.py` | `KaizenViewSet` with `approve` / `reject` actions |
| `core/kaizen/urls.py` | router registration |
| `core/kaizen/admin.py` | `KaizenAdmin` |
| `core/kaizen/tests.py` | API tests |
| `core/kaizen/migrations/__init__.py` | empty |
| `core/kaizen/migrations/0001_initial.py` | initial migration |

**Backend (modified):**

| File | Change |
|---|---|
| `config/settings.py` | add `"core.kaizen"` to `INSTALLED_APPS` |
| `config/urls.py` | add `path("api/", include("core.kaizen.urls"))` |

**Frontend (created):**

| File | Purpose |
|---|---|
| `frontend/task-tracker/src/types/api/kaizen.ts` | DTO + Create/Update types |
| `frontend/task-tracker/src/types/kaizen.ts` | `KaizenRow` domain type + status union |
| `frontend/task-tracker/src/utils/kaizen.ts` | `STATUSES`, `STATUS_CFG`, `BLANK_KAIZEN_ROW`, `dtoToKaizenRow` |
| `frontend/task-tracker/src/components/kaizen/EditRow.tsx` | inline edit row |
| `frontend/task-tracker/src/components/kaizen/RejectModal.tsx` | rejection-reason modal |
| `frontend/task-tracker/src/hooks/useKaizenPendingBadge.ts` | admin-only Pending count |
| `frontend/task-tracker/src/pages/KaizenPage.tsx` | the page itself |

**Frontend (modified):**

| File | Change |
|---|---|
| `frontend/task-tracker/src/types/api/index.ts` | barrel-export `./kaizen` |
| `frontend/task-tracker/src/types/api/realtime.ts` | add `"kaizen"` channel name |
| `frontend/task-tracker/src/types/index.ts` | barrel-export `./kaizen` |
| `frontend/task-tracker/src/components/layout/Header.tsx` | add `kaizen` SVG icon + thread `kaizenBadgeCount` prop |
| `frontend/task-tracker/src/components/header/NavMenu.tsx` | new "Kaizen" tab + badge |
| `frontend/task-tracker/src/App.tsx` | lazy import + `VIEW_MAP` entry + `useKaizenPendingBadge()` |

---

## Task 1 — Scaffold the Django app

**Files:**
- Create: `core/kaizen/__init__.py`, `core/kaizen/apps.py`, `core/kaizen/models.py`, `core/kaizen/serializers.py`, `core/kaizen/views.py`, `core/kaizen/urls.py`, `core/kaizen/admin.py`, `core/kaizen/tests.py`, `core/kaizen/migrations/__init__.py`
- Modify: `config/settings.py`, `config/urls.py`

- [ ] **Step 1.1: Create empty package files**

```bash
mkdir -p D:/TaskTracker/core/kaizen/migrations
```

Then create all of these files as empty (or near-empty) so subsequent tasks can edit them in place:

`core/kaizen/__init__.py` — empty file.
`core/kaizen/migrations/__init__.py` — empty file.
`core/kaizen/tests.py` — empty file (replace in Task 9).

`core/kaizen/apps.py`:

```python
from django.apps import AppConfig


class KaizenConfig(AppConfig):
    name = "core.kaizen"
```

`core/kaizen/models.py` — placeholder so Django can import the app (replaced in Task 2):

```python
# Models defined in Task 2.
```

`core/kaizen/serializers.py`, `core/kaizen/views.py`, `core/kaizen/admin.py` — each just a single-line comment header so the imports later don't 404 mid-edit:

```python
# Implemented in subsequent plan tasks.
```

`core/kaizen/urls.py`:

```python
from django.urls import include, path
from rest_framework.routers import DefaultRouter

router = DefaultRouter()
# ViewSets registered in Task 5.

urlpatterns = [path("", include(router.urls))]
```

- [ ] **Step 1.2: Register the app in `INSTALLED_APPS`**

Edit `config/settings.py`. Find the existing `INSTALLED_APPS` block and add `"core.kaizen",` next to the other `core.*` entries (alphabetical-ish, after `"core.invoices"`):

```python
INSTALLED_APPS = [
    # ... existing entries ...
    "core.invoices",
    "core.kaizen",
    "core.chat",
    # ... rest unchanged ...
]
```

- [ ] **Step 1.3: Include the URLs**

Edit `config/urls.py`. Add a single line in the `urlpatterns` list, alongside the other `core.*.urls` includes:

```python
path("api/", include("core.kaizen.urls")),
```

- [ ] **Step 1.4: Verify Django can load the project**

Run: `uv run python manage.py check`
Expected: `System check identified no issues (0 silenced).`

- [ ] **Step 1.5: Commit**

```bash
git add core/kaizen config/settings.py config/urls.py
git commit -m "feat(kaizen): scaffold core.kaizen app"
```

---

## Task 2 — `Kaizen` model + initial migration

**Files:**
- Modify: `core/kaizen/models.py`
- Create: `core/kaizen/migrations/0001_initial.py` (auto-generated)

- [ ] **Step 2.1: Write the model**

Replace the contents of `core/kaizen/models.py` with:

```python
import uuid

from django.conf import settings
from django.db import models

from core.base import TimeStampedModel


class Kaizen(TimeStampedModel):
    STATUS_CHOICES = [
        ("Pending", "Pending"),
        ("Approved", "Approved"),
        ("Rejected", "Rejected"),
    ]

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    org = models.ForeignKey(
        "users.Org",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="kaizens",
    )
    raised_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="raised_kaizens",
    )
    entry_date = models.DateField(db_index=True)
    client = models.ForeignKey(
        "masters.Master",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="client_kaizens",
        limit_choices_to={"type": "client"},
    )
    area = models.CharField(max_length=255, blank=True, default="")
    description = models.TextField()
    takeaway = models.TextField()
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default="Pending",
        db_index=True,
    )
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reviewed_kaizens",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-entry_date", "-created_at"]
        verbose_name = "kaizen entry"
        verbose_name_plural = "kaizen entries"
        indexes = [
            models.Index(fields=["status", "-entry_date"], name="kaizen_status_date_idx"),
        ]

    def __str__(self):
        label = self.area.strip() if self.area else f"Kaizen #{self.pk}"
        return f"{label} ({self.status})"
```

- [ ] **Step 2.2: Generate the migration**

Run: `uv run python manage.py makemigrations kaizen`
Expected output mentions `Migrations for 'kaizen': core/kaizen/migrations/0001_initial.py`. Open the generated file and skim it — it should contain a `CreateModel` for `Kaizen` with all the fields above and the `kaizen_status_date_idx` index.

- [ ] **Step 2.3: Apply the migration**

Run: `uv run python manage.py migrate kaizen`
Expected: `Applying kaizen.0001_initial... OK`.

- [ ] **Step 2.4: Verify mypy + pyright still pass**

Run: `uv run mypy core/kaizen` → expected `Success: no issues found`.
Run: `uv run pyright core/kaizen` → expected `0 errors, 0 warnings`.

- [ ] **Step 2.5: Commit**

```bash
git add core/kaizen/models.py core/kaizen/migrations/0001_initial.py
git commit -m "feat(kaizen): Kaizen model + initial migration"
```

---

## Task 3 — `KaizenSerializer`

**Files:**
- Modify: `core/kaizen/serializers.py`

- [ ] **Step 3.1: Write the serializer**

Replace the contents of `core/kaizen/serializers.py` with:

```python
from rest_framework import serializers

from core.masters.models import Master
from core.masters.serializers import MasterMinSerializer
from core.serializers import UserMinSerializer

from .models import Kaizen


class KaizenSerializer(serializers.ModelSerializer):
    raised_by_detail = UserMinSerializer(source="raised_by", read_only=True)
    reviewed_by_detail = UserMinSerializer(source="reviewed_by", read_only=True)
    client_detail = MasterMinSerializer(source="client", read_only=True)
    org_uid = serializers.UUIDField(source="org.uid", read_only=True, allow_null=True)

    client = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Master.objects.filter(type="client"),
        required=True,
        allow_null=False,
    )

    class Meta:
        model = Kaizen
        fields = [
            "id",
            "uid",
            "org_uid",
            "raised_by_detail",
            "entry_date",
            "client",
            "client_detail",
            "area",
            "description",
            "takeaway",
            "status",
            "reviewed_by_detail",
            "reviewed_at",
            "rejection_reason",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "uid",
            "org_uid",
            "raised_by_detail",
            "entry_date",
            "client_detail",
            "status",
            "reviewed_by_detail",
            "reviewed_at",
            "rejection_reason",
            "created_at",
            "updated_at",
        ]
```

- [ ] **Step 3.2: Verify imports resolve**

Run: `uv run python manage.py check`
Expected: `System check identified no issues (0 silenced).`

Run: `uv run pyright core/kaizen/serializers.py`
Expected: `0 errors, 0 warnings`.

- [ ] **Step 3.3: Commit**

```bash
git add core/kaizen/serializers.py
git commit -m "feat(kaizen): KaizenSerializer with read/write FK split"
```

---

## Task 4 — `KaizenViewSet` (list / create / update / delete)

**Files:**
- Modify: `core/kaizen/views.py`

This task implements **only** the standard CRUD methods + the cross-org list behaviour. The custom `approve`/`reject` actions land in Tasks 7 and 8.

- [ ] **Step 4.1: Write the viewset**

Replace the contents of `core/kaizen/views.py` with:

```python
from typing import cast

from django.utils import timezone
from rest_framework import permissions
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.org_utils import resolve_create_org
from core.realtime import broadcast
from users.models import User

from .models import Kaizen
from .serializers import KaizenSerializer


def _raise_from_response(err):
    """Translate the (response, error) tuples returned by ``resolve_create_org``
    into the matching DRF exception so the viewset can ``raise`` instead of
    returning a Response from ``perform_create``.
    """
    exc_cls = PermissionDenied if err.status_code == 403 else ValidationError
    raise exc_cls(err.data)


class KaizenViewSet(UidLookupMixin, ModelViewSet):
    """Cross-organisation Kaizen Library.

    The list endpoint deliberately does NOT filter by ``request.user.org`` —
    every authenticated user sees every (non-rejected) Kaizen entry regardless
    of which org raised it. The ``org`` FK is stored on the row for
    traceability/reporting only. See the design spec, §2.4.
    """

    serializer_class = KaizenSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = Kaizen.objects.select_related(
            "org", "raised_by", "client", "reviewed_by"
        )

        # Optional filters
        status_param = self.request.query_params.get("status")
        client_uid = self.request.query_params.get("client_uid")
        if status_param:
            qs = qs.filter(status=status_param)
        if client_uid:
            qs = qs.filter(client__uid=client_uid)

        # Hide ``Rejected`` rows from the default list. Admins (in any org) may
        # opt back in via ``?include_rejected=1``. Applied LAST so it overrides
        # any prior ``?status=Rejected`` filter from a non-admin caller.
        include_rejected = (
            self.request.query_params.get("include_rejected") == "1"
            and user.is_admin_in_any()
        )
        if not include_rejected:
            qs = qs.exclude(status="Rejected")
        return qs

    def perform_create(self, serializer):
        org, err = resolve_create_org(self.request)
        if err is not None:
            _raise_from_response(err)
        obj = serializer.save(
            raised_by=self.request.user,
            org=org,
            entry_date=timezone.localdate(),
            status="Pending",
        )
        broadcast("kaizen", "INSERT", KaizenSerializer(obj).data)

    def perform_update(self, serializer):
        instance = cast(Kaizen, serializer.instance)
        user = cast(User, self.request.user)
        is_owner_pending = (
            instance.raised_by_id == user.pk and instance.status == "Pending"
        )
        if not (is_owner_pending or user.is_admin_in_any()):
            raise PermissionDenied(
                "Only the raiser (while Pending) or an admin can edit this entry."
            )
        obj = serializer.save()
        broadcast("kaizen", "UPDATE", KaizenSerializer(obj).data)

    def perform_destroy(self, instance):
        user = cast(User, self.request.user)
        is_owner_pending = (
            instance.raised_by_id == user.pk and instance.status == "Pending"
        )
        if not (is_owner_pending or user.is_admin_in_any()):
            raise PermissionDenied(
                "Only the raiser (while Pending) or an admin can delete this entry."
            )
        broadcast("kaizen", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()
```

- [ ] **Step 4.2: Verify imports + types**

Run: `uv run python manage.py check`
Expected: `System check identified no issues (0 silenced).`

Run: `uv run pyright core/kaizen/views.py`
Expected: `0 errors, 0 warnings`.

- [ ] **Step 4.3: Commit**

```bash
git add core/kaizen/views.py
git commit -m "feat(kaizen): KaizenViewSet with cross-org list + raiser/admin write gates"
```

---

## Task 5 — Wire up the URL router

**Files:**
- Modify: `core/kaizen/urls.py`

- [ ] **Step 5.1: Register the viewset**

Replace the contents of `core/kaizen/urls.py` with:

```python
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import KaizenViewSet

router = DefaultRouter()
router.register("kaizens", KaizenViewSet, basename="kaizen")

urlpatterns = [path("", include(router.urls))]
```

- [ ] **Step 5.2: Verify URLs resolve**

Run a quick smoke check:

```bash
uv run python manage.py shell -c "from django.urls import reverse; print(reverse('kaizen-list'))"
```

Expected output: `/api/kaizens/`.

- [ ] **Step 5.3: Commit**

```bash
git add core/kaizen/urls.py
git commit -m "feat(kaizen): register KaizenViewSet under /api/kaizens/"
```

---

## Task 6 — Django admin registration

**Files:**
- Modify: `core/kaizen/admin.py`

- [ ] **Step 6.1: Register the model in admin**

Replace the contents of `core/kaizen/admin.py` with:

```python
from django.contrib import admin

from .models import Kaizen


@admin.register(Kaizen)
class KaizenAdmin(admin.ModelAdmin):
    list_display = ["uid", "raised_by", "client", "area", "status", "entry_date"]
    list_filter = ["status"]
    search_fields = ["area", "description", "takeaway"]
    autocomplete_fields = ["raised_by", "client", "reviewed_by"]
    readonly_fields = ["uid", "created_at", "updated_at"]
    date_hierarchy = "entry_date"
```

- [ ] **Step 6.2: Verify admin loads**

Run: `uv run python manage.py check`
Expected: `System check identified no issues (0 silenced).`

- [ ] **Step 6.3: Commit**

```bash
git add core/kaizen/admin.py
git commit -m "feat(kaizen): register Kaizen in Django admin"
```

---

## Task 7 — Approve action

**Files:**
- Modify: `core/kaizen/views.py`

- [ ] **Step 7.1: Add the `approve` action**

In `core/kaizen/views.py`, add these two imports near the top (alongside the existing imports):

```python
from rest_framework.decorators import action
from rest_framework.response import Response
```

Then append this method to `KaizenViewSet` (just before the closing of the class, after `perform_destroy`):

```python
    @action(detail=True, methods=["post"], url_path="approve")
    def approve(self, request, uid=None):
        user = cast(User, request.user)
        if not user.is_admin_in_any():
            raise PermissionDenied("Admin role required to approve")
        # Use an unfiltered lookup so already-rejected/approved rows are still
        # reachable here and we can return the correct 400, not a 404.
        obj: Kaizen = get_object_or_404(Kaizen, uid=uid)
        if obj.status != "Pending":
            raise ValidationError({"detail": f"Cannot approve a {obj.status} entry"})
        obj.status = "Approved"
        obj.reviewed_by = user
        obj.reviewed_at = timezone.now()
        obj.rejection_reason = ""
        obj.save(
            update_fields=[
                "status",
                "reviewed_by",
                "reviewed_at",
                "rejection_reason",
                "updated_at",
            ]
        )
        data = KaizenSerializer(obj).data
        broadcast("kaizen", "UPDATE", data)
        return Response(data)
```

- [ ] **Step 7.2: Verify URL resolves**

```bash
uv run python manage.py shell -c "from django.urls import reverse; import uuid; print(reverse('kaizen-approve', kwargs={'uid': uuid.uuid4()}))"
```

Expected: a path like `/api/kaizens/<uuid>/approve/`.

- [ ] **Step 7.3: Commit**

```bash
git add core/kaizen/views.py
git commit -m "feat(kaizen): admin approve action"
```

---

## Task 8 — Reject action (with required reason)

**Files:**
- Modify: `core/kaizen/views.py`

- [ ] **Step 8.1: Add the `reject` action**

Append this method to `KaizenViewSet` immediately after `approve`:

```python
    @action(detail=True, methods=["post"], url_path="reject")
    def reject(self, request, uid=None):
        user = cast(User, request.user)
        if not user.is_admin_in_any():
            raise PermissionDenied("Admin role required to reject")
        reason = (request.data.get("reason") or "").strip()
        if not reason:
            raise ValidationError({"reason": ["Rejection reason is required"]})
        # Use an unfiltered lookup so already-rejected rows are still reachable
        # and we can return the correct 400, not a 404.
        obj: Kaizen = get_object_or_404(Kaizen, uid=uid)
        if obj.status != "Pending":
            raise ValidationError({"detail": f"Cannot reject a {obj.status} entry"})
        obj.status = "Rejected"
        obj.reviewed_by = user
        obj.reviewed_at = timezone.now()
        obj.rejection_reason = reason
        obj.save(
            update_fields=[
                "status",
                "reviewed_by",
                "reviewed_at",
                "rejection_reason",
                "updated_at",
            ]
        )
        data = KaizenSerializer(obj).data
        broadcast("kaizen", "UPDATE", data)
        return Response(data)
```

- [ ] **Step 8.2: Verify URL resolves**

```bash
uv run python manage.py shell -c "from django.urls import reverse; import uuid; print(reverse('kaizen-reject', kwargs={'uid': uuid.uuid4()}))"
```

Expected: a path like `/api/kaizens/<uuid>/reject/`.

Run: `uv run pyright core/kaizen/views.py`
Expected: `0 errors, 0 warnings`.

- [ ] **Step 8.3: Commit**

```bash
git add core/kaizen/views.py
git commit -m "feat(kaizen): admin reject action with required reason"
```

---

## Task 9 — Backend API tests

**Files:**
- Modify: `core/kaizen/tests.py`

- [ ] **Step 9.1: Write the tests**

Replace the contents of `core/kaizen/tests.py` with:

```python
from django.test import TestCase
from rest_framework.test import APIClient

from core.kaizen.models import Kaizen
from core.masters.models import Master
from users.models import Org, OrgMembership, User


def _make_org_user(username: str, role: str = "employee") -> tuple[Org, User]:
    org = Org.objects.create(name=f"Org-{username}")
    user = User.objects.create_user(
        username=username, password="pw", full_name=username.title()
    )
    OrgMembership.objects.create(user=user, org=org, role=role)
    return org, user


def _make_client(org: Org, name: str = "Acme") -> Master:
    m = Master.objects.create(name=name, type="client", org=org)
    m.orgs.add(org)
    return m


class KaizenCreateTests(TestCase):
    def setUp(self):
        self.org, self.user = _make_org_user("emp", role="employee")
        self.client_master = _make_client(self.org, "Acme")
        self.api = APIClient()
        self.api.force_authenticate(self.user)

    def test_create_auto_fills_raised_by_and_entry_date(self):
        resp = self.api.post(
            "/api/kaizens/",
            data={
                "client": str(self.client_master.uid),
                "area": "Internal Audit",
                "description": "details missing",
                "takeaway": "inform clients in advance",
            },
            format="json",
        )
        assert resp.status_code == 201, resp.content
        data = resp.json()
        assert data["status"] == "Pending"
        assert data["raised_by_detail"]["uid"] == str(self.user.uid)
        assert data["entry_date"]  # populated by server
        # Persisted in DB
        kz = Kaizen.objects.get(uid=data["uid"])
        assert kz.raised_by_id == self.user.pk
        assert kz.org_id == self.org.pk
        assert kz.status == "Pending"

    def test_create_requires_client(self):
        resp = self.api.post(
            "/api/kaizens/",
            data={
                "area": "Internal Audit",
                "description": "x",
                "takeaway": "y",
            },
            format="json",
        )
        assert resp.status_code == 400
        assert "client" in resp.json()


class KaizenListVisibilityTests(TestCase):
    """Cross-org visibility: a user in org A can see Kaizen entries from org B."""

    def setUp(self):
        self.org_a, self.user_a = _make_org_user("emp_a", role="employee")
        self.org_b, self.user_b = _make_org_user("emp_b", role="employee")
        self.client_a = _make_client(self.org_a, "Client-A")
        self.client_b = _make_client(self.org_b, "Client-B")

        self.kz_a = Kaizen.objects.create(
            org=self.org_a,
            raised_by=self.user_a,
            entry_date="2026-04-29",
            client=self.client_a,
            area="A",
            description="d",
            takeaway="t",
            status="Approved",
        )
        self.kz_b = Kaizen.objects.create(
            org=self.org_b,
            raised_by=self.user_b,
            entry_date="2026-04-29",
            client=self.client_b,
            area="B",
            description="d",
            takeaway="t",
            status="Approved",
        )
        self.kz_rejected = Kaizen.objects.create(
            org=self.org_b,
            raised_by=self.user_b,
            entry_date="2026-04-29",
            client=self.client_b,
            area="X",
            description="d",
            takeaway="t",
            status="Rejected",
            rejection_reason="not useful",
        )

    def test_user_in_org_a_sees_org_b_entries(self):
        api = APIClient()
        api.force_authenticate(self.user_a)
        resp = api.get("/api/kaizens/")
        assert resp.status_code == 200
        uids = {row["uid"] for row in resp.json()}
        assert str(self.kz_a.uid) in uids
        assert str(self.kz_b.uid) in uids
        # Rejected hidden by default
        assert str(self.kz_rejected.uid) not in uids

    def test_non_admin_cannot_include_rejected(self):
        api = APIClient()
        api.force_authenticate(self.user_a)
        resp = api.get("/api/kaizens/?include_rejected=1")
        assert resp.status_code == 200
        uids = {row["uid"] for row in resp.json()}
        assert str(self.kz_rejected.uid) not in uids

    def test_admin_can_include_rejected(self):
        admin = User.objects.create_user(
            username="admin_a", password="pw", full_name="Admin A"
        )
        OrgMembership.objects.create(user=admin, org=self.org_a, role="admin")
        api = APIClient()
        api.force_authenticate(admin)
        resp = api.get("/api/kaizens/?include_rejected=1")
        assert resp.status_code == 200
        uids = {row["uid"] for row in resp.json()}
        assert str(self.kz_rejected.uid) in uids

    def test_non_admin_cannot_query_rejected_via_status_filter(self):
        """Closes the ?status=Rejected bypass: non-admins should not be able
        to read rejected rows by passing the status query param either."""
        api = APIClient()
        api.force_authenticate(self.user_a)
        resp = api.get("/api/kaizens/?status=Rejected")
        assert resp.status_code == 200
        uids = {row["uid"] for row in resp.json()}
        assert str(self.kz_rejected.uid) not in uids


class KaizenEditDeleteGateTests(TestCase):
    def setUp(self):
        self.org, self.user = _make_org_user("emp", role="employee")
        self.org2, self.other_user = _make_org_user("other", role="employee")
        self.client_master = _make_client(self.org, "Acme")
        self.kz = Kaizen.objects.create(
            org=self.org,
            raised_by=self.user,
            entry_date="2026-04-29",
            client=self.client_master,
            area="A",
            description="d",
            takeaway="t",
            status="Pending",
        )

    def test_raiser_can_patch_pending(self):
        api = APIClient()
        api.force_authenticate(self.user)
        resp = api.patch(
            f"/api/kaizens/{self.kz.uid}/",
            data={"area": "Updated"},
            format="json",
        )
        assert resp.status_code == 200, resp.content
        self.kz.refresh_from_db()
        assert self.kz.area == "Updated"

    def test_raiser_cannot_patch_after_approval(self):
        self.kz.status = "Approved"
        self.kz.save(update_fields=["status"])
        api = APIClient()
        api.force_authenticate(self.user)
        resp = api.patch(
            f"/api/kaizens/{self.kz.uid}/",
            data={"area": "X"},
            format="json",
        )
        assert resp.status_code == 403

    def test_non_raiser_non_admin_cannot_patch(self):
        api = APIClient()
        api.force_authenticate(self.other_user)
        resp = api.patch(
            f"/api/kaizens/{self.kz.uid}/",
            data={"area": "X"},
            format="json",
        )
        # Either 403 or 404 is acceptable here; both prevent the write.
        assert resp.status_code in (403, 404)


class KaizenApproveRejectTests(TestCase):
    def setUp(self):
        self.org_admin, self.admin = _make_org_user("admin1", role="admin")
        self.org_emp, self.employee = _make_org_user("emp", role="employee")
        self.client_master = _make_client(self.org_emp, "Acme")
        self.kz = Kaizen.objects.create(
            org=self.org_emp,
            raised_by=self.employee,
            entry_date="2026-04-29",
            client=self.client_master,
            area="A",
            description="d",
            takeaway="t",
            status="Pending",
        )

    def test_admin_can_approve(self):
        api = APIClient()
        api.force_authenticate(self.admin)
        resp = api.post(f"/api/kaizens/{self.kz.uid}/approve/", format="json")
        assert resp.status_code == 200, resp.content
        self.kz.refresh_from_db()
        assert self.kz.status == "Approved"
        assert self.kz.reviewed_by_id == self.admin.pk
        assert self.kz.reviewed_at is not None

    def test_non_admin_cannot_approve(self):
        api = APIClient()
        api.force_authenticate(self.employee)
        resp = api.post(f"/api/kaizens/{self.kz.uid}/approve/", format="json")
        assert resp.status_code == 403

    def test_reject_requires_reason(self):
        api = APIClient()
        api.force_authenticate(self.admin)
        resp = api.post(
            f"/api/kaizens/{self.kz.uid}/reject/",
            data={},
            format="json",
        )
        assert resp.status_code == 400
        assert "reason" in resp.json()

    def test_reject_with_reason_persists_and_hides_row(self):
        api = APIClient()
        api.force_authenticate(self.admin)
        resp = api.post(
            f"/api/kaizens/{self.kz.uid}/reject/",
            data={"reason": "duplicate of existing entry"},
            format="json",
        )
        assert resp.status_code == 200, resp.content
        self.kz.refresh_from_db()
        assert self.kz.status == "Rejected"
        assert self.kz.rejection_reason == "duplicate of existing entry"

        # Default list excludes rejected even for admins...
        resp = api.get("/api/kaizens/")
        assert str(self.kz.uid) not in {row["uid"] for row in resp.json()}
        # ...unless they ask for it.
        resp = api.get("/api/kaizens/?include_rejected=1")
        assert str(self.kz.uid) in {row["uid"] for row in resp.json()}

    def test_cannot_approve_already_approved(self):
        self.kz.status = "Approved"
        self.kz.save(update_fields=["status"])
        api = APIClient()
        api.force_authenticate(self.admin)
        resp = api.post(f"/api/kaizens/{self.kz.uid}/approve/", format="json")
        assert resp.status_code == 400

    def test_cannot_reject_already_rejected(self):
        self.kz.status = "Rejected"
        self.kz.save(update_fields=["status"])
        api = APIClient()
        api.force_authenticate(self.admin)
        resp = api.post(
            f"/api/kaizens/{self.kz.uid}/reject/",
            data={"reason": "x"},
            format="json",
        )
        assert resp.status_code == 400

    def test_approve_unknown_uid_returns_404(self):
        api = APIClient()
        api.force_authenticate(self.admin)
        resp = api.post(
            "/api/kaizens/00000000-0000-0000-0000-000000000000/approve/",
            format="json",
        )
        assert resp.status_code == 404

    def test_reject_unknown_uid_returns_404(self):
        api = APIClient()
        api.force_authenticate(self.admin)
        resp = api.post(
            "/api/kaizens/00000000-0000-0000-0000-000000000000/reject/",
            data={"reason": "x"},
            format="json",
        )
        assert resp.status_code == 404
```

- [ ] **Step 9.2: Run the tests**

Run: `uv run python manage.py test core.kaizen --verbosity=2`
Expected: `Ran 17 tests in <X>s` then `OK`.

If any test fails, fix the underlying code (do **not** weaken the test) and re-run.

- [ ] **Step 9.3: Commit**

```bash
git add core/kaizen/tests.py
git commit -m "test(kaizen): API tests for create/list/edit/approve/reject"
```

---

## Task 10 — Frontend DTO types + new realtime channel

**Files:**
- Create: `frontend/task-tracker/src/types/api/kaizen.ts`
- Modify: `frontend/task-tracker/src/types/api/index.ts`, `frontend/task-tracker/src/types/api/realtime.ts`

- [ ] **Step 10.1: Create the DTO file**

Create `frontend/task-tracker/src/types/api/kaizen.ts`:

```ts
/**
 * Kaizen DTOs — mirrors `/api/kaizens/`.
 */

import type { BaseDto, IsoDate, IsoDateTime, MasterRefDto, Uid, UserRefDto } from "./common";

export type KaizenStatusValue = "Pending" | "Approved" | "Rejected";

/** Full kaizen payload returned on GET / on POST /approve / on POST /reject. */
export interface KaizenDto extends BaseDto {
  readonly org_uid: Uid | null;
  readonly raised_by_detail: UserRefDto | null;
  readonly entry_date: IsoDate;
  readonly client: Uid | null;
  readonly client_detail: MasterRefDto | null;
  readonly area: string;
  readonly description: string;
  readonly takeaway: string;
  readonly status: KaizenStatusValue;
  readonly reviewed_by_detail: UserRefDto | null;
  readonly reviewed_at: IsoDateTime | null;
  readonly rejection_reason: string;
}

/** Body for `POST /api/kaizens/`. */
export interface KaizenCreate {
  /** UID of a Master with type='client'. */
  readonly client: Uid;
  readonly area?: string;
  readonly description: string;
  readonly takeaway: string;
  /** Org uid. Required when the caller belongs to 2+ orgs; ignored when the
   *  caller has exactly one membership (the backend picks it automatically). */
  readonly org?: Uid;
}

/** Body for `PATCH /api/kaizens/<uid>/` — the raiser can fix typos while Pending. */
export type KaizenUpdate = Partial<KaizenCreate>;

/** Body for `POST /api/kaizens/<uid>/reject/`. */
export interface KaizenRejectBody {
  readonly reason: string;
}
```

- [ ] **Step 10.2: Barrel-export the new file**

Edit `frontend/task-tracker/src/types/api/index.ts` and add this line, alphabetically after `./invoice`:

```ts
export * from "./kaizen";
```

- [ ] **Step 10.3: Add the new realtime channel**

Edit `frontend/task-tracker/src/types/api/realtime.ts`. In the `RealtimeChannel` union, add `| "kaizen"` (group it near the other admin-action channels):

```ts
export type RealtimeChannel =
  // Existing in API_USAGE_GUIDE.md
  | "tasks"
  | "leads"
  | "lead-statuses"
  | "notices"
  | "invoice-plans"
  | "invoice-entries"
  // Added in docs/realtime_channels.md
  | "chat-messages"
  | "chat-members"
  | "attendance"
  | "work-logs"
  | "work-plans"
  | "employees"
  | "employee-salary"
  | "masters"
  | "orgs"
  | "holidays"
  | "app-settings"
  | "pace-goals"
  | "pace-goal-reviews"
  | "pace-meetings"
  | "pace-checklist"
  | "client-classifications"
  | "lead-history"
  | "growth-plans"
  | "client-roadmap"
  | "client-meetings"
  | "client-action-points"
  | "client-visits"
  | "visit-reports"
  | "notifications"
  | "conveyance-entries"
  | "leave"
  | "kaizen";
```

- [ ] **Step 10.4: Verify TypeScript compiles**

```bash
cd frontend/task-tracker && npx tsc --noEmit
```

Expected: no output (clean compile).

- [ ] **Step 10.5: Commit**

```bash
git add frontend/task-tracker/src/types/api/kaizen.ts \
        frontend/task-tracker/src/types/api/index.ts \
        frontend/task-tracker/src/types/api/realtime.ts
git commit -m "feat(kaizen): frontend DTO types + realtime channel"
```

---

## Task 11 — Domain types + utility module

**Files:**
- Create: `frontend/task-tracker/src/types/kaizen.ts`, `frontend/task-tracker/src/utils/kaizen.ts`
- Modify: `frontend/task-tracker/src/types/index.ts`

- [ ] **Step 11.1: Create the domain row type**

Create `frontend/task-tracker/src/types/kaizen.ts`:

```ts
import type { KaizenStatusValue } from "./api";

/** Row shape used by the Kaizen table. ``client`` is the display name;
 *  ``client_uid`` is the FK we send on save. ``raised_by`` is read-only — it's
 *  always the original creator's name. */
export interface KaizenRow {
  id: string;            // uid from API
  raised_by: string;
  raised_by_uid: string | null;
  entry_date: string;    // YYYY-MM-DD
  client: string;
  client_uid: string;    // empty string while editing a new row before pick
  area: string;
  description: string;
  takeaway: string;
  status: KaizenStatusValue;
  reviewed_by: string;
  reviewed_at: string | null;
  rejection_reason: string;
  org_uid: string | null;
}

export type { KaizenStatusValue };
```

- [ ] **Step 11.2: Add to the domain barrel**

Edit `frontend/task-tracker/src/types/index.ts`. Add this line at the end:

```ts
export * from "./kaizen";
```

- [ ] **Step 11.3: Create the utility module**

Create `frontend/task-tracker/src/utils/kaizen.ts`:

```ts
import type { KaizenRow, KaizenStatusValue } from "@/types/kaizen";
import type { KaizenDto } from "@/types/api";

export const STATUSES: KaizenStatusValue[] = [
  "Pending",
  "Approved",
  "Rejected",
];

/** Status pill colours. ``Rejected`` is included for the admin "show rejected"
 *  toggle — the default list filters those rows out. */
export const STATUS_CFG: Record<
  KaizenStatusValue,
  { color: string; bg: string; icon: string }
> = {
  Pending: { color: "#d97706", bg: "#fef3c7", icon: "🟡" },
  Approved: { color: "#16a34a", bg: "#f0fdf4", icon: "🟢" },
  Rejected: { color: "#dc2626", bg: "#fef2f2", icon: "🔴" },
};

export const BLANK_KAIZEN_ROW: KaizenRow = {
  id: "",
  raised_by: "",
  raised_by_uid: null,
  entry_date: "",
  client: "",
  client_uid: "",
  area: "",
  description: "",
  takeaway: "",
  status: "Pending",
  reviewed_by: "",
  reviewed_at: null,
  rejection_reason: "",
  org_uid: null,
};

export function dtoToKaizenRow(dto: KaizenDto): KaizenRow {
  return {
    id: dto.uid,
    raised_by: dto.raised_by_detail?.full_name ?? "",
    raised_by_uid: dto.raised_by_detail?.uid ?? null,
    entry_date: dto.entry_date,
    client: dto.client_detail?.name ?? "",
    client_uid: dto.client ?? "",
    area: dto.area,
    description: dto.description,
    takeaway: dto.takeaway,
    status: dto.status,
    reviewed_by: dto.reviewed_by_detail?.full_name ?? "",
    reviewed_at: dto.reviewed_at,
    rejection_reason: dto.rejection_reason,
    org_uid: dto.org_uid,
  };
}
```

- [ ] **Step 11.4: Verify TypeScript compiles**

```bash
cd frontend/task-tracker && npx tsc --noEmit
```

Expected: no output (clean compile).

- [ ] **Step 11.5: Commit**

```bash
git add frontend/task-tracker/src/types/kaizen.ts \
        frontend/task-tracker/src/types/index.ts \
        frontend/task-tracker/src/utils/kaizen.ts
git commit -m "feat(kaizen): KaizenRow domain type + status config + DTO mapper"
```

---

## Task 12 — Inline `EditRow` component

**Files:**
- Create: `frontend/task-tracker/src/components/kaizen/EditRow.tsx`

- [ ] **Step 12.1: Create the directory**

```bash
mkdir -p D:/TaskTracker/frontend/task-tracker/src/components/kaizen
```

- [ ] **Step 12.2: Write the component**

Create `frontend/task-tracker/src/components/kaizen/EditRow.tsx`:

```tsx
import type { CSSProperties, Dispatch, SetStateAction } from "react";
import { tdS as sharedTdS, inpS } from "@/utils/tableStyles";
import type { KaizenRow } from "@/types/kaizen";
import type { MasterItem } from "@/types";

const tdS: CSSProperties = { ...sharedTdS, verticalAlign: "top" };

export interface OrgOption {
  uid: string;
  name: string;
}

export interface KaizenEditRowProps {
  form: KaizenRow;
  setForm: Dispatch<SetStateAction<KaizenRow>>;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  isNew: boolean;
  /** Read-only display string for the Raised-By cell. On new rows this is the
   *  current user's name (the backend will set the FK). On edits it's the
   *  original raiser. */
  raisedByDisplay: string;
  /** Read-only display string for Entry Date. ``YYYY-MM-DD``. */
  entryDateDisplay: string;
  clients: MasterItem[];
  orgOptions?: OrgOption[];
  orgUid?: string;
  setOrgUid?: (uid: string) => void;
}

export default function KaizenEditRow({
  form,
  setForm,
  onSave,
  onCancel,
  saving,
  isNew,
  raisedByDisplay,
  entryDateDisplay,
  clients,
  orgOptions = [],
  orgUid = "",
  setOrgUid,
}: KaizenEditRowProps) {
  const showOrgPicker = isNew && orgOptions.length > 1 && !!setOrgUid;
  const canSave =
    !!form.client_uid &&
    !!form.description.trim() &&
    !!form.takeaway.trim() &&
    (!showOrgPicker || !!orgUid);

  return (
    <tr
      style={{
        background: isNew ? "#f0f9ff" : "#fffbeb",
        borderBottom: "2px solid #2563eb",
      }}
    >
      <td style={{ ...tdS, color: "#94a3b8", width: 36 }}>
        {isNew ? <span style={{ fontSize: 11, color: "#2563eb" }}>New</span> : "✏️"}
      </td>
      <td style={{ ...tdS, width: 130, color: "#475569" }}>{raisedByDisplay}</td>
      <td style={{ ...tdS, width: 160 }}>
        {showOrgPicker && setOrgUid && (
          <select
            style={{
              ...inpS,
              marginBottom: 4,
              borderColor: orgUid ? "#e2e8f0" : "#f59e0b",
            }}
            value={orgUid}
            onChange={(e) => setOrgUid(e.target.value)}
            title="Pick which organisation this kaizen belongs to"
          >
            <option value="">— Select Org * —</option>
            {orgOptions.map((o) => (
              <option key={o.uid} value={o.uid}>
                {o.name}
              </option>
            ))}
          </select>
        )}
        <select
          style={inpS}
          value={form.client_uid}
          onChange={(e) => {
            const uid = e.target.value;
            const match = clients.find((c) => c.id === uid);
            setForm((f) => ({
              ...f,
              client_uid: uid,
              client: match?.name ?? "",
            }));
          }}
        >
          <option value="">— Select Client * —</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </td>
      <td style={{ ...tdS, minWidth: 140 }}>
        <input
          style={inpS}
          value={form.area}
          onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))}
          placeholder="Area (e.g. Internal Audit)"
        />
      </td>
      <td style={{ ...tdS, minWidth: 220 }}>
        <textarea
          style={{ ...inpS, minHeight: 36, resize: "vertical" }}
          rows={2}
          value={form.description}
          onChange={(e) =>
            setForm((f) => ({ ...f, description: e.target.value }))
          }
          placeholder="Description *"
          autoFocus={isNew}
        />
      </td>
      <td style={{ ...tdS, minWidth: 220 }}>
        <textarea
          style={{ ...inpS, minHeight: 36, resize: "vertical" }}
          rows={2}
          value={form.takeaway}
          onChange={(e) => setForm((f) => ({ ...f, takeaway: e.target.value }))}
          placeholder="Take Away *"
        />
      </td>
      <td style={{ ...tdS, width: 110, color: "#475569" }}>{form.status}</td>
      <td style={{ ...tdS, width: 110, color: "#475569" }}>
        {entryDateDisplay}
      </td>
      <td style={{ ...tdS, whiteSpace: "nowrap", width: 110 }}>
        <button
          onClick={onSave}
          disabled={saving || !canSave}
          style={{
            padding: "5px 10px",
            background: canSave ? "#16a34a" : "#94a3b8",
            color: "#fff",
            border: "none",
            borderRadius: 5,
            cursor: canSave && !saving ? "pointer" : "not-allowed",
            fontSize: 11,
            fontWeight: 700,
            marginRight: 4,
            opacity: saving ? 0.7 : 1,
          }}
        >
          {saving ? "…" : "✓ Save"}
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: "5px 8px",
            background: "#fff",
            color: "#ef4444",
            border: "1px solid #fecaca",
            borderRadius: 5,
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          ✕
        </button>
      </td>
    </tr>
  );
}
```

- [ ] **Step 12.3: Verify TypeScript compiles**

```bash
cd frontend/task-tracker && npx tsc --noEmit
```

Expected: no output (clean compile).

- [ ] **Step 12.4: Commit**

```bash
git add frontend/task-tracker/src/components/kaizen/EditRow.tsx
git commit -m "feat(kaizen): inline EditRow component"
```

---

## Task 13 — `RejectModal` component

**Files:**
- Create: `frontend/task-tracker/src/components/kaizen/RejectModal.tsx`

- [ ] **Step 13.1: Write the modal**

Create `frontend/task-tracker/src/components/kaizen/RejectModal.tsx`:

```tsx
import { useState } from "react";

export interface RejectKaizenModalProps {
  /** Display label for the entry being rejected (used in the modal title). */
  entryLabel: string;
  onSubmit: (reason: string) => Promise<void>;
  onClose: () => void;
}

export default function RejectKaizenModal({
  entryLabel,
  onSubmit,
  onClose,
}: RejectKaizenModalProps) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const trimmed = reason.trim();
  const canSubmit = trimmed.length > 0 && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 200,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          padding: 20,
          borderRadius: 8,
          width: "min(480px, 92vw)",
          boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
        }}
      >
        <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 700 }}>
          Reject Kaizen
        </h3>
        <p style={{ margin: "0 0 12px", fontSize: 12, color: "#475569" }}>
          {entryLabel}
        </p>
        <label
          htmlFor="kaizen-reject-reason"
          style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}
        >
          Reason <span style={{ color: "#dc2626" }}>*</span>
        </label>
        <textarea
          id="kaizen-reject-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={4}
          autoFocus
          placeholder="Why is this entry being rejected? The raiser will see this."
          style={{
            display: "block",
            width: "100%",
            marginTop: 6,
            padding: 8,
            border: "1px solid #cbd5e1",
            borderRadius: 5,
            fontSize: 13,
            resize: "vertical",
          }}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 12,
          }}
        >
          <button
            onClick={onClose}
            style={{
              padding: "6px 12px",
              background: "#fff",
              color: "#334155",
              border: "1px solid #cbd5e1",
              borderRadius: 5,
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              void handleSubmit();
            }}
            disabled={!canSubmit}
            style={{
              padding: "6px 12px",
              background: canSubmit ? "#dc2626" : "#fca5a5",
              color: "#fff",
              border: "none",
              borderRadius: 5,
              cursor: canSubmit ? "pointer" : "not-allowed",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {submitting ? "…" : "Reject"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 13.2: Verify TypeScript compiles**

```bash
cd frontend/task-tracker && npx tsc --noEmit
```

Expected: no output (clean compile).

- [ ] **Step 13.3: Commit**

```bash
git add frontend/task-tracker/src/components/kaizen/RejectModal.tsx
git commit -m "feat(kaizen): RejectModal with required reason"
```

---

## Task 14 — `KaizenPage`

**Files:**
- Create: `frontend/task-tracker/src/pages/KaizenPage.tsx`

- [ ] **Step 14.1: Write the page**

Create `frontend/task-tracker/src/pages/KaizenPage.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  ws,
} from "@/lib/api";
import { thS, tdS as sharedTdS, inpS } from "@/utils/tableStyles";
import { useAuth } from "@/hooks/useAuth";
import { useMasters } from "@/hooks/useMasters";
import KaizenEditRow from "@/components/kaizen/EditRow";
import RejectKaizenModal from "@/components/kaizen/RejectModal";
import {
  BLANK_KAIZEN_ROW as BLANK,
  STATUSES,
  STATUS_CFG,
  dtoToKaizenRow as dtoToRow,
} from "@/utils/kaizen";
import type { KaizenRow, KaizenStatusValue } from "@/types/kaizen";
import type { Profile } from "@/types";
import type {
  KaizenCreate,
  KaizenDto,
  KaizenRejectBody,
  KaizenUpdate,
} from "@/types/api";

const tdS: React.CSSProperties = { ...sharedTdS, verticalAlign: "top" };

interface KaizenPageProps {
  profile: Profile | null;
  selectedOrg?: string;
}

export default function KaizenPage({
  profile,
  selectedOrg = "",
}: KaizenPageProps) {
  const { isAdminInAny, orgs } = useAuth();
  const isAdmin = isAdminInAny();
  const { clients } = useMasters();

  const [rows, setRows] = useState<KaizenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addRow, setAddRow] = useState<KaizenRow | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<KaizenRow>(BLANK);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<KaizenRow | null>(null);
  const [createOrgUid, setCreateOrgUid] = useState<string>(selectedOrg);

  const [fStatus, setFStatus] = useState<KaizenStatusValue | "">("");
  const [fClient, setFClient] = useState<string>("");
  const [fSearch, setFSearch] = useState<string>("");
  const [showRejected, setShowRejected] = useState<boolean>(false);

  const orgOptions = useMemo(
    () => orgs.map((o) => ({ uid: o.uid, name: o.name })),
    [orgs],
  );

  const todayIso = useMemo(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const dtos = await apiGet<KaizenDto[]>(
        showRejected && isAdmin ? "/kaizens/?include_rejected=1" : "/kaizens/",
      );
      setRows(dtos.map(dtoToRow));
    } finally {
      setLoading(false);
    }
  }, [showRejected, isAdmin]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Realtime subscription. Replace/insert/remove on each event.
  useEffect(() => {
    const unsubscribe = ws.subscribe<KaizenDto>("kaizen", (evt) => {
      if (evt.event === "INSERT" && evt.record) {
        const row = dtoToRow(evt.record);
        setRows((prev) => [row, ...prev.filter((r) => r.id !== row.id)]);
      } else if (evt.event === "UPDATE" && evt.record) {
        const row = dtoToRow(evt.record);
        setRows((prev) => {
          const next = prev.filter((r) => r.id !== row.id);
          // Hide rejected from non-admin or when toggle is off.
          if (row.status === "Rejected" && !(isAdmin && showRejected)) {
            return next;
          }
          return [row, ...next];
        });
      } else if (evt.event === "DELETE" && evt.record) {
        const uid = (evt.record as { uid?: string }).uid;
        if (uid) setRows((prev) => prev.filter((r) => r.id !== uid));
      }
    });
    return () => {
      unsubscribe();
    };
  }, [isAdmin, showRejected]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (fStatus && r.status !== fStatus) return false;
      if (fClient && r.client_uid !== fClient) return false;
      if (!fSearch) return true;
      const q = fSearch.toLowerCase();
      return (
        r.area.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.takeaway.toLowerCase().includes(q) ||
        r.client.toLowerCase().includes(q) ||
        r.raised_by.toLowerCase().includes(q)
      );
    });
  }, [rows, fStatus, fClient, fSearch]);

  const myName = profile?.full_name ?? "";

  const startAdd = useCallback(() => {
    setEditId(null);
    setAddRow({ ...BLANK, raised_by: myName, entry_date: todayIso });
    setCreateOrgUid(selectedOrg);
  }, [myName, todayIso, selectedOrg]);

  const cancelAdd = useCallback(() => setAddRow(null), []);

  const startEdit = useCallback((row: KaizenRow) => {
    setAddRow(null);
    setEditId(row.id);
    setEditForm(row);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditId(null);
    setEditForm(BLANK);
  }, []);

  const saveAdd = useCallback(async () => {
    if (!addRow) return;
    setSaving(true);
    try {
      const body: KaizenCreate = {
        client: addRow.client_uid,
        area: addRow.area,
        description: addRow.description,
        takeaway: addRow.takeaway,
        ...(orgOptions.length > 1 && createOrgUid
          ? { org: createOrgUid }
          : {}),
      };
      const saved = await apiPost<KaizenDto>("/kaizens/", body);
      const row = dtoToRow(saved);
      setRows((prev) => [row, ...prev.filter((r) => r.id !== row.id)]);
      setAddRow(null);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Save failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  }, [addRow, createOrgUid, orgOptions.length]);

  const saveEdit = useCallback(async () => {
    if (!editId) return;
    setSaving(true);
    try {
      const body: KaizenUpdate = {
        client: editForm.client_uid,
        area: editForm.area,
        description: editForm.description,
        takeaway: editForm.takeaway,
      };
      const saved = await apiPatch<KaizenDto>(`/kaizens/${editId}/`, body);
      const row = dtoToRow(saved);
      setRows((prev) => prev.map((r) => (r.id === row.id ? row : r)));
      cancelEdit();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Save failed: ${msg}`);
    } finally {
      setSaving(false);
    }
  }, [editId, editForm, cancelEdit]);

  const removeRow = useCallback(async (row: KaizenRow) => {
    if (!window.confirm(`Delete this Kaizen entry? "${row.area || row.id}"`))
      return;
    setDeleting(row.id);
    try {
      await apiDelete(`/kaizens/${row.id}/`);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Delete failed: ${msg}`);
    } finally {
      setDeleting(null);
    }
  }, []);

  const approve = useCallback(async (row: KaizenRow) => {
    try {
      const saved = await apiPost<KaizenDto>(`/kaizens/${row.id}/approve/`, {});
      const updated = dtoToRow(saved);
      setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Approve failed: ${msg}`);
    }
  }, []);

  const reject = useCallback(
    async (row: KaizenRow, reason: string) => {
      try {
        const body: KaizenRejectBody = { reason };
        await apiPost<KaizenDto>(`/kaizens/${row.id}/reject/`, body);
        // Remove from default list; will reappear under "Show rejected" via WS.
        if (!(isAdmin && showRejected)) {
          setRows((prev) => prev.filter((r) => r.id !== row.id));
        }
        setRejectTarget(null);
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : String(err);
        alert(`Reject failed: ${msg}`);
      }
    },
    [isAdmin, showRejected],
  );

  const canEdit = useCallback(
    (row: KaizenRow) =>
      isAdmin ||
      (row.raised_by_uid === profile?.id && row.status === "Pending"),
    [isAdmin, profile?.id],
  );

  return (
    <div style={{ padding: 16 }}>
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <input
          placeholder="Search description / takeaway…"
          value={fSearch}
          onChange={(e) => setFSearch(e.target.value)}
          style={{ ...inpS, minWidth: 220, flex: "1 1 220px" }}
        />
        <select
          value={fStatus}
          onChange={(e) => setFStatus(e.target.value as KaizenStatusValue | "")}
          style={{ ...inpS, width: 140 }}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={fClient}
          onChange={(e) => setFClient(e.target.value)}
          style={{ ...inpS, width: 180 }}
        >
          <option value="">All clients</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {isAdmin && (
          <label style={{ fontSize: 12, color: "#475569", whiteSpace: "nowrap" }}>
            <input
              type="checkbox"
              checked={showRejected}
              onChange={(e) => setShowRejected(e.target.checked)}
              style={{ marginRight: 4 }}
            />
            Show rejected
          </label>
        )}
        <button
          onClick={startAdd}
          style={{
            marginLeft: "auto",
            padding: "6px 12px",
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 5,
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          + New Kaizen
        </button>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f1f5f9" }}>
              <th style={{ ...thS, width: 36 }}>#</th>
              <th style={{ ...thS, width: 130 }}>Raised By</th>
              <th style={{ ...thS, width: 160 }}>Client</th>
              <th style={{ ...thS, minWidth: 140 }}>Area</th>
              <th style={{ ...thS, minWidth: 220 }}>Description</th>
              <th style={{ ...thS, minWidth: 220 }}>Take Away</th>
              <th style={{ ...thS, width: 110 }}>Status</th>
              <th style={{ ...thS, width: 110 }}>Entry Date</th>
              <th style={{ ...thS, width: 160 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {addRow && (
              <KaizenEditRow
                form={addRow}
                setForm={
                  setAddRow as React.Dispatch<
                    React.SetStateAction<KaizenRow>
                  >
                }
                onSave={() => {
                  void saveAdd();
                }}
                onCancel={cancelAdd}
                saving={saving}
                isNew
                raisedByDisplay={myName}
                entryDateDisplay={todayIso}
                clients={clients}
                orgOptions={orgOptions}
                orgUid={createOrgUid}
                setOrgUid={setCreateOrgUid}
              />
            )}

            {loading ? (
              <tr>
                <td colSpan={9} style={{ ...tdS, textAlign: "center" }}>
                  Loading…
                </td>
              </tr>
            ) : filtered.length === 0 && !addRow ? (
              <tr>
                <td
                  colSpan={9}
                  style={{ ...tdS, textAlign: "center", color: "#94a3b8" }}
                >
                  No Kaizen entries yet.
                </td>
              </tr>
            ) : (
              filtered.map((row, idx) =>
                editId === row.id ? (
                  <KaizenEditRow
                    key={row.id}
                    form={editForm}
                    setForm={setEditForm}
                    onSave={() => {
                      void saveEdit();
                    }}
                    onCancel={cancelEdit}
                    saving={saving}
                    isNew={false}
                    raisedByDisplay={row.raised_by}
                    entryDateDisplay={row.entry_date}
                    clients={clients}
                  />
                ) : (
                  <tr key={row.id}>
                    <td style={tdS}>{idx + 1}</td>
                    <td style={tdS}>{row.raised_by}</td>
                    <td style={tdS}>{row.client}</td>
                    <td style={tdS}>{row.area}</td>
                    <td style={{ ...tdS, whiteSpace: "pre-wrap" }}>
                      {row.description}
                    </td>
                    <td style={{ ...tdS, whiteSpace: "pre-wrap" }}>
                      {row.takeaway}
                    </td>
                    <td style={tdS}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 700,
                          color: STATUS_CFG[row.status].color,
                          background: STATUS_CFG[row.status].bg,
                        }}
                      >
                        {STATUS_CFG[row.status].icon} {row.status}
                      </span>
                      {row.status === "Rejected" && row.rejection_reason && (
                        <div
                          style={{
                            fontSize: 11,
                            color: "#94a3b8",
                            marginTop: 4,
                          }}
                          title={row.rejection_reason}
                        >
                          Reason: {row.rejection_reason}
                        </div>
                      )}
                    </td>
                    <td style={tdS}>{row.entry_date}</td>
                    <td style={{ ...tdS, whiteSpace: "nowrap" }}>
                      {canEdit(row) && (
                        <button
                          onClick={() => startEdit(row)}
                          style={{
                            padding: "4px 8px",
                            background: "#fff",
                            color: "#2563eb",
                            border: "1px solid #bfdbfe",
                            borderRadius: 5,
                            cursor: "pointer",
                            fontSize: 11,
                            marginRight: 4,
                          }}
                        >
                          Edit
                        </button>
                      )}
                      {canEdit(row) && (
                        <button
                          onClick={() => {
                            void removeRow(row);
                          }}
                          disabled={deleting === row.id}
                          style={{
                            padding: "4px 8px",
                            background: "#fff",
                            color: "#dc2626",
                            border: "1px solid #fecaca",
                            borderRadius: 5,
                            cursor: "pointer",
                            fontSize: 11,
                            marginRight: 4,
                          }}
                        >
                          {deleting === row.id ? "…" : "Delete"}
                        </button>
                      )}
                      {isAdmin && row.status === "Pending" && (
                        <>
                          <button
                            onClick={() => {
                              void approve(row);
                            }}
                            style={{
                              padding: "4px 8px",
                              background: "#16a34a",
                              color: "#fff",
                              border: "none",
                              borderRadius: 5,
                              cursor: "pointer",
                              fontSize: 11,
                              fontWeight: 700,
                              marginRight: 4,
                            }}
                          >
                            ✓ Approve
                          </button>
                          <button
                            onClick={() => setRejectTarget(row)}
                            style={{
                              padding: "4px 8px",
                              background: "#fff",
                              color: "#dc2626",
                              border: "1px solid #fecaca",
                              borderRadius: 5,
                              cursor: "pointer",
                              fontSize: 11,
                              fontWeight: 700,
                            }}
                          >
                            ✕ Reject
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ),
              )
            )}
          </tbody>
        </table>
      </div>

      {rejectTarget && (
        <RejectKaizenModal
          entryLabel={`${rejectTarget.client} — ${rejectTarget.area || "(no area)"}`}
          onSubmit={(reason) => reject(rejectTarget, reason)}
          onClose={() => setRejectTarget(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 14.2: Verify TypeScript compiles**

```bash
cd frontend/task-tracker && npx tsc --noEmit
```

Expected: no output (clean compile).

- [ ] **Step 14.3: Commit**

```bash
git add frontend/task-tracker/src/pages/KaizenPage.tsx
git commit -m "feat(kaizen): KaizenPage with filters, inline edit, approve/reject"
```

---

## Task 15 — `useKaizenPendingBadge` hook

**Files:**
- Create: `frontend/task-tracker/src/hooks/useKaizenPendingBadge.ts`

- [ ] **Step 15.1: Write the hook**

Create `frontend/task-tracker/src/hooks/useKaizenPendingBadge.ts`:

```ts
import { useEffect, useState } from "react";
import { apiGet, ws } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import type { KaizenDto } from "@/types/api";

/**
 * Live count of Pending Kaizen entries for the NavMenu badge. Returns 0 for
 * non-admins (they don't see the approval queue, so no badge). Mirrors the
 * shape of useLeadsBadgeCount.
 */
export function useKaizenPendingBadge(): number {
  const { isAdminInAny } = useAuth();
  const isAdmin = isAdminInAny();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!isAdmin) {
      setCount(0);
      return;
    }
    let cancelled = false;

    const refresh = async () => {
      try {
        const dtos = await apiGet<KaizenDto[]>("/kaizens/?status=Pending");
        if (!cancelled) setCount(dtos.length);
      } catch {
        if (!cancelled) setCount(0);
      }
    };

    void refresh();

    const unsub = ws.subscribe<KaizenDto>("kaizen", () => {
      void refresh();
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [isAdmin]);

  return count;
}
```

- [ ] **Step 15.2: Verify TypeScript compiles**

```bash
cd frontend/task-tracker && npx tsc --noEmit
```

Expected: no output (clean compile).

- [ ] **Step 15.3: Commit**

```bash
git add frontend/task-tracker/src/hooks/useKaizenPendingBadge.ts
git commit -m "feat(kaizen): useKaizenPendingBadge hook (admin only)"
```

---

## Task 16 — Wire navigation, icon, view, and badge

**Files:**
- Modify: `frontend/task-tracker/src/App.tsx`, `frontend/task-tracker/src/components/layout/Header.tsx`, `frontend/task-tracker/src/components/header/NavMenu.tsx`

- [ ] **Step 16.1: Add the icon to Header**

Open `frontend/task-tracker/src/components/layout/Header.tsx`. Find the `growthplan` icon block (around line 424) and **append a new `kaizen` entry to the same `icons` object**, right after the `growthplan: ( ... )` block. Use a simple "lightbulb" SVG since Kaizen is about ideas/lessons:

```tsx
    kaizen: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <path d="M9 18h6" />
        <path d="M10 22h4" />
        <path d="M12 2a7 7 0 00-4 12.74V17h8v-2.26A7 7 0 0012 2z" />
      </svg>
    ),
```

- [ ] **Step 16.2: Thread `kaizenBadgeCount` through Header**

In the same file, find the `interface HeaderProps` block (lines 29-58 area) and add this field next to `leadsBadgeCount`:

```ts
  kaizenBadgeCount?: number;
```

Find the `Header` function signature (around line 60) and add `kaizenBadgeCount` to the destructured props. Also find the JSX that renders `<NavMenu .../>` (around line 679) and add the new prop:

```tsx
<NavMenu
  // ...existing props...
  clientsBadgeCount={clientsBadgeCount}
  leadsBadgeCount={leadsBadgeCount}
  kaizenBadgeCount={kaizenBadgeCount}
  icons={icons}
  // ...
/>
```

(If the existing `Header` has a `_unused` underscore-prefix on a destructured prop, leave that alone — just add the new one alongside the others.)

- [ ] **Step 16.3: Add the Kaizen tab to NavMenu**

Open `frontend/task-tracker/src/components/header/NavMenu.tsx`. In `interface NavMenuProps`, add:

```ts
  kaizenBadgeCount?: number;
```

Add `kaizenBadgeCount` to the destructured props at the top of `NavMenu`.

In the `NAV_TABS_RAW` array, add a `kaizen` entry. Visible to **all users** (no access flag) — place it after the `growthplan` line:

```ts
      ...(isAdmin
        ? [{ id: "growthplan", label: "Growth Plan", icon: icons.growthplan }]
        : []),
      { id: "kaizen", label: "Kaizen", icon: icons.kaizen },
      ...(isAdmin ? [{ id: "users", label: "Users", icon: icons.users }] : []),
```

**Note:** the `useMemo` dependency array on line 91 currently lists `[tabOrder, icons, hasNoticeAccess, hasInvoiceAccess, hasMastersAccess, canAccessLeads, canAccessClients, isAdmin]`. The `kaizen` tab depends on none of those (it's always rendered) — leave the deps unchanged.

In the `<SortableTab .../>` JSX inside the return, extend the `badge` prop expression to include kaizen:

```tsx
              badge={
                tab.id === "clients"
                  ? clientsBadgeCount
                  : tab.id === "leads"
                    ? leadsBadgeCount
                    : tab.id === "kaizen"
                      ? kaizenBadgeCount
                      : undefined
              }
```

- [ ] **Step 16.4: Lazy-import the page in App.tsx**

Open `frontend/task-tracker/src/App.tsx`. Add the lazy import alongside the other lazy page imports (around line 22-38):

```tsx
const KaizenPage = lazy(() => import("./pages/KaizenPage"));
```

Add the new hook import alongside the other badge hooks (around line 50-51):

```tsx
import { useKaizenPendingBadge } from "@/hooks/useKaizenPendingBadge";
```

- [ ] **Step 16.5: Wire the badge + view**

Inside `TaskApp()`, after `const leadsBadge = useLeadsBadgeCount();` (around line 123), add:

```tsx
  const kaizenBadge = useKaizenPendingBadge();
```

Add a new key `kaizen` to `VIEW_MAP` (around line 316). It's visible to everyone — no access guard:

```tsx
    kaizen: (
      <KaizenPage profile={profile} selectedOrg={selectedOrg} />
    ),
```

Pass the badge to `<Header>` (around line 430-431):

```tsx
        clientsBadgeCount={clientsBadge.total}
        leadsBadgeCount={leadsBadge}
        kaizenBadgeCount={kaizenBadge}
```

- [ ] **Step 16.6: Verify TypeScript + lint**

```bash
cd frontend/task-tracker && npx tsc --noEmit
```

Expected: no output (clean compile).

```bash
cd frontend/task-tracker && npm run lint
```

Expected: clean lint exit (no errors).

- [ ] **Step 16.7: Commit**

```bash
git add frontend/task-tracker/src/App.tsx \
        frontend/task-tracker/src/components/layout/Header.tsx \
        frontend/task-tracker/src/components/header/NavMenu.tsx
git commit -m "feat(kaizen): nav tab, icon, view route, admin pending badge"
```

---

## Task 17 — End-to-end smoke check

This is a manual verification — no new code.

- [ ] **Step 17.1: Run the backend and frontend**

In two terminals:

```bash
# Terminal 1
uv run python manage.py runserver

# Terminal 2
cd frontend/task-tracker && npm run dev
```

Open `http://localhost:5173` and sign in.

- [ ] **Step 17.2: Verify the tab is visible to non-admins**

Sign in as a regular employee. Confirm the **Kaizen** tab appears in the nav, click it, and confirm an empty list renders with a `+ New Kaizen` button.

- [ ] **Step 17.3: Create an entry**

Click **+ New Kaizen**. Fill **Client / Area / Description / Take Away**. Confirm:

- The Raised By cell auto-fills with your name.
- The Entry Date cell auto-fills with today.
- After Save, the row appears with status `Pending` (amber pill).

- [ ] **Step 17.4: Approve and reject as admin**

Sign in as an admin (or open a private window with an admin user). Confirm:

- The Kaizen tab shows a **red badge** with the pending count.
- Each Pending row shows **Approve** and **Reject** buttons.
- Approve flips the status to `Approved` instantly.
- Reject opens the modal, requires a non-empty reason, and removes the row from the default list.
- Toggling **Show rejected** brings the rejected row back, with the reason rendered under the status pill.

- [ ] **Step 17.5: Verify cross-org visibility**

If you have multiple orgs configured: sign in as a user in **org B** and confirm the entries created in **org A** appear in the list. (No setup is needed if your dev seed already has multiple orgs.)

- [ ] **Step 17.6: Run the full pre-commit gate**

```bash
uv run pre-commit run --all-files
```

Expected: every hook passes (Ruff, mypy, pyright, Django check, ESLint, tsc).

If a hook fails, fix the issue and re-run — never use `--no-verify`.

- [ ] **Step 17.7: Final commit (only if Step 17.6 caused fixups)**

If pre-commit auto-fixed any formatting:

```bash
git add -u
git commit -m "chore(kaizen): formatting fixups from pre-commit"
```

---

## Self-Review Checklist (run before handoff)

I (the plan author) ran the following checks against the spec:

- [x] **Spec §2.1 (open to all employees)** — Task 4 viewset uses only `IsAuthenticated`; Task 16 adds the nav tab without an access flag.
- [x] **Spec §2.2 (admin approval)** — Tasks 7 & 8 gate on `is_admin_in_any()`.
- [x] **Spec §2.3 (status visibility)** — Task 4 `get_queryset` excludes Rejected by default; admins can opt in.
- [x] **Spec §2.4 (cross-org visibility)** — Task 4 deliberately omits any `org_id__in` filter; Task 9 covers this in `KaizenListVisibilityTests`.
- [x] **Spec §2.5 (auto-populated fields)** — Task 4 `perform_create` sets `raised_by`, `entry_date`, `org`, `status`. Task 3 marks them `read_only`.
- [x] **Spec §2.6 (raiser-editable while Pending)** — Task 4 `perform_update` / `perform_destroy` enforce the gate; Task 9 verifies it.
- [x] **Spec §2.7 (required reason on reject)** — Task 8 raises `ValidationError({"reason": "Rejection reason is required"})`; Task 9 verifies; Task 13 frontend modal disables Submit until reason is non-empty.
- [x] **Spec §4.7 (realtime channel "kaizen")** — broadcast emitted in Tasks 4/7/8; channel union extended in Task 10.
- [x] **Spec §5.5 (navigation wiring, all users)** — Task 16 adds the tab unconditionally.
- [x] **No placeholders** — every code block is concrete, every command has expected output. `growthplan: ( ... )` in Step 16.1 is a navigation marker (existing code), not a placeholder.
- [x] **Type consistency** — `KaizenStatusValue` defined in Task 10 is the only status union; reused in Tasks 11, 12, 14, 15. `KaizenRow.id` is the `uid` string everywhere. `BLANK_KAIZEN_ROW` (Task 11) is consumed by `KaizenPage` (Task 14) under the alias `BLANK`.
