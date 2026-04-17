# TaskTracker — Backend Development Guide

The full development contract for contributing to the Django backend. Human or AI — same rules.

Frontend-specific conventions live in [`frontend/task-tracker/README.md`](./frontend/task-tracker/README.md) and [`frontend/task-tracker/docs/DEVELOPMENT.md`](./frontend/task-tracker/docs/DEVELOPMENT.md). Do not duplicate those rules here.

For environment setup, tech stack overview, and the canonical backend patterns (models, serializers, views, admin, file uploads, realtime), see [`README.md`](./README.md). This document extends the README — it does not replace it.

---

## Table of contents

1. [Architectural principles](#1-architectural-principles)
2. [The backend feature workflow](#2-the-backend-feature-workflow)
3. [Models — detailed rules](#3-models--detailed-rules)
4. [Serializers — detailed rules](#4-serializers--detailed-rules)
5. [ViewSets — detailed rules](#5-viewsets--detailed-rules)
6. [Permissions and multi-tenancy](#6-permissions-and-multi-tenancy)
7. [File uploads, signed URLs, storage](#7-file-uploads-signed-urls-storage)
8. [Realtime (Channels) — broadcasting](#8-realtime-channels--broadcasting)
9. [Audit logging](#9-audit-logging)
10. [Query performance](#10-query-performance)
11. [Migrations — safety rules](#11-migrations--safety-rules)
12. [Testing](#12-testing)
13. [Observability and debugging](#13-observability-and-debugging)
14. [Security checklist (per endpoint)](#14-security-checklist-per-endpoint)
15. [Pre-PR gate](#15-pre-pr-gate)
16. [Common anti-patterns](#16-common-anti-patterns)
17. [Commit and PR hygiene](#17-commit-and-pr-hygiene)
18. [Deployment checklist](#18-deployment-checklist)
19. [For AI agents](#19-for-ai-agents)

---

## 1. Architectural principles

### 1.1 One source of truth per concept

Every cross-cutting concern has exactly one implementation. Reusing it is the rule; re-implementing it is a review-time reject.

| Concern | Canonical location |
|---|---|
| Role-based permissions | `core/permissions.py` (`IsAdmin`, `IsAdminOrManager`, `IsAdminOrReadOnly`) |
| Lightweight user payload | `core.serializers.UserMinSerializer` |
| Lightweight master payload | `core.masters.serializers.MasterMinSerializer` |
| Multi-tenant write guard | `core.serializers.OrgScopedMixin` |
| Timestamp base | `core.base.TimeStampedModel` |
| Pagination | `core.pagination.StandardPagination`, `core.pagination.LargePagination` |
| Signed file URLs | `core.filestore.signed_url.file_url` |
| Upload path helpers | `core.filestore.validators.*_upload_to` |
| Upload validation | `core.filestore.validators.validate_upload` |
| Realtime broadcast | `core.realtime.broadcast` |
| Audit logging | `core.audit.models.log` |

If you find yourself writing something that sounds like the left column, grep the right column first.

### 1.2 Every app mirrors the same skeleton

```
core/<app>/
├── __init__.py
├── apps.py
├── models.py
├── serializers.py
├── views.py
├── urls.py
├── admin.py
└── tests.py
```

No other layout is acceptable. No `managers.py`, `selectors.py`, `services/` subfolders, or `utils/` inside app directories — put helpers alongside the thing they support, or in `core/` if they're cross-app.

### 1.3 Multi-tenancy is the default

Every queryset filters by `request.user.org`. Every create sets `org = request.user.org`. Every writable `org` field uses `OrgScopedMixin`. All three — no exceptions. The canonical reference is [`core/tasks/views.py`](./core/tasks/views.py).

Known tenancy gaps (deferred until a second tenant goes live) are enumerated in [`README.md` → Known multi-tenancy caveats](./README.md#known-multi-tenancy-caveats). Do not introduce new ones.

### 1.4 UIDs, not IDs, over the wire

Integer `id` is an internal primary key. External references always use `uid` (UUID): API payloads, WebSocket events, URL params, frontend state. Every model has `uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)`.

### 1.5 Use the framework

DRF already provides list/create/retrieve/update/destroy via `ModelViewSet`. It provides pagination, filtering, permissions, authentication. Don't roll your own. `@action` for the rare custom endpoint.

### 1.6 Fail closed

- Default `permission_classes` to the most restrictive level that works. Prefer `IsAdmin` over `IsAdminOrManager` over `IsAuthenticated`.
- Deny cross-tenant writes via `OrgScopedMixin`, not by trusting the payload.
- No endpoint is `AllowAny` except `core/filestore/views.py::ServeFileView` (where the JWT in `?token=` is the auth) and the login endpoint.

---

## 2. The backend feature workflow

The only supported order for shipping a backend feature. Skipping or reordering steps produces broken builds, N+1 queries, unlogged changes, and cross-tenant leaks.

1. **Model** — add/update in `core/<app>/models.py`. Inherit `TimeStampedModel`, add `uid`, add `Meta` (with `verbose_name`, `verbose_name_plural`, `ordering`), add `__str__`.
2. **Migration** — `uv run python manage.py makemigrations <app>`. Open the file, verify it matches what you expect, commit it alongside the model change.
3. **Serializer** — read FKs via `_detail` nested serializer; write via `SlugRelatedField(slug_field="uid")`. Mark `uid`, timestamps, and `_detail` fields `read_only`. Inherit `OrgScopedMixin` if `org` is writable.
4. **ViewSet** — `get_queryset` filters by tenant + role, uses `select_related` for every FK the serializer expands. `perform_create` sets `created_by`/`user` and `org` from `request.user`.
5. **URL** — register on the app's `DefaultRouter`. Include the app's urls module from `config/urls.py`, never hand-register a view.
6. **Admin** — register with `@admin.register`. `list_display`, `search_fields`, `list_filter`, `readonly_fields=["uid","created_at","updated_at"]`.
7. **Realtime** — if the frontend should see the change instantly (kanban updates, chat, leads), call `broadcast(channel, event, serialized)` in `perform_create`/`perform_update`/`perform_destroy`.
8. **Audit** — if the action is sensitive (deletes, exports, permission grants, admin overrides, data imports), call `core.audit.models.log(...)`.
9. **API docs** — update [`API_USAGE_GUIDE.md`](./API_USAGE_GUIDE.md) with request/response shape and query params. If the contract isn't in that file, the frontend can't rely on it.
10. **Tests** — add at least three `APITestCase` tests per new endpoint: happy path, permission denial (403/401), cross-tenant isolation (an authenticated user from Org B sees zero rows).

---

## 3. Models — detailed rules

### 3.1 Required fields on every model

```python
import uuid
from django.db import models
from core.base import TimeStampedModel

class Thing(TimeStampedModel):
    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    name = models.CharField(max_length=255)

    class Meta:
        ordering = ["name"]
        verbose_name = "thing"
        verbose_name_plural = "things"

    def __str__(self) -> str:
        return self.name
```

### 3.2 Foreign keys

- To another core app: use a **string reference** (`"masters.Master"`) to avoid import cycles.
- To the user model: **always** `settings.AUTH_USER_MODEL`, never `from users.models import User`.
- `on_delete`: default to `PROTECT` for references you can't lose (clients, orgs); `SET_NULL` with `null=True, blank=True` for audit-like FKs (`created_by`); `CASCADE` only for true parent-child ownership (TaskLog belongs to Task).
- `related_name` must be **unique project-wide**. Prefix with the model name: `related_name="task_logs"`, not `"logs"`.

### 3.3 Field-level rules

- `CharField` always has `max_length`.
- `DateTimeField(auto_now_add=True)` / `auto_now=True` only on fields **not** covered by `TimeStampedModel`. Prefer `TimeStampedModel`.
- Money: `DecimalField(max_digits=12, decimal_places=2)`. Never `FloatField`.
- Booleans have explicit `default=False` / `default=True`.
- Nullable strings: `null=True, blank=True` is *almost always wrong*. Prefer `blank=True, default=""` so there's a single empty representation.
- Add `db_index=True` on any field you filter or order by.

### 3.4 Constraints

Use `Meta.constraints` with `UniqueConstraint`, not `unique_together`. `UniqueConstraint` supports conditional (`condition=Q(...)`) uniqueness, which is needed for nullable-tenant rows.

```python
class Meta:
    constraints = [
        models.UniqueConstraint(
            fields=["org", "name"],
            name="unique_thing_name_per_org",
        ),
    ]
```

### 3.5 Validators

Put regex/format validators on the field, not in the serializer. Reuse `core/validators.py` (Aadhaar/PAN/IFSC etc.) where they exist.

---

## 4. Serializers — detailed rules

### 4.1 Read-vs-write FK pattern

The standard used everywhere:

```python
from core.serializers import UserMinSerializer
from core.masters.models import Master
from core.masters.serializers import MasterMinSerializer

class ThingSerializer(serializers.ModelSerializer):
    client_detail = MasterMinSerializer(source="client", read_only=True)
    created_by_detail = UserMinSerializer(source="created_by", read_only=True)

    client = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Master.objects.filter(type="client"),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = Thing
        fields = [
            "id", "uid", "name",
            "client", "client_detail",
            "created_by_detail",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "uid", "client_detail", "created_by_detail",
            "created_at", "updated_at",
        ]
```

Write accepts `client: "<uid>"`. Read returns `client: "<uid>"` *and* `client_detail: {uid, name, ...}`.

### 4.2 OrgScopedMixin

Any serializer exposing a writable `org` field **must** inherit `OrgScopedMixin`:

```python
from core.serializers import OrgScopedMixin

class ThingSerializer(OrgScopedMixin, serializers.ModelSerializer):
    org = serializers.SlugRelatedField(slug_field="uid", queryset=Org.objects.all(), ...)
```

The mixin rejects any `org` UID that doesn't match `request.user.org`. This is the cross-tenant write guard.

### 4.3 Computed fields

Use `serializers.SerializerMethodField` for derived values. Name the method `get_<field>`. Keep it cheap — no DB queries inside a method field without annotating the queryset first.

### 4.4 File fields

Return signed URLs via `file_url()`:

```python
from core.filestore.signed_url import file_url

class ThingSerializer(serializers.ModelSerializer):
    attachment_url = serializers.SerializerMethodField()

    def get_attachment_url(self, obj):
        return file_url(obj.attachment, request=self.context.get("request"))
```

Do not return `obj.attachment.url` directly.

### 4.5 Validation

Field-level: `validate_<field>(self, value)`. Cross-field: `validate(self, attrs)`. Raise `serializers.ValidationError({"field": "message"})`. Never raise a bare `ValueError`.

---

## 5. ViewSets — detailed rules

### 5.1 The canonical shape

```python
from typing import cast

from rest_framework import permissions
from rest_framework.viewsets import ModelViewSet

from core.pagination import StandardPagination
from core.permissions import IsAdmin, IsAdminOrManager
from users.models import User

from .models import Thing
from .serializers import ThingSerializer

class ThingViewSet(ModelViewSet):
    serializer_class = ThingSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = StandardPagination

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = (
            Thing.objects
            .select_related("client", "org", "created_by")
            .filter(org=user.org)
        )

        client_uid = self.request.query_params.get("client_uid")
        if client_uid:
            qs = qs.filter(client__uid=client_uid)

        if user.role == "admin":
            return qs
        if user.role == "manager":
            sub_ids = list(user.subordinates.values_list("id", flat=True))
            sub_ids.append(user.id)
            return qs.filter(responsible_id__in=sub_ids)
        return qs.filter(responsible=user)

    def perform_create(self, serializer):
        user = cast(User, self.request.user)
        serializer.save(created_by=user, org=user.org)
```

### 5.2 Rules

- Always `select_related`/`prefetch_related` for every FK/M2M the serializer expands. No exceptions.
- Always include `org` in `select_related` when the serializer exposes it.
- Always `cast(User, self.request.user)` so type checkers can resolve `.role`, `.org`, `.subordinates`, `.id`.
- `perform_create` / `perform_update` / `perform_destroy` are the **only** places you set `org`, `created_by`, `user`. Never accept them from the payload.
- Import `IsAdmin`, `IsAdminOrManager` from `core.permissions`. Do not redefine.

### 5.3 Custom actions

```python
from rest_framework.decorators import action
from rest_framework.response import Response

@action(detail=False, methods=["post"], url_path="bulk_create")
def bulk_create(self, request):
    ...
    return Response(data, status=201)
```

Rules:
- `url_path` matches the final URL segment. Prefer `snake_case` for multi-word paths.
- Custom actions still obey tenant scoping — reuse `self.get_queryset()` or filter by `request.user.org` explicitly.
- Destructive bulk actions write an `AuditLog` entry and are throttled.

### 5.4 Pagination

Every list endpoint returns a paginated response. `StandardPagination` (page size 25) for user-facing lists; `LargePagination` (page size 200) for admin/export views. Never return an unbounded list.

### 5.5 Filtering

Accept `?<field>_uid=<uid>` for FK filters; `?<field>=<value>` for scalar filters; `?search=<q>` for text search across predefined fields. Put filter logic in `get_queryset`. Don't pull in `django-filter` unless the filter surface justifies it.

---

## 6. Permissions and multi-tenancy

### 6.1 Role model

Every user has `role ∈ {"admin", "manager", "employee"}`. Visibility rules:

- **admin**: entire tenant (`org`).
- **manager**: self + direct reports (`user.subordinates`).
- **employee**: self only.

Apply via `get_queryset` filter, not by checking `request.user.role` in serializer methods.

### 6.2 Access flags

Module-level access (Invoice, Notice, Masters, Attendance, Employee) is a per-user boolean flag on `User`. Gate by adding a check in `get_permissions` or a custom permission class:

```python
class HasInvoiceAccess(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.invoice_access)
```

Every access flag has a companion `*_granted_by` + `*_granted_at` pair updated on change — this is the audit trail. When you add a new access flag, include the audit pair in the same migration.

### 6.3 Cross-tenant writes

The *only* defense is `OrgScopedMixin`. There is no signal, no middleware, no admin safeguard. If a serializer exposes a writable `org` field and doesn't inherit the mixin, an admin of Org A can PATCH a row into Org B. Review every new serializer for this.

### 6.4 Endpoint-level tenant scoping

Admin endpoints (`/api/users/...`, `/api/orgs/...`, `delete_all` on tasks/masters) are tenant-scoped even for admins. An admin of Org A cannot list, modify, or delete users/orgs/rows from Org B. Preserve this when adding admin endpoints.

---

## 7. File uploads, signed URLs, storage

### 7.1 Storage is pluggable

`FILE_STORAGE_BACKEND=local` (dev default) signs the storage name with `SECRET_KEY` and returns `/api/files/serve/?token=<jwt>`. The JWT expires after `FILE_SIGNED_URL_TTL` seconds (default 300s).

`FILE_STORAGE_BACKEND=s3` delegates to `default_storage.url(name)`, which django-storages returns as a presigned S3 URL. No call-site changes needed — configure django-storages and switch the env var.

### 7.2 upload_to must be hashed

Never let a user-supplied filename hit disk. Use the helpers in `core/filestore/validators.py`:

```python
from core.filestore.validators import invoice_upload_to

class InvoiceEntry(models.Model):
    file = models.FileField(upload_to=invoice_upload_to, null=True, blank=True)
```

The helpers route to `<subdir>/YYYY/MM/<uuid>.<ext>`, preventing path traversal, filename collisions, and predictable-URL enumeration. For a new file type, add a matching helper next to the existing ones — do not inline.

### 7.3 Always return signed URLs

```python
from core.filestore.signed_url import file_url

class MySerializer(serializers.ModelSerializer):
    attachment_url = serializers.SerializerMethodField()

    def get_attachment_url(self, obj):
        return file_url(obj.attachment, request=self.context.get("request"))
```

Never return `obj.file.url` directly. Never cache or log signed URLs.

### 7.4 Validation

All uploads pass through `validate_upload` — MIME allow-list + 20 MB cap. Reject with `serializers.ValidationError` on failure.

### 7.5 SECRET_KEY rotation

Rotating `SECRET_KEY` invalidates every outstanding signed URL and every JWT in flight. Coordinate with ops; clients will re-login. Never rotate during peak traffic.

---

## 8. Realtime (Channels) — broadcasting

### 8.1 When to broadcast

Broadcast any DB mutation the frontend should reflect instantly without a refetch: kanban updates, lead movements, invoice approvals, new chat messages.

Do **not** broadcast:
- Read-only endpoints (lists, detail views).
- High-volume writes where eventual consistency is fine (audit logs, analytics events).
- Sensitive admin-only mutations not surfaced in real-time UI.

### 8.2 The call

```python
from core.realtime import broadcast

def perform_create(self, serializer):
    user = cast(User, self.request.user)
    obj = serializer.save(created_by=user, org=user.org)
    broadcast("things", "INSERT", ThingSerializer(obj, context={"request": self.request}).data)

def perform_update(self, serializer):
    obj = serializer.save()
    broadcast("things", "UPDATE", ThingSerializer(obj, context={"request": self.request}).data)

def perform_destroy(self, instance):
    uid = str(instance.uid)
    instance.delete()
    broadcast("things", "DELETE", {"uid": uid})
```

Rules:
- Channel names are plain strings (`"tasks"`, `"leads"`, `"chat-messages"`) — keep them short and consistent with the frontend's `ws.subscribe<TDto>(channel, ...)` call sites.
- Always pass `context={"request": request}` so signed file URLs resolve correctly in the broadcast payload.
- `DELETE` events ship only the `uid`, not the full object.

### 8.3 The consumer

Fan-out lives in [`core/chat/consumers.py::RealtimeConsumer`](./core/chat/consumers.py). Don't add ad-hoc consumers per feature — extend the existing one if needed.

---

## 9. Audit logging

### 9.1 When to log

Log anything that would matter in an incident review:

- Deletes (single and bulk).
- Backup export / restore.
- Permission grants and revocations.
- Admin overrides of protected fields.
- Data imports.
- Password resets (for another user).

Do not log routine reads or noisy mutations (task status flips, worklog updates) — the append-only task log already covers those.

### 9.2 The call

```python
from core.audit.models import log as audit_log

audit_log(
    actor=request.user,
    org=request.user.org,
    action="export_backup",
    resource_type="tasks",
    resource_id=str(obj.uid),
    changes={"status": ["pending", "completed"]},
    ip_address=request.META.get("REMOTE_ADDR"),
)
```

### 9.3 Reading the log

`GET /api/audit-logs/` — admin-only, tenant-scoped, paginated. Never expose a write endpoint for `AuditLog`.

---

## 10. Query performance

### 10.1 N+1 is a review-time reject

Every FK the serializer expands → `select_related`. Every reverse or M2M relation → `prefetch_related`. Don't merge these — they do different things.

Verify in the shell:

```python
from django.db import connection
from django.test.utils import CaptureQueriesContext
with CaptureQueriesContext(connection) as ctx:
    list(ThingViewSet().get_queryset())
    for q in ctx.captured_queries:
        print(q["sql"])
```

### 10.2 Index every filtered/ordered field

- `db_index=True` on scalar filters.
- `Meta.indexes = [models.Index(fields=["org", "status", "-created_at"])]` for composite queries.
- FK columns are indexed automatically; don't double-index.

### 10.3 Restrict columns

`Queryset.only("uid", "name")` on list endpoints where full objects aren't needed. `values()` / `values_list()` for aggregations.

### 10.4 Count carefully

`qs.count()` hits the DB each call. Cache the result if you use it more than once. `len(qs)` materialises the queryset — only use when you'd iterate anyway.

### 10.5 Pagination is mandatory

Every list returns paginated results via `StandardPagination` or `LargePagination`. Even admin endpoints. Unbounded lists leak memory and produce 30-second responses once a tenant grows.

---

## 11. Migrations — safety rules

### 11.1 Initial migrations are locked

The `0001_initial` and `0002_initial` migrations across every `core/*` app were regenerated from scratch during the Supabase → Django cutover. They are safe on a **fresh database only**. Never re-apply to a populated database.

For staging/prod cutovers, run `supabase_migration/` end-to-end into a fresh DB and promote. Don't `--fake-initial` against production.

### 11.2 Writing new migrations

```bash
uv run python manage.py makemigrations <app>
```

Open the generated file. Read it. Check it matches what you expect. Commit it alongside the model change in the same commit.

Never hand-edit an applied migration. If you need to change it, write a new migration that corrects course.

### 11.3 Data migrations

Schema changes go in one migration; data migrations go in a separate migration with `RunPython(forward, reverse)`. Always provide the reverse — `migrations.RunPython.noop` is acceptable only when a reverse is genuinely impossible (and that's rare).

Never reference a Master by name inside a data migration — use `apps.get_model(...)` and filter by stable fields (UIDs, unique codes).

### 11.4 Reviewing migrations

Before committing:

- Does it touch a table with >1M rows? Add `concurrently=True` to indexes (PostgreSQL) or plan a maintenance window.
- Does it drop a column? Stage the rollout: stop writes → migrate → deploy code that stops reads → drop in a later migration.
- Does it add a non-nullable column without a default? Split into two migrations: add nullable → backfill → make non-nullable.

---

## 12. Testing

### 12.1 The per-endpoint minimum

Three `APITestCase`s. No exceptions:

1. **Happy path** — authenticated user creates/reads/updates/deletes and gets the expected status + payload shape.
2. **Auth denial** — unauthenticated → 401; authenticated but wrong role → 403.
3. **Cross-tenant isolation** — an authenticated user from Org B, calling the same endpoint, sees zero rows from Org A (or gets 404 when fetching an Org A resource by UID).

```python
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

class ThingAPITests(APITestCase):
    def setUp(self):
        self.org_a = Org.objects.create(name="A")
        self.org_b = Org.objects.create(name="B")
        self.admin_a = User.objects.create_user(
            email="admin_a@test.com", password="pw", role="admin", org=self.org_a,
        )
        self.admin_b = User.objects.create_user(
            email="admin_b@test.com", password="pw", role="admin", org=self.org_b,
        )
        self.thing_a = Thing.objects.create(name="A-thing", org=self.org_a)

    def test_happy_path(self):
        self.client.force_authenticate(self.admin_a)
        resp = self.client.get(reverse("thing-list"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp.data["results"]), 1)

    def test_auth_denial(self):
        resp = self.client.get(reverse("thing-list"))
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_cross_tenant_isolation(self):
        self.client.force_authenticate(self.admin_b)
        resp = self.client.get(reverse("thing-list"))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(resp.data["count"], 0)
```

### 12.2 Test data

Prefer real DB writes over mocks. SQLite in-memory is fast enough. If you must mock, mock the external boundary (S3, Redis, SMTP), never the ORM.

### 12.3 Regression tests

Every bug fix commit **must** include a test that:

- Fails on the pre-fix version.
- Passes on the post-fix version.

No exceptions. "Too hard to reproduce" means you haven't understood the bug yet.

### 12.4 Test timestamps

Don't assert on exact `created_at` / `updated_at` values — use `assertIsNotNone` or `assertGreater(obj.updated_at, start_time)`. Clock jitter otherwise produces flaky tests.

### 12.5 Running the suite

```bash
uv run python manage.py test                    # all tests
uv run python manage.py test core.tasks         # one app
uv run python manage.py test core.tasks.tests.ThingAPITests.test_happy_path
```

---

## 13. Observability and debugging

### 13.1 Logging

Use `logging.getLogger(__name__)`. Never `print()`. The default Django logger writes to stdout.

```python
import logging
log = logging.getLogger(__name__)

log.info("Exported %d rows for org=%s", count, org.uid)
log.warning("Signed URL for %s rejected — bad token", storage_name)
```

Never log:
- Secrets, tokens, signed URLs.
- Raw request bodies (may contain PII).
- User passwords, even hashed.

### 13.2 Admin as the debugger

Every model is registered in Django Admin. Use it before dropping into `shell`. It's faster and safer, and the tenant filters are applied.

### 13.3 Shell

```bash
uv run python manage.py shell
```

For an auto-imported shell with every model available, install `django-extensions` and use `shell_plus`.

### 13.4 SQL inspection

```bash
uv run python manage.py dbshell              # direct SQL
```

In Python:

```python
print(qs.query)                              # the SQL for a queryset
from django.db import connection
print(connection.queries[-5:])               # last 5 queries (DEBUG=True only)
```

### 13.5 WebSocket debugging

The consumer logs subscribe/unsubscribe. For channel-layer traffic:

```bash
redis-cli monitor
```

### 13.6 Signed-URL failures

Almost always `SECRET_KEY` rotation or clock skew (`exp` in the JWT). Check both before digging deeper.

### 13.7 Migration state

```bash
uv run python manage.py showmigrations       # what's applied
uv run python manage.py sqlmigrate <app> 0003  # SQL for a migration without running it
```

---

## 14. Security checklist (per endpoint)

Before you ship a new endpoint, every box checks:

- [ ] `permission_classes` set explicitly — never rely on a framework default.
- [ ] `get_queryset` filters by `request.user.org` for tenant-scoped resources.
- [ ] `perform_create` sets `org`, `created_by`, or `user` from `request.user` — never from payload.
- [ ] Writable `org` or `user` fields use `OrgScopedMixin` or reject mismatches in `validate()`.
- [ ] Every `FileField` uses a hashed `upload_to` helper and returns URLs via `file_url()`.
- [ ] Every destructive bulk action (`delete_all`, `bulk_*`, exports, restores) is throttled **and** writes an `AuditLog` entry.
- [ ] No secrets, tokens, signed URLs, or PII land in logs.
- [ ] Error responses use DRF's standard shape (`{field: [errors]}` or `{"error": "..."}`). Don't leak stack traces, SQL, or internal identifiers.
- [ ] Query param inputs validated before use in `filter()` (prevents ORM-injection-via-typo and keeps 500s from malformed UUIDs).
- [ ] Rate limits set for anything that takes an auth secret (login, password reset, token refresh).

---

## 15. Pre-PR gate

Run all of these locally. All must exit 0. Do not use `--no-verify`.

```bash
# Python
uv run ruff check .
uv run ruff format --check .
uv run python manage.py check
uv run mypy .
uv run pyright .
uv run python manage.py test

# Frontend
cd frontend/task-tracker
npm run lint
npm test
npm run build
```

If pre-commit hooks were ever skipped on the branch: `uv run pre-commit run --all-files`.

Expected output for each: zero warnings, zero errors, all tests pass, build succeeds. Anything else is blocking.

---

## 16. Common anti-patterns

Every item here has been rejected in review on this repo at least once.

- Importing from a deleted umbrella module: `from core.models import ...`, `from core.serializers import *`. Always import from the specific app.
- Redefining `IsAdmin` / `IsAdminOrManager` / `UserMinSerializer` / `MasterMinSerializer` per app.
- `Optional[X]` / `Union[X, Y]`. Use `X | None` / `X | Y`.
- Accepting `org`, `created_by`, or `user` from the request body.
- Returning `obj.file.url` directly.
- `except Exception:` to swallow errors. Catch the specific class, or don't catch.
- Migrations that depend on runtime data via model methods. Use `apps.get_model(...)` and stable fields only.
- `# type: ignore` / `# noqa` without a justification on the same line.
- Comments that restate the code, mark removals (`# removed X`, `# was: foo`), or reference the task/issue that triggered the change.
- `@deprecated` markers or re-export shims to "keep old imports working". If a symbol is dead, delete it; if it's alive, don't rename it mid-change.
- Leaving `print()` debugging in committed code.
- Adding a dependency without updating `pyproject.toml` and running `uv sync`.
- Hand-editing an applied migration.
- Returning an unbounded list from a list endpoint.
- `select_related` or `prefetch_related` missing from a queryset whose serializer expands the relation.

---

## 17. Commit and PR hygiene

### 17.1 Commit messages

Imperative, present tense. One concern per commit.

Good:
- `Add attendance filter by date range`
- `Fix worklog visibility for managers without subordinates`
- `Reject cross-tenant org writes on invoice serializer`

Bad:
- `Added feature` (not imperative)
- `Various fixes` (multiple concerns)
- `Fix for task #123` (reference belongs in the PR body, not the subject)

### 17.2 Scope

A bug fix fixes the bug. It does not refactor surrounding code, rename variables, or tidy unrelated files. Split cleanups into separate commits (or, better, separate PRs).

### 17.3 Before pushing

- Pre-PR gate (§15) passes.
- Every commit is atomic and has a clear message.
- No `WIP`, `fixup`, or merge-commit noise — rebase and squash locally.
- No secrets committed. Check `.env`, migration files, fixtures, and logs.
- Migration files committed alongside the model change.

---

## 18. Deployment checklist

Before promoting a build to a new environment, every box checks:

- [ ] `DEBUG=False` in the target environment.
- [ ] `SECRET_KEY` rotated and stored in the secrets manager — **not** in `.env`.
- [ ] `ALLOWED_HOSTS` pinned to real hostnames.
- [ ] `CORS_ALLOWED_ORIGINS` pinned to the actual frontend origin.
- [ ] `DATABASE_URL` points at PostgreSQL.
- [ ] Migrations applied to the target DB **before** traffic is routed.
- [ ] `REDIS_URL` reachable from the ASGI process (WebSocket layer depends on it).
- [ ] `FILE_STORAGE_BACKEND=s3` with a valid bucket and IAM role (unless explicitly local).
- [ ] `FILE_SIGNED_URL_TTL` set appropriately (300s is a sane default).
- [ ] Static files collected: `uv run python manage.py collectstatic --noinput`.
- [ ] Frontend built (`cd frontend/task-tracker && npm run build`) and `dist/` deployed alongside Django.
- [ ] `seed_initial_data` run **only** on fresh installs — never against an upgrade.
- [ ] Backup export tested from an admin account (dry-run with `?counts_only=true`).
- [ ] Admin login verified with a non-seeded account before declaring success.
- [ ] Rollback plan written down: which commit reverts, which migrations reverse, who approves.

---

## 19. For AI agents

You are a contributor. You follow every rule above, plus:

### 19.1 Read before you write

Grep for existing helpers before creating new ones. If `UserMinSerializer`, `broadcast`, `file_url`, `OrgScopedMixin`, or `IsAdmin` already exists, use it. Reinventing any of these will be reverted.

### 19.2 Scope discipline

A bug fix fixes the bug. It does not refactor surrounding code, rename variables, add features, or tidy unrelated files. If you notice something worth changing, note it and ask — do not bundle it.

### 19.3 No silent assumptions

If the task is ambiguous — which tenant, which role, what status values, which field — ask. Do not guess and proceed. A clarifying question is cheap; a wrong patch is expensive.

### 19.4 Verify against the repo, not from memory

Before recommending a function or flag, confirm it exists on the current branch. Grep. Read the file. Stale memory is the top source of wrong patches.

### 19.5 Run the pre-PR gate before declaring done

"It should work" is not done. "All checks in §15 exit 0, and the new test covers the change" is done. If you can't run a check in your environment, say so explicitly — do not assume it would pass.

### 19.6 Don't write documentation files unless asked

Update this file or the relevant module docstring instead. Never create `NOTES.md`, `PLAN.md`, `CHANGES.md`, `ANALYSIS.md` or similar in the repo root unless the user asks for it.

### 19.7 Respect the migration lockdown

Never re-apply `0001_initial` / `0002_initial` against a populated database. Never auto-generate migrations during a debugging session and leave them uncommitted. Always read a generated migration before committing.

### 19.8 Follow the comment-and-rename feedback memory

- No `@deprecated` markers or legacy aliases.
- No comments referencing the current task, fix, or issue.
- No "what the code does" comments — only "why, and only if non-obvious".
- Keep comments sparse. If removing a comment wouldn't confuse a future reader, don't write it.
