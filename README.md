# TaskTracker

A Django + React task management platform for accounting teams. The backend exposes a REST API consumed by the React frontend.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Project Structure](#project-structure)
3. [Getting Started](#getting-started)
4. [Development Workflow](#development-workflow)
5. [Backend Guide](#backend-guide)
   - [App Structure](#app-structure)
   - [Models](#models)
   - [Serializers](#serializers)
   - [Views](#views)
   - [URLs](#urls)
   - [Admin](#admin)
   - [File Uploads & Signed URLs](#file-uploads--signed-urls)
   - [Realtime Broadcasts](#realtime-broadcasts)
   - [Adding a New App](#adding-a-new-app)
6. [Code Style](#code-style)
7. [Apps Overview](#apps-overview)
8. [Security Notes](#security-notes)
9. [Frontend](#frontend)
10. [API Reference](#api-reference)
11. [Development Guide](#development-guide)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Django 6, Django REST Framework, SimpleJWT |
| Frontend | React 19, TypeScript, Vite, React Compiler |
| Realtime | Django Channels + channels-redis (WebSocket) |
| File serving | Django storage abstraction + JWT-signed URLs (S3-ready) |
| Database | SQLite (dev) / PostgreSQL (prod) |
| Python package manager | `uv` |
| Frontend package manager | `npm` |
| Python linting | Ruff (lint + format) |
| Python type-checking | mypy + django-stubs (plugin), pyright (Pylance parity) |
| Frontend linting | ESLint, TypeScript strict mode |
| Frontend testing | Vitest |
| Pre-commit hooks | Ruff, ESLint, tsc, Django system check |

---

## Project Structure

```
TaskTracker/
├── config/                        # Django project config
│   ├── settings.py
│   ├── urls.py                    # Root URL conf — includes all app URLs
│   ├── wsgi.py
│   └── management/
│       └── commands/
│           └── seed_initial_data.py
│
├── core/                          # Shared base + all domain apps
│   ├── __init__.py
│   ├── base.py                    # TimeStampedModel abstract base
│   ├── permissions.py             # Shared IsAdmin / IsAdminOrManager
│   ├── pagination.py              # StandardPagination / LargePagination
│   ├── realtime.py                # broadcast() helper for Channels groups
│   ├── serializers.py             # UserMinSerializer + OrgScopedMixin
│   ├── filestore/                 # JWT-signed file URLs + ServeFileView + upload_to helpers
│   ├── attendance/
│   ├── audit/                     # AuditLog model + read-only admin API
│   ├── backup/                    # Full-tenant export / restore (admin)
│   ├── chat/
│   ├── employees/
│   ├── growth/
│   ├── holidays/
│   ├── invoices/
│   ├── leads/
│   ├── masters/
│   ├── notices/
│   ├── pace/
│   ├── settings_app/
│   ├── tasks/
│   └── worklog/
│
├── users/                         # Custom user model + Org + JWT auth
│
├── frontend/
│   └── task-tracker/              # React + Vite app
│       └── src/
│           ├── components/        # Page and shared UI components
│           ├── contexts/          # React context providers
│           ├── consts/            # UI constants (labels, colours, options)
│           ├── types/             # TypeScript type definitions
│           ├── utils/             # API helpers and domain utilities
│           ├── data/              # Static seed/reference data
│           └── lib/
│
├── scripts/                       # Pre-commit hook scripts
├── manage.py
├── pyproject.toml                 # Python deps + Ruff config
└── .pre-commit-config.yaml
```

---

## Getting Started

### Prerequisites

- Python 3.14+
- Node.js 18+
- `uv` — Python package manager ([install](https://docs.astral.sh/uv/getting-started/installation/))

### 1. Clone and enter the project

```bash
git clone <repo-url>
cd TaskTracker
```

### 2. Set up the Python environment

```bash
uv sync
```

### 3. Configure environment variables

Create a `.env` file in the project root:

```env
SECRET_KEY=<generate — see below>
DEBUG=True
DATABASE_URL=sqlite:///db.sqlite3
ALLOWED_HOSTS=localhost,127.0.0.1
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
REDIS_URL=redis://localhost:6379       # only required if you use the WebSocket layer
FILE_STORAGE_BACKEND=local             # "local" (default) or "s3"
FILE_SIGNED_URL_TTL=300                # seconds a signed file URL is valid
UPLOAD_DIR=uploads                     # MEDIA_ROOT, relative to project root
```

See [`.env.example`](./.env.example) for the canonical list — all three file-storage vars are required; the defaults above reflect what `config/settings.py` expects.

**Generate a `SECRET_KEY`** — never ship the repo placeholder to any environment. It also signs file-serving JWTs, so rotating it invalidates every outstanding signed URL:

```bash
uv run python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
```

For production, set `DEBUG=False`, rotate `SECRET_KEY` out-of-band (environment / secrets manager — not `.env` committed to git), and pin `ALLOWED_HOSTS` to real hostnames.

### 4. Run database migrations

```bash
uv run python manage.py migrate
```

> **⚠ Migration lockdown.** The `0001_initial` / `0002_initial` migrations across every `core/*` app were regenerated from scratch during the Supabase → Django cutover (see [`supabase_migration/`](./supabase_migration/)). They are safe on a **fresh database** only. Never re-apply them against a database that already holds production data: `migrate --fake-initial` or a fresh `migrate` on a populated schema will either fail on duplicate FKs or silently mark migrations applied without schema convergence. For staging/prod cutovers, run `supabase_migration/` end-to-end into a fresh DB and promote, rather than re-running initial migrations.

### 5. Seed initial data

```bash
# Seed users, masters, lead statuses, app settings
uv run python manage.py seed_initial_data

# Also seed 20 sample tasks
uv run python manage.py seed_initial_data --tasks

# Re-seed even if data already exists
uv run python manage.py seed_initial_data --force

# Wipe tasks then re-seed them
uv run python manage.py seed_initial_data --tasks --clear
```

Default admin credentials after seeding:
- **Email:** `safycosting@gmail.com`
- **Password:** `Admin123`

Default team member password: `123456`

### 6. Start the backend

```bash
uv run python manage.py runserver
```

Backend: `http://localhost:8000` | Django Admin: `http://localhost:8000/admin/`

### 7. Set up and start the frontend

```bash
cd frontend/task-tracker
npm install
npm run dev
```

Frontend dev server: `http://localhost:5173`

Vite proxies all `/api` requests to `http://127.0.0.1:8000` automatically.

### 8. Build frontend for Django to serve (optional)

```bash
cd frontend/task-tracker
npm run build
```

WhiteNoise serves the built app from `frontend/task-tracker/dist/`. The full app is then available at `http://localhost:8000`.

---

## Development Workflow

### Running both servers

Open two terminals:

```bash
# Terminal 1 — backend
uv run python manage.py runserver

# Terminal 2 — frontend
cd frontend/task-tracker && npm run dev
```

Open `http://localhost:5173` in your browser.

### Install pre-commit hooks

```bash
uv run pre-commit install
```

Hooks run automatically on every commit: Ruff lint/format, Django system check, ESLint, TypeScript type check, trailing whitespace, line endings.

### Run checks manually

```bash
# Python
uv run ruff check .
uv run ruff format .
uv run python manage.py check
uv run mypy .                          # type-check with django-stubs plugin
uv run pyright .                       # same rules the VS Code Pylance extension uses

# Frontend
cd frontend/task-tracker
npm run lint      # ESLint
npm run test      # Vitest unit tests
npm run build     # tsc + Vite build (catches type errors)
```

mypy and pyright are configured in `pyproject.toml`. mypy uses the django-stubs mypy plugin (resolves `.objects`, queryset transforms, FK `<name>_id` descriptors); pyright sees the same stubs but without the plugin, so a narrow `[tool.pyright]` block disables `reportIncompatibleVariableOverride` for the idiomatic custom-Manager and inner-Meta patterns.

### After changing models

```bash
# Generate and apply migrations
uv run python manage.py makemigrations <app_label>
uv run python manage.py migrate
```

---

## Backend Guide

### App Structure

Every domain app under `core/` follows this exact structure — no exceptions:

```
core/<appname>/
├── __init__.py
├── apps.py
├── models.py
├── serializers.py
├── views.py
├── urls.py
├── admin.py
└── tests.py
```

---

### Models

**Always inherit `TimeStampedModel`** for any model that needs `created_at` / `updated_at`:

```python
from core.base import TimeStampedModel

class MyModel(TimeStampedModel):
    ...
```

**Every model must have:**
- A `uid` UUID field (for external references — never expose integer `id` to the frontend)
- A `__str__` method
- A `Meta` class with `verbose_name`, `verbose_name_plural`, and `ordering`

```python
import uuid
from django.db import models
from core.base import TimeStampedModel

class MyModel(TimeStampedModel):
    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    name = models.CharField(max_length=255)

    class Meta:
        ordering = ["name"]
        verbose_name = "my model"
        verbose_name_plural = "my models"

    def __str__(self):
        return self.name
```

**FK to other core apps** — use string references to avoid circular imports:

```python
# Good
client = models.ForeignKey("masters.Master", ...)

# Bad
from core.masters.models import Master
client = models.ForeignKey(Master, ...)
```

**FK to User** — always use `settings.AUTH_USER_MODEL`:

```python
from django.conf import settings

created_by = models.ForeignKey(
    settings.AUTH_USER_MODEL,
    null=True, blank=True,
    on_delete=models.SET_NULL,
    related_name="my_model_records",
)
```

**Never reuse `related_name`** across models — each must be unique project-wide.

---

### Serializers

**Read vs write FK pattern** — this is the standard used everywhere:

- **Write** (POST/PATCH): accept a `uid` via `SlugRelatedField`
- **Read** (GET): return a nested `_detail` object via a nested serializer

```python
from core.masters.models import Master
from core.masters.serializers import MasterMinSerializer
from core.serializers import UserMinSerializer

class MySerializer(serializers.ModelSerializer):
    # Read-only nested expansion
    client_detail = MasterMinSerializer(source="client", read_only=True)
    created_by_detail = UserMinSerializer(source="created_by", read_only=True)

    # Writable FK — accepts uid string
    client = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Master.objects.filter(type="client"),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = MyModel
        fields = [
            "id", "uid", "name",
            "client", "client_detail",
            "created_by_detail",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "uid", "client_detail", "created_by_detail", "created_at", "updated_at"]
```

**Shared serializers** — do not duplicate `UserMinSerializer`. Import it:

```python
from core.serializers import UserMinSerializer
```

**`MasterMinSerializer`** is the canonical lightweight Master representation. Import it from `core.masters.serializers` wherever you need a nested master.

**Multi-tenant write safety** — any serializer that exposes a writable `org` field must inherit `OrgScopedMixin` so callers can't POST/PATCH a row into another tenant:

```python
from core.serializers import OrgScopedMixin, UserMinSerializer

class MySerializer(OrgScopedMixin, serializers.ModelSerializer):
    org = serializers.SlugRelatedField(slug_field="uid", queryset=Org.objects.all(), ...)
```

The mixin adds a `validate_org` that rejects any UID not matching `request.user.org`.

---

### Views

All views use `ModelViewSet`. Follow this exact pattern:

```python
from typing import cast

from rest_framework import permissions
from rest_framework.viewsets import ModelViewSet

from users.models import User

from .models import MyModel
from .serializers import MyModelSerializer

class MyModelViewSet(ModelViewSet):
    serializer_class = MyModelSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        # IsAuthenticated guarantees request.user is a User at runtime;
        # cast narrows the `User | AnonymousUser` union so type-checkers
        # accept access to `.role`, `.subordinates`, etc.
        user = cast(User, self.request.user)
        role = user.role
        qs = MyModel.objects.select_related("client", "org", "created_by")

        # Apply query param filters
        client_uid = self.request.query_params.get("client_uid")
        if client_uid:
            qs = qs.filter(client__uid=client_uid)

        # Apply role-based visibility
        if role == "admin":
            return qs
        if role == "manager":
            subordinate_ids = list(user.subordinates.values_list("id", flat=True))
            subordinate_ids.append(user.id)
            return qs.filter(responsible_id__in=subordinate_ids)
        return qs.filter(responsible=user)

    def perform_create(self, serializer):
        serializer.save(created_by=cast(User, self.request.user))
```

**Rules:**
- Always call `select_related` / `prefetch_related` in `get_queryset` — never leave N+1 queries. Include `org` whenever your serializer exposes it.
- Always set `created_by` (or `user`) in `perform_create`, never accept it from the client
- Import role-based permissions from `core.permissions` — do **not** redefine `IsAdmin` or `IsAdminOrManager` per app
- Cast `self.request.user` to `User` so pyright/mypy can resolve `.role`, `.subordinates`, and `.id`

```python
from core.permissions import IsAdmin, IsAdminOrManager
```

**Custom actions** use `@action`:

```python
from rest_framework.decorators import action
from rest_framework.response import Response

@action(detail=False, methods=["post"], url_path="bulk_create")
def bulk_create(self, request):
    ...
```

---

### URLs

Each app registers its ViewSets with a DRF `DefaultRouter` and exposes a single `urlpatterns`:

```python
from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import MyModelViewSet

router = DefaultRouter()
router.register("my_models", MyModelViewSet, basename="mymodel")

urlpatterns = [path("", include(router.urls))]
```

Then include it in `config/urls.py`:

```python
path("api/", include("core.myapp.urls")),
```

**Do not** add the app URLs to `core/urls.py` — that file no longer exists. All includes go directly in `config/urls.py`.

---

### Admin

Every model must be registered in `admin.py`. Use `@admin.register`, always define `list_display`, `search_fields`, and mark `uid`/timestamps as `readonly_fields`:

```python
from django.contrib import admin
from .models import MyModel

@admin.register(MyModel)
class MyModelAdmin(admin.ModelAdmin):
    list_display = ["uid", "name", "created_at"]
    list_filter = ["status"]
    search_fields = ["name"]
    readonly_fields = ["uid", "created_at", "updated_at"]
```

Use `TabularInline` for child models (e.g. `TaskLog` inside `TaskAdmin`).

---

### File Uploads & Signed URLs

Uploaded files (invoice PDFs, chat attachments, employee address proofs) are stored through Django's `FileField`, which delegates to the configured `default_storage`. We never expose `FileField.url` directly — instead, serializers return a JWT-signed URL via `core.filestore.signed_url.file_url(...)`:

**`upload_to` must be hashed.** Never let a user-supplied filename land on disk — use one of the helpers from `core.filestore.validators` (or add a module-level function next to them):

```python
from core.filestore.validators import invoice_upload_to

class InvoiceEntry(...):
    file = models.FileField(upload_to=invoice_upload_to, null=True, blank=True)
```

These helpers route uploads to `<subdir>/YYYY/MM/<uuid>.<ext>`, which prevents path traversal, filename collisions, and predictable-URL leaks. New `FileField`s should follow the same pattern.


```python
from core.filestore.signed_url import file_url

class MySerializer(serializers.ModelSerializer):
    attachment_url = serializers.SerializerMethodField()

    def get_attachment_url(self, obj):
        return file_url(obj.attachment, request=self.context.get("request"))
```

- `FILE_STORAGE_BACKEND=local` (default) → signs the storage name with `SECRET_KEY`, returns `/api/files/serve/?token=<jwt>`. Tokens expire after `FILE_SIGNED_URL_TTL` seconds.
- `FILE_STORAGE_BACKEND=s3` → delegates to `default_storage.url(name)`, which django-storages already returns as a presigned S3 URL. No call-site changes needed — switch the setting and configure django-storages.

The serving endpoint lives at `core/filestore/views.py::ServeFileView` (registered at `/api/files/serve/`) and deliberately uses `AllowAny` — the signed token is the auth.

---

### Realtime Broadcasts

For DB mutations that the frontend should see instantly (tasks, leads, notices, invoices), call `broadcast()` from `core/realtime.py` in `perform_create` / `perform_update` / `perform_destroy`:

```python
from core.realtime import broadcast

def perform_create(self, serializer):
    obj = serializer.save(created_by=self.request.user)
    broadcast("leads", "INSERT", LeadSerializer(obj).data)
```

The Channels consumer in `core/chat/consumers.py` fans events out to subscribed WebSocket clients. Channel names are simple strings (e.g. `"leads"`, `"lead-statuses"`, `"invoice-entries"`).

---

### Adding a New App

1. Create the app folder:

```bash
mkdir core/myapp
touch core/myapp/__init__.py core/myapp/models.py core/myapp/serializers.py
touch core/myapp/views.py core/myapp/urls.py core/myapp/admin.py core/myapp/tests.py
```

> **Note:** `config` is listed in `INSTALLED_APPS` so Django discovers the `seed_initial_data` management command inside `config/management/commands/`. This is the standard way to register project-level management commands.

2. Create `core/myapp/apps.py`:

```python
from django.apps import AppConfig

class MyappConfig(AppConfig):
    name = "core.myapp"
```

3. Register in `config/settings.py` `INSTALLED_APPS`:

```python
"core.myapp",
```

4. Include in `config/urls.py`:

```python
path("api/", include("core.myapp.urls")),
```

5. Generate and apply migrations:

```bash
uv run python manage.py makemigrations myapp
uv run python manage.py migrate
```

---

## Security Notes

- **`SECRET_KEY`** signs JWT access/refresh tokens *and* the filestore signed-URL JWTs. Rotation invalidates outstanding tokens and file links; rotate out-of-band and plan for short client-side re-logins. Never commit a real key.
- **Multi-tenancy** — every viewset filters `get_queryset()` by `request.user.org`, every `perform_create` sets `org` from `request.user`, and every writable `org`-bearing serializer inherits `OrgScopedMixin`. Together these stop cross-tenant reads, stop cross-tenant writes via the `org` field, and default new rows to the caller's tenant. When you add an app, follow all three — the pattern in `core/tasks/views.py` is the canonical reference.
- **Admin endpoints are org-scoped.** User CRUD (`/api/users/...`) and `/api/orgs/` restrict an admin to their own tenant — an admin of Org A cannot list, edit, or delete users or orgs belonging to Org B. `delete_all` on `tasks` and `masters` deletes only the caller's tenant rows.
- **Role-based permissions** — admin-only endpoints use `core.permissions.IsAdmin`; admin-or-manager endpoints use `IsAdminOrManager`. Do not re-implement these per app.
- **File serving** is `AllowAny` by design — the short-lived HS256-signed JWT in the `?token=` query string is the auth. TTL defaults to 300s (`FILE_SIGNED_URL_TTL`). Do not log or cache these URLs in shared channels.
- **File uploads** hash user-supplied filenames via module-level helpers in `core.filestore.validators` (`employee_address_proof_upload_to`, `chat_upload_to`, `invoice_upload_to`). MIME allow-listing + 20 MB cap live in `validate_upload`.
- **Backup export** (`GET /api/backup/`) is admin-scoped and throttled 5/hr. It materialises the whole tenant state in memory, so it refuses exports over 200k rows with `413`; preflight with `?counts_only=true` and narrow with `?resources=tasks,worklog,…`.
- **Audit trail** — mutations that matter (backup export/restore, sensitive admin actions) call `core.audit.models.log(...)`. Read via `GET /api/audit-logs/` (admin-only, org-scoped, paginated).
- **Migrations** — `0001_initial` / `0002_initial` are single-shot Supabase-cutover artefacts. Never re-apply to a populated database.

### Known multi-tenancy caveats

A handful of uniqueness constraints still span all tenants and should be widened to include `org` before a second tenant goes live (requires a migration, so deferred):

- `core.holidays.Holiday.date` — global `unique=True`; should be `unique_together = (org, date)`.
- `core.masters.Master.unique_together = (type, name, org)` — Django treats `NULL != NULL`, so rows with `org=NULL` can duplicate. Once you stop seeding with `org=None`, swap to a partial index.
- `core.leads.LeadStatus.name` — globally unique; status rows are currently shared across all tenants by design (seeded once at install).

---

## Frontend

The React + Vite + TypeScript frontend lives in [`frontend/task-tracker/`](./frontend/task-tracker/) and is maintained as its own subproject with its own docs.

See [`frontend/task-tracker/README.md`](./frontend/task-tracker/README.md) for folder layout, the `apiFetch` / `apiGet` / `apiPost` helpers, type-naming rules, and the steps for adding a new feature.

---

## Code Style

### Python

- **Line length:** 120 characters (enforced by Ruff)
- **Import order:** stdlib → third-party → local, each group separated by a blank line (enforced by Ruff isort)
- **String quotes:** double quotes (enforced by Ruff)
- **No `from core.models import ...`** — always import from the specific small app
- **No unused imports** — Ruff will catch and auto-remove them
- **Type annotations:** use Python 3.10+ union syntax (`str | None`, not `Optional[str]`)
- **f-strings** over `.format()` or `%` formatting

```python
# Good
from core.masters.models import Master
from core.serializers import UserMinSerializer

# Bad
from core.models import Master  # file deleted
from typing import Optional     # use str | None instead
```

### TypeScript / React

See [`frontend/task-tracker/README.md`](./frontend/task-tracker/README.md) for frontend code style rules (strict mode, `@/` imports, function components only, no inline `fetch`, etc.).

### Git

- Commit messages are imperative, present tense: `Add attendance filter`, `Fix worklog user visibility`
- One logical change per commit
- Run `uv run pre-commit run --all-files` before pushing if hooks were skipped

---

## Apps Overview

| App | Models | Purpose |
|---|---|---|
| `users` | `User`, `Org` | Custom auth (email or username login), tenant orgs, role-based access, access flags with audit trail |
| `core.filestore` | — | JWT-signed URL helper + `ServeFileView` for file downloads; storage-backend agnostic |
| `core.masters` | `Master` | Lookup table — clients, categories, teams (scoped by `org`) |
| `core.tasks` | `Task`, `TaskLog` | Task management with status tracking and append-only audit trail (`changed_by_name` snapshot) |
| `core.worklog` | `WorkLog`, `WorkPlan` | Daily work logging and planning (`hours` validated 0.01–24) |
| `core.notices` | `Notice` | GST and legal notice tracking |
| `core.leads` | `Lead`, `LeadStatus`, `LeadHistory` | Lead/CRM pipeline |
| `core.invoices` | `InvoicePlan`, `InvoiceEntry` | Invoice scheduling, upload and approval |
| `core.chat` | `ChatRoom`, `ChatMember`, `ChatMessage` | Internal team messaging (soft-delete via `is_deleted`) |
| `core.holidays` | `Holiday` | Holiday calendar |
| `core.settings_app` | `AppSetting` | Key/value app configuration (with `description`) |
| `core.employees` | `Employee`, `EmployeeSalary` | Employee records (Aadhaar/PAN/IFSC regex validators, `address_proof` upload) and versioned salary history |
| `core.attendance` | `Attendance` | Daily attendance — `status` is orthogonal to `work_location` (WFH is a location, not a status) |
| `core.growth` | `GrowthPlan` | Team growth and initiative tracking |
| `core.pace` | `PaceGoal`, `PaceGoalReview`, `PaceMeeting`, `PaceChecklist`, `ClientClassification` | Goal-setting, reviews, meeting minutes, weekly checklist, client tiering |
| `core.backup` | — | Admin-only per-tenant export/restore (throttled 5/hr export, 2/hr restore) |
| `core.audit` | `AuditLog` | Append-only audit trail (written via `core.audit.models.log()`); read-only admin list API |

---

## API Reference

See [API_USAGE_GUIDE.md](./API_USAGE_GUIDE.md) for the full REST API reference — request bodies, response shapes, query params, and extra actions for every endpoint.

---

## Development Guide

For the full contract anyone — human or AI — must follow when shipping backend changes, see [`DEVELOPMENT.md`](./DEVELOPMENT.md). It covers architectural principles, the feature workflow, detailed rules for models/serializers/viewsets, multi-tenancy, file uploads, realtime, audit logging, query performance, migration safety, testing, observability, the pre-PR gate, common anti-patterns, the deployment checklist, and AI-agent-specific rules.

Frontend rules live in [`frontend/task-tracker/README.md`](./frontend/task-tracker/README.md) and [`frontend/task-tracker/docs/DEVELOPMENT.md`](./frontend/task-tracker/docs/DEVELOPMENT.md).
