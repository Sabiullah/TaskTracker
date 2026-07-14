# Budget vs Actual (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Budget vs Actual" module: manually-entered monthly Budget/Actual line items per client per financial year, with a report table (Budget, Actual, Variance, Variance %, Status per month + grand totals) and a summary strip, wired into the nav right after Costing.

**Architecture:** One new Django app `core/budget` holding a single model, `BudgetLineItem`, following the exact `core/costing` CRUD-viewset pattern (`UidLookupMixin`, `scoped()`/`resolve_create_org`, `core.realtime.broadcast`). Gated by a new `budget_access` permission (mirrors `costing_access` exactly — same `ACCESS_FEATURES` tuple, same `OrgMembership` boolean+audit-pair shape, same `IsAdminOrCostingAccess`-style permission class) plus a matching `MenuNode("budget", ...)` right after `costing` in the menu catalog. On the frontend: the standard hook/api-client/types trio (mirroring `useCosting`/`lib/api/costing.ts`/`types/api/costing.ts`), a small pure aggregation utility (sums line items into 12 monthly rows + grand total, computes variance/status), and a new `BudgetVsActualPage` wired into the nav exactly like `CostingPage`.

**Tech Stack:** Django 5 / DRF (`core/*` apps), SQLite dev DB, React + TypeScript (Vite), Vitest for frontend tests, Django `TestCase` + DRF `APIClient` for backend tests.

## Global Constraints

- `uid` (UUID) is always the external identifier in URLs — every new viewset mixes in `UidLookupMixin` (`core/base.py`), never exposing the integer PK.
- Every org-scoped model/viewset must filter through the caller's orgs — use `core.org_utils.scoped()` / `resolve_create_org()`, never trust a client-supplied org blindly.
- Every mutating viewset action broadcasts via `core.realtime.broadcast(channel, event_type, payload)` on create/update/delete, matching every existing app.
- New DRF fields that reference another model use `SlugRelatedField(slug_field="uid", ...)` so the wire format never leaks integer PKs.
- Any new `BooleanField` added to `OrgMembership` MUST set `db_default=` (not just `default=`) alongside it — a prior bug (`costing_access`) showed that Django's `AddField(default=False)` only backfills existing rows at migration time; it does not persist a SQL-level column default, which breaks a pre-existing migration-state test (`core/pace/tests_migrations.py`) that constructs `OrgMembership` rows from a historical model snapshot frozen before the new field existed.
- Financial year is a plain calendar year (e.g. `2026`), not a fiscal year — months run January (1) through December (12).
- Both Budget and Actual are manually entered amounts. There is no transaction-aggregation, no drill-down to underlying transactions, and no auto-update from any other system — this is explicitly out of scope for Phase 1.
- "On Budget" = Actual within ±5% of Budget. Above → "Over Budget". Below → "Under Budget". (Special case: Budget = 0 and Actual = 0 → "On Budget"; Budget = 0 and Actual > 0 → "Over Budget".)
- No KPI dashboard cards, no charts, no Excel/PDF/CSV export, no audit trail, no approval workflow, no Project/Department/Category filters — all explicitly deferred to later phases per the approved spec (`docs/superpowers/specs/2026-07-06-budget-vs-actual-design.md`).

---

## File Structure

**Backend — modified:**
- `users/models.py` — add `"budget_access"` to `ACCESS_FEATURES`, add `OrgMembership.budget_access(_granted_by/_at)`, add `User.has_budget_in`/`has_budget_in_any`
- `users/migrations/` — new migration for the `OrgMembership` fields
- `users/menu_catalog.py` — add `MenuNode("budget", "Budget vs Actual", None)` right after `costing`, add `"budget_access": "budget"` to `FEATURE_TO_CODE`
- `core/permissions.py` — add `IsAdminOrBudgetAccess`
- `config/settings.py` — add `"core.budget"` to `INSTALLED_APPS`
- `config/urls.py` — add `path("api/", include("core.budget.urls"))`

**Backend — new:**
- `core/budget/__init__.py`, `core/budget/apps.py` — standard Django app scaffold
- `core/budget/models.py` — `BudgetLineItem`
- `core/budget/migrations/0001_initial.py`
- `core/budget/serializers.py` — `BudgetLineItemSerializer`
- `core/budget/views.py` — `BudgetLineItemViewSet`
- `core/budget/urls.py`
- `core/budget/tests.py`

**Frontend — modified:**
- `frontend/task-tracker/src/types/api/index.ts` — `export * from "./budget";`
- `frontend/task-tracker/src/types/api/realtime.ts` — add `"budget-line-items"` to `RealtimeChannel`
- `frontend/task-tracker/src/App.tsx` — lazy-import `BudgetVsActualPage`, add `"budget"` to `navVisible` right after `"costing"`, add to `VIEW_MAP`
- `frontend/task-tracker/src/components/header/NavMenu.tsx` — add the `budget` tab entry right after `costing`
- `frontend/task-tracker/src/components/layout/Header.tsx` — add a `budget` SVG icon to the `icons` map

**Frontend — new:**
- `frontend/task-tracker/src/types/api/budget.ts` — `BudgetLineItemDto`, `BudgetLineItemCreateForm`, `BudgetLineItemEditForm`
- `frontend/task-tracker/src/lib/api/budget.ts` — `listBudgetLineItems`, `createBudgetLineItem`, `editBudgetLineItem`, `deleteBudgetLineItem`
- `frontend/task-tracker/src/hooks/useBudget.ts` — state + CRUD + websocket subscription
- `frontend/task-tracker/src/utils/budget.ts` — `computeMonthlySummary`, `computeGrandTotal` (pure functions)
- `frontend/task-tracker/src/pages/BudgetVsActualPage.tsx` — FY/client filter + summary strip + report table + expandable month rows + add/edit/delete modal
- `frontend/task-tracker/src/__tests__/utils/budget.test.ts`
- `frontend/task-tracker/src/__tests__/hooks/useBudget.test.ts`

---

### Task 1: `budget_access` permission infrastructure

**Files:**
- Modify: `users/models.py`, `users/menu_catalog.py`, `core/permissions.py`
- Create: `users/migrations/000X_orgmembership_budget_access.py` (check `python manage.py showmigrations users` for the actual latest — expected to depend on `users.0008_orgmembership_costing_access`, confirm for real rather than assuming)
- Test: `users/tests.py` (the file already has a `CostingAccessTests` class from the Costing feature — add a parallel `BudgetAccessTests` class there)

**Interfaces:**
- Produces: `OrgMembership.budget_access: bool`, `User.has_budget_in(org) -> bool`, `User.has_budget_in_any() -> bool`, `core.permissions.IsAdminOrBudgetAccess`, menu code `"budget"`.

- [ ] **Step 1: Write the failing test**

Add to `users/tests.py`, right after the existing `CostingAccessTests` class:

```python
class BudgetAccessTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="Org-Budget-Access")
        self.admin = User.objects.create_user(username="budget-admin", password="pw", full_name="Admin")
        OrgMembership.objects.create(user=self.admin, org=self.org, role="admin")
        self.plain = User.objects.create_user(username="budget-plain", password="pw", full_name="Plain")
        OrgMembership.objects.create(user=self.plain, org=self.org, role="employee")
        self.granted = User.objects.create_user(username="budget-granted", password="pw", full_name="Granted")
        OrgMembership.objects.create(user=self.granted, org=self.org, role="employee", budget_access=True)

    def test_budget_access_in_features_tuple(self):
        self.assertIn("budget_access", ACCESS_FEATURES)

    def test_admin_has_budget_access(self):
        self.assertTrue(self.admin.has_budget_in(self.org))

    def test_plain_employee_lacks_budget_access(self):
        self.assertFalse(self.plain.has_budget_in(self.org))

    def test_granted_employee_has_budget_access(self):
        self.assertTrue(self.granted.has_budget_in(self.org))
        self.assertTrue(self.granted.has_budget_in_any())
```

Confirm `ACCESS_FEATURES` is already imported at the top of `users/tests.py` (it should be, from the Costing feature's `CostingAccessTests`) — if not, add `from users.models import ACCESS_FEATURES` (adjust to match however it's currently imported).

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run python manage.py test users.tests.BudgetAccessTests -v 2`
Expected: FAIL — `AttributeError: 'OrgMembership' object has no attribute 'budget_access'` (or similar), since the field doesn't exist yet.

- [ ] **Step 3: Add `budget_access` to `ACCESS_FEATURES`**

In `users/models.py`, find the `ACCESS_FEATURES` tuple (it currently ends with `"costing_access",`) and add:

```python
ACCESS_FEATURES = (
    "invoice_access",
    "notice_access",
    "masters_access",
    "attendance_access",
    "employee_access",
    "leads_access",
    "conveyance_access",
    "costing_access",
    "budget_access",
)
```

- [ ] **Step 4: Add the `OrgMembership` field**

In `users/models.py`, find the line `costing_access = models.BooleanField(default=False, db_default=False)` inside the `OrgMembership` class, and add directly after it:

```python
    # See the costing_access comment above for why db_default is required
    # alongside default — a NOT NULL boolean without a real SQL-level
    # default breaks core/pace/tests_migrations.py's historical-model
    # inserts once this field exists in the live schema.
    budget_access = models.BooleanField(default=False, db_default=False)
```

- [ ] **Step 5: Add the `budget_access` audit-pair fields**

In the same `OrgMembership` class, find the `costing_access_granted_by`/`costing_access_granted_at` pair (the last one in the `_granted_by`/`_granted_at` block) and add directly after it:

```python
    budget_access_granted_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    budget_access_granted_at = models.DateTimeField(null=True, blank=True)
```

- [ ] **Step 6: Add the `User` helper methods**

In `users/models.py`, on the `User` class, find `has_costing_in`/`has_costing_in_any` and add directly after them:

```python
    # Budget access
    def has_budget_in(self, org) -> bool:
        return self._has_access_in("budget_access", org)

    def has_budget_in_any(self) -> bool:
        return self._has_access_in_any("budget_access")
```

- [ ] **Step 7: Register the menu code**

In `users/menu_catalog.py`, in `MENU_CATALOG`, find `MenuNode("costing", "Costing", None),` and add directly after it:

```python
    MenuNode("budget", "Budget vs Actual", None),
```

Add to `FEATURE_TO_CODE` (which currently ends with `"costing_access": "costing",`):

```python
FEATURE_TO_CODE: dict[str, str] = {
    "invoice_access": "invoice",
    "notice_access": "notice",
    "masters_access": "masters",
    "attendance_access": "employee.attendance_log",
    "employee_access": "employee",
    "leads_access": "leads",
    "conveyance_access": "conveyance",
    "costing_access": "costing",
    "budget_access": "budget",
}
```

- [ ] **Step 8: Add the permission class**

In `core/permissions.py`, find `IsAdminOrCostingAccess` and add directly after it:

```python
class IsAdminOrBudgetAccess(permissions.BasePermission):
    """Budget gate — mirrors IsAdminOrCostingAccess for the budget_access flag."""

    def has_permission(self, request, view):
        if request.method in permissions.SAFE_METHODS:
            return request.user.is_authenticated
        u = _as_user(request)
        return bool(u and (u.is_admin_in_any() or u.has_budget_in_any()))

    def has_object_permission(self, request, view, obj):
        if request.method in permissions.SAFE_METHODS:
            return True
        u = _as_user(request)
        org = _access_org(obj)
        return bool(u and (u.is_admin_in(org) or u.has_budget_in(org)))
```

- [ ] **Step 9: Generate and apply the migration**

Run: `uv run python manage.py makemigrations users --name orgmembership_budget_access`
Run: `uv run python manage.py migrate users`
Expected: `Applying users.000X_orgmembership_budget_access... OK`

- [ ] **Step 10: Run test to verify it passes**

Run: `uv run python manage.py test users.tests.BudgetAccessTests -v 2`
Expected: PASS (4 tests). Also run `uv run python manage.py test core.pace.tests_migrations -v 2` to confirm the new NOT-NULL boolean didn't reintroduce the historical-model insert bug — expected: PASS (the `db_default` from Step 4 prevents it).

- [ ] **Step 11: Commit**

```bash
git add users/models.py users/menu_catalog.py users/migrations/ core/permissions.py users/tests.py
git commit -m "feat(budget): add budget_access permission and menu entry"
```

---

### Task 2: `BudgetLineItem` model

**Files:**
- Create: `core/budget/__init__.py`, `core/budget/apps.py`, `core/budget/models.py`, `core/budget/migrations/__init__.py`, `core/budget/migrations/0001_initial.py`, `core/budget/tests.py`
- Modify: `config/settings.py` (`INSTALLED_APPS`)

**Interfaces:**
- Consumes: `masters.Master` (`type="client"`), `users.Org`.
- Produces: `BudgetLineItem` model with `uid`, `org`, `client`, `financial_year`, `month`, `line_type` (`"budget"` | `"actual"`), `description`, `amount`, `created_by`, timestamps.

- [ ] **Step 1: Scaffold the app**

Create `core/budget/__init__.py` (empty file).

Create `core/budget/apps.py`:

```python
from django.apps import AppConfig


class BudgetConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "core.budget"
```

Create `core/budget/migrations/__init__.py` (empty file).

- [ ] **Step 2: Register the app**

In `config/settings.py`, `INSTALLED_APPS` currently has `"core.costing",` right after `"core.invoices",`. Add `"core.budget",` directly after `"core.costing",`:

```python
    "core.invoices",
    "core.costing",
    "core.budget",
    "core.kaizen",
```

- [ ] **Step 3: Write the failing test**

Create `core/budget/tests.py`:

```python
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.test import TestCase

from core.masters.models import Master
from users.models import Org

from .models import BudgetLineItem


class BudgetLineItemModelTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="Org-Budget")
        self.client_master = Master.objects.create(name="Acme", type="client", org=self.org)

    def test_create_budget_line_item(self):
        item = BudgetLineItem.objects.create(
            org=self.org,
            client=self.client_master,
            financial_year=2026,
            month=1,
            line_type="budget",
            description="Retainer fee",
            amount=Decimal("50000"),
        )
        self.assertEqual(item.line_type, "budget")
        self.assertEqual(item.amount, Decimal("50000"))

    def test_create_actual_line_item(self):
        item = BudgetLineItem.objects.create(
            org=self.org,
            client=self.client_master,
            financial_year=2026,
            month=1,
            line_type="actual",
            description="Invoice paid",
            amount=Decimal("48000"),
        )
        self.assertEqual(item.line_type, "actual")

    def test_month_out_of_range_rejected(self):
        item = BudgetLineItem(
            org=self.org,
            client=self.client_master,
            financial_year=2026,
            month=13,
            line_type="budget",
            amount=Decimal("100"),
        )
        with self.assertRaises(ValidationError):
            item.full_clean()

    def test_negative_amount_rejected(self):
        item = BudgetLineItem(
            org=self.org,
            client=self.client_master,
            financial_year=2026,
            month=1,
            line_type="budget",
            amount=Decimal("-10"),
        )
        with self.assertRaises(ValidationError):
            item.full_clean()
```

- [ ] **Step 4: Run test to verify it fails**

Run: `uv run python manage.py test core.budget.tests -v 2`
Expected: FAIL — `ModuleNotFoundError: No module named 'core.budget.models'` (model doesn't exist yet).

- [ ] **Step 5: Write the model**

Create `core/budget/models.py`:

```python
import uuid

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from core.base import TimeStampedModel


class BudgetLineItem(TimeStampedModel):
    LINE_TYPE_CHOICES = [
        ("budget", "Budget"),
        ("actual", "Actual"),
    ]

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    org = models.ForeignKey(
        "users.Org",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="budget_line_items",
    )
    client = models.ForeignKey(
        "masters.Master",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="budget_line_items",
        limit_choices_to={"type": "client"},
    )
    financial_year = models.PositiveIntegerField(
        validators=[MinValueValidator(2000), MaxValueValidator(2100)],
    )
    month = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(12)],
    )
    line_type = models.CharField(max_length=10, choices=LINE_TYPE_CHOICES)
    description = models.CharField(max_length=255, blank=True, default="")
    amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0,
        validators=[MinValueValidator(0)],
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="budget_line_items",
    )

    class Meta:
        ordering = ["client__name", "financial_year", "month", "line_type"]
        verbose_name = "budget line item"
        verbose_name_plural = "budget line items"
        indexes = [
            models.Index(fields=["client", "financial_year"], name="budget_client_fy_idx"),
        ]

    def __str__(self):
        return f"{self.client} {self.financial_year}-{self.month:02d} {self.line_type}: {self.amount}"
```

- [ ] **Step 6: Generate and apply the migration**

Run: `uv run python manage.py makemigrations budget`
Run: `uv run python manage.py migrate budget`
Expected: `Applying budget.0001_initial... OK`

- [ ] **Step 7: Run test to verify it passes**

Run: `uv run python manage.py test core.budget.tests -v 2`
Expected: PASS (4 tests)

- [ ] **Step 8: Commit**

```bash
git add core/budget/__init__.py core/budget/apps.py core/budget/models.py core/budget/migrations/ core/budget/tests.py config/settings.py
git commit -m "feat(budget): add BudgetLineItem model"
```

---

### Task 3: `BudgetLineItem` API (serializer, viewset, urls)

**Files:**
- Create: `core/budget/serializers.py`, `core/budget/views.py`, `core/budget/urls.py`
- Modify: `config/urls.py`, `core/budget/tests.py`

**Interfaces:**
- Consumes: `BudgetLineItem` (Task 2), `IsAdminOrBudgetAccess` (Task 1), `core.org_utils.scoped`/`resolve_create_org`, `core.base.UidLookupMixin`, `core.realtime.broadcast`, `core.masters.serializers.MasterMinSerializer`.
- Produces: `GET/POST /api/budget_line_items/`, `GET/PATCH/DELETE /api/budget_line_items/<uid>/`, filterable by required `?client=<uid>&financial_year=<int>`.

- [ ] **Step 1: Write the failing tests**

Add to `core/budget/tests.py`:

```python
from rest_framework.test import APIClient

from users.models import OrgMembership, User


class BudgetLineItemApiTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="Org-Budget-Api")
        self.other_org = Org.objects.create(name="Org-Budget-Other")
        self.client_master = Master.objects.create(name="Acme", type="client", org=self.org)

        self.admin = User.objects.create_user(username="budget-admin", password="pw", full_name="Admin")
        OrgMembership.objects.create(user=self.admin, org=self.org, role="admin")

        self.no_access = User.objects.create_user(username="budget-noaccess", password="pw", full_name="NoAccess")
        OrgMembership.objects.create(user=self.no_access, org=self.org, role="employee")

        self.api = APIClient()

    def test_admin_can_create(self):
        self.api.force_authenticate(user=self.admin)
        res = self.api.post(
            "/api/budget_line_items/",
            {
                "org": str(self.org.uid),
                "client": str(self.client_master.uid),
                "financial_year": 2026,
                "month": 1,
                "line_type": "budget",
                "description": "Retainer fee",
                "amount": "50000",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data["amount"], "50000.00")
        self.assertEqual(res.data["line_type"], "budget")

    def test_user_without_budget_access_is_forbidden_on_write(self):
        self.api.force_authenticate(user=self.no_access)
        res = self.api.post(
            "/api/budget_line_items/",
            {
                "org": str(self.org.uid),
                "client": str(self.client_master.uid),
                "financial_year": 2026,
                "month": 1,
                "line_type": "budget",
                "amount": "1000",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 403)

    def test_entries_scoped_to_caller_org(self):
        item = BudgetLineItem.objects.create(
            org=self.org, client=self.client_master, financial_year=2026, month=1,
            line_type="budget", amount=1000,
        )
        outsider = User.objects.create_user(username="budget-outsider", password="pw", full_name="Outsider")
        OrgMembership.objects.create(user=outsider, org=self.other_org, role="admin")
        self.api.force_authenticate(user=outsider)
        res = self.api.get("/api/budget_line_items/")
        self.assertEqual(res.status_code, 200)
        uids = [row["uid"] for row in res.data]
        self.assertNotIn(str(item.uid), uids)

    def test_filter_by_client_and_financial_year(self):
        self.api.force_authenticate(user=self.admin)
        BudgetLineItem.objects.create(
            org=self.org, client=self.client_master, financial_year=2026, month=1,
            line_type="budget", amount=1000,
        )
        BudgetLineItem.objects.create(
            org=self.org, client=self.client_master, financial_year=2025, month=1,
            line_type="budget", amount=2000,
        )
        other_client = Master.objects.create(name="Globex", type="client", org=self.org)
        BudgetLineItem.objects.create(
            org=self.org, client=other_client, financial_year=2026, month=1,
            line_type="budget", amount=3000,
        )
        res = self.api.get(
            f"/api/budget_line_items/?client={self.client_master.uid}&financial_year=2026"
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 1)
        self.assertEqual(res.data[0]["amount"], "1000.00")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run python manage.py test core.budget.tests.BudgetLineItemApiTests -v 2`
Expected: FAIL — 404s, since no urls/views/serializer exist yet.

- [ ] **Step 3: Write the serializer**

Create `core/budget/serializers.py`:

```python
from rest_framework import serializers

from core.masters.models import Master
from core.masters.serializers import MasterMinSerializer
from users.models import Org

from .models import BudgetLineItem


class BudgetLineItemSerializer(serializers.ModelSerializer):
    org = serializers.SlugRelatedField(slug_field="uid", queryset=Org.objects.all(), required=False)
    client = serializers.SlugRelatedField(slug_field="uid", queryset=Master.objects.filter(type="client"))
    client_detail = MasterMinSerializer(source="client", read_only=True)
    org_name = serializers.SerializerMethodField()
    created_by_uid = serializers.UUIDField(source="created_by.uid", read_only=True, allow_null=True)

    class Meta:
        model = BudgetLineItem
        fields = [
            "id",
            "uid",
            "org",
            "org_name",
            "client",
            "client_detail",
            "financial_year",
            "month",
            "line_type",
            "description",
            "amount",
            "created_by_uid",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "uid", "created_by_uid", "created_at", "updated_at"]

    def get_org_name(self, obj):
        return obj.org.name if obj.org_id else None
```

- [ ] **Step 4: Write the viewset**

Create `core/budget/views.py`:

```python
from typing import cast

from rest_framework import permissions
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.org_utils import resolve_create_org, scoped
from core.permissions import IsAdminOrBudgetAccess
from core.realtime import broadcast
from users.models import User

from .models import BudgetLineItem
from .serializers import BudgetLineItemSerializer


def _raise_from_response(err):
    exc_cls = PermissionDenied if err.status_code == 403 else ValidationError
    raise exc_cls(err.data)


class BudgetLineItemViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = BudgetLineItemSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrBudgetAccess]

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = scoped(
            BudgetLineItem.objects.select_related("client", "created_by"),
            user,
        )
        client_uid = self.request.query_params.get("client")
        if client_uid:
            qs = qs.filter(client__uid=client_uid)
        financial_year = self.request.query_params.get("financial_year")
        if financial_year:
            qs = qs.filter(financial_year=financial_year)
        return qs

    def perform_create(self, serializer):
        org, err = resolve_create_org(self.request)
        if err is not None:
            _raise_from_response(err)
        obj = serializer.save(created_by=self.request.user, org=org)
        broadcast("budget-line-items", "INSERT", BudgetLineItemSerializer(obj).data)

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast("budget-line-items", "UPDATE", BudgetLineItemSerializer(obj).data)

    def perform_destroy(self, instance):
        broadcast("budget-line-items", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()
```

- [ ] **Step 5: Write urls and wire into the project**

Create `core/budget/urls.py`:

```python
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import BudgetLineItemViewSet

router = DefaultRouter()
router.register("budget_line_items", BudgetLineItemViewSet, basename="budgetlineitem")

urlpatterns = [path("", include(router.urls))]
```

In `config/urls.py`, add (directly after `path("api/", include("core.costing.urls")),`):

```python
    path("api/", include("core.budget.urls")),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `uv run python manage.py test core.budget.tests -v 2`
Expected: PASS (8 tests total: 4 model + 4 API)

- [ ] **Step 7: Commit**

```bash
git add core/budget/serializers.py core/budget/views.py core/budget/urls.py core/budget/tests.py config/urls.py
git commit -m "feat(budget): add BudgetLineItem CRUD API scoped by org and gated by budget_access"
```

---

### Task 4: Frontend — Budget types, API client, hook

**Files:**
- Create: `frontend/task-tracker/src/types/api/budget.ts`, `frontend/task-tracker/src/lib/api/budget.ts`, `frontend/task-tracker/src/hooks/useBudget.ts`, `frontend/task-tracker/src/__tests__/hooks/useBudget.test.ts`
- Modify: `frontend/task-tracker/src/types/api/index.ts`, `frontend/task-tracker/src/types/api/realtime.ts`

**Interfaces:**
- Consumes: `GET/POST/PATCH/DELETE /api/budget_line_items/` (Task 3), `apiGet`/`apiPost`/`apiPatch`/`apiDelete` from `@/lib/api`, `ws.subscribe` from `@/lib/api`.
- Produces: `useBudget(clientUid, financialYear)` returning `{entries, loading, saving, reload, createEntry, editEntry, removeEntry}`; `BudgetLineItemDto`/`BudgetLineItemCreateForm`/`BudgetLineItemEditForm` types.

- [ ] **Step 1: Verify the real serializer field shape**

Before writing the DTO, re-read `core/budget/serializers.py` from Task 3 (not this plan's illustrative snippet) to confirm the exact field list on `BudgetLineItemSerializer.Meta.fields` matches what's written below. It should — Task 3 was written to match this plan exactly — but confirm rather than assume, since Task 3 and Task 4 may be implemented by different people/sessions.

- [ ] **Step 2: Write the types**

Create `frontend/task-tracker/src/types/api/budget.ts`:

```ts
/**
 * DTOs for the Budget vs Actual feature — mirrors
 * `core/budget/serializers.py` (`BudgetLineItemSerializer`) on the Django
 * backend.
 */

import type { BaseDto, MasterRefDto } from "./common";

export type BudgetLineType = "budget" | "actual";

/** Server response shape for a `BudgetLineItem` row (`/api/budget_line_items/`). */
export interface BudgetLineItemDto extends BaseDto {
  readonly org: string | null;
  readonly org_name: string | null;
  readonly client: string; // Master uid (type="client")
  readonly client_detail: MasterRefDto | null;
  readonly financial_year: number;
  readonly month: number; // 1-12
  readonly line_type: BudgetLineType;
  readonly description: string;
  readonly amount: string;
  readonly created_by_uid: string | null;
}

/** Body sent on `POST /api/budget_line_items/`. */
export interface BudgetLineItemCreateForm {
  org?: string;
  client: string;
  financial_year: number;
  month: number;
  line_type: BudgetLineType;
  description?: string;
  amount: string | number;
}

/** Body sent on `PATCH /api/budget_line_items/{uid}/`. */
export interface BudgetLineItemEditForm {
  description?: string;
  amount?: string | number;
}
```

Check `frontend/task-tracker/src/types/api/common.ts` for the actual `BaseDto`/`MasterRefDto` shapes before finalizing — these are already used by `types/api/costing.ts`, so match whatever it does exactly (import path, field names).

- [ ] **Step 3: Write the api client**

Create `frontend/task-tracker/src/lib/api/budget.ts`:

```ts
import { apiDelete, apiGet, apiPatch, apiPost } from "./client";
import type {
  BudgetLineItemCreateForm,
  BudgetLineItemDto,
  BudgetLineItemEditForm,
} from "@/types/api/budget";

export const listBudgetLineItems = (clientUid: string, financialYear: number) =>
  apiGet<BudgetLineItemDto[]>("/budget_line_items/", {
    client: clientUid,
    financial_year: financialYear,
  });

export const createBudgetLineItem = (form: BudgetLineItemCreateForm) =>
  apiPost<BudgetLineItemDto>("/budget_line_items/", form);

export const editBudgetLineItem = (uid: string, form: BudgetLineItemEditForm) =>
  apiPatch<BudgetLineItemDto>(`/budget_line_items/${uid}/`, form);

export const deleteBudgetLineItem = (uid: string) => apiDelete(`/budget_line_items/${uid}/`);
```

- [ ] **Step 4: Add the realtime channel**

In `frontend/task-tracker/src/types/api/realtime.ts`, find the `RealtimeChannel` union (it currently ends with `| "costing-entries";`) and add:

```ts
  | "budget-line-items";
```

- [ ] **Step 5: Write the failing hook test**

Create `frontend/task-tracker/src/__tests__/hooks/useBudget.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useBudget } from "@/hooks/useBudget";
import * as budgetApi from "@/lib/api/budget";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, ws: { subscribe: vi.fn(() => () => {}) } };
});

describe("useBudget", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("loads entries for the given client and financial year", async () => {
    vi.spyOn(budgetApi, "listBudgetLineItems").mockResolvedValue([
      {
        id: 1,
        uid: "e1",
        org: "o1",
        org_name: "Acme Org",
        client: "c1",
        client_detail: { id: 1, uid: "c1", name: "Acme", type: "client", color: "" },
        financial_year: 2026,
        month: 1,
        line_type: "budget",
        description: "Retainer",
        amount: "50000.00",
        created_by_uid: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);
    const { result } = renderHook(() => useBudget("c1", 2026));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].amount).toBe("50000.00");
  });

  it("creates an entry and appends it to state", async () => {
    vi.spyOn(budgetApi, "listBudgetLineItems").mockResolvedValue([]);
    const created = {
      id: 2,
      uid: "e2",
      org: "o1",
      org_name: "Acme Org",
      client: "c1",
      client_detail: null,
      financial_year: 2026,
      month: 2,
      line_type: "actual" as const,
      description: "Invoice paid",
      amount: "48000.00",
      created_by_uid: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    vi.spyOn(budgetApi, "createBudgetLineItem").mockResolvedValue(created);
    const { result } = renderHook(() => useBudget("c1", 2026));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.createEntry({
        client: "c1",
        financial_year: 2026,
        month: 2,
        line_type: "actual",
        amount: 48000,
      });
    });
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].uid).toBe("e2");
  });

  it("does not fetch when client or financial year is missing", async () => {
    const spy = vi.spyOn(budgetApi, "listBudgetLineItems");
    const { result } = renderHook(() => useBudget(null, 2026));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(spy).not.toHaveBeenCalled();
    expect(result.current.entries).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/hooks/useBudget.test.ts`
Expected: FAIL — `Cannot find module '@/hooks/useBudget'`.

- [ ] **Step 7: Write the hook**

Create `frontend/task-tracker/src/hooks/useBudget.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import { ws } from "@/lib/api";
import {
  createBudgetLineItem,
  deleteBudgetLineItem,
  editBudgetLineItem,
  listBudgetLineItems,
} from "@/lib/api/budget";
import type {
  BudgetLineItemCreateForm,
  BudgetLineItemDto,
  BudgetLineItemEditForm,
} from "@/types/api/budget";

export interface UseBudgetReturn {
  entries: BudgetLineItemDto[];
  loading: boolean;
  saving: boolean;
  reload: () => Promise<void>;
  createEntry: (form: BudgetLineItemCreateForm) => Promise<BudgetLineItemDto>;
  editEntry: (uid: string, form: BudgetLineItemEditForm) => Promise<BudgetLineItemDto>;
  removeEntry: (uid: string) => Promise<void>;
}

export function useBudget(
  clientUid: string | null,
  financialYear: number | null,
): UseBudgetReturn {
  const [entries, setEntries] = useState<BudgetLineItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!clientUid || !financialYear) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rows = await listBudgetLineItems(clientUid, financialYear);
      setEntries(rows);
    } finally {
      setLoading(false);
    }
  }, [clientUid, financialYear]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!clientUid || !financialYear) return;
    return ws.subscribe<BudgetLineItemDto>("budget-line-items", (msg) => {
      const record = msg.record;
      if (!record || record.client !== clientUid || record.financial_year !== financialYear) return;
      if (msg.event === "DELETE") {
        setEntries((prev) => prev.filter((e) => e.uid !== record.uid));
        return;
      }
      if (msg.event === "INSERT" || msg.event === "UPDATE") {
        setEntries((prev) => {
          const idx = prev.findIndex((e) => e.uid === record.uid);
          if (idx === -1) return [...prev, record];
          const next = [...prev];
          next[idx] = record;
          return next;
        });
      }
    });
  }, [clientUid, financialYear]);

  const createEntry = useCallback(async (form: BudgetLineItemCreateForm) => {
    setSaving(true);
    try {
      const created = await createBudgetLineItem(form);
      setEntries((prev) => [...prev, created]);
      return created;
    } finally {
      setSaving(false);
    }
  }, []);

  const editEntry = useCallback(async (uid: string, form: BudgetLineItemEditForm) => {
    setSaving(true);
    try {
      const updated = await editBudgetLineItem(uid, form);
      setEntries((prev) => prev.map((e) => (e.uid === uid ? updated : e)));
      return updated;
    } finally {
      setSaving(false);
    }
  }, []);

  const removeEntry = useCallback(async (uid: string) => {
    setSaving(true);
    try {
      await deleteBudgetLineItem(uid);
      setEntries((prev) => prev.filter((e) => e.uid !== uid));
    } finally {
      setSaving(false);
    }
  }, []);

  return { entries, loading, saving, reload, createEntry, editEntry, removeEntry };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/hooks/useBudget.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 9: Add to the barrel export**

In `frontend/task-tracker/src/types/api/index.ts`, add alphabetically (it currently has `export * from "./costing";` — add nearby, before or after alphabetically as the file's existing convention dictates):

```ts
export * from "./budget";
```

- [ ] **Step 10: Run `tsc` to confirm no type errors**

Run: `cd frontend/task-tracker && npx tsc -b`
Expected: clean, no output.

- [ ] **Step 11: Commit**

```bash
git add frontend/task-tracker/src/types/api/budget.ts frontend/task-tracker/src/lib/api/budget.ts frontend/task-tracker/src/hooks/useBudget.ts frontend/task-tracker/src/__tests__/hooks/useBudget.test.ts frontend/task-tracker/src/types/api/index.ts frontend/task-tracker/src/types/api/realtime.ts
git commit -m "feat(budget): add frontend types, api client, and useBudget hook"
```

---

### Task 5: Frontend — monthly aggregation utility

**Files:**
- Create: `frontend/task-tracker/src/utils/budget.ts`, `frontend/task-tracker/src/__tests__/utils/budget.test.ts`

**Interfaces:**
- Consumes: `BudgetLineItemDto` (Task 4).
- Produces: `computeMonthlySummary(entries): MonthlySummary[]` (always 12 rows), `computeGrandTotal(rows): GrandTotal`, exported types `MonthlySummary`, `BudgetStatus`, `GrandTotal`.

- [ ] **Step 1: Write the failing test**

Create `frontend/task-tracker/src/__tests__/utils/budget.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeMonthlySummary, computeGrandTotal } from "@/utils/budget";
import type { BudgetLineItemDto } from "@/types/api/budget";

function makeEntry(overrides: Partial<BudgetLineItemDto>): BudgetLineItemDto {
  return {
    id: 1,
    uid: "u1",
    org: "o1",
    org_name: "Org",
    client: "c1",
    client_detail: null,
    financial_year: 2026,
    month: 1,
    line_type: "budget",
    description: "",
    amount: "0",
    created_by_uid: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("computeMonthlySummary", () => {
  it("returns exactly 12 rows even with no entries", () => {
    const rows = computeMonthlySummary([]);
    expect(rows).toHaveLength(12);
    expect(rows.map((r) => r.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(rows[0].budgetTotal).toBe(0);
    expect(rows[0].actualTotal).toBe(0);
  });

  it("sums multiple line items of the same type within a month", () => {
    const rows = computeMonthlySummary([
      makeEntry({ uid: "a", month: 1, line_type: "budget", amount: "30000" }),
      makeEntry({ uid: "b", month: 1, line_type: "budget", amount: "20000" }),
      makeEntry({ uid: "c", month: 1, line_type: "actual", amount: "48000" }),
    ]);
    const jan = rows.find((r) => r.month === 1)!;
    expect(jan.budgetTotal).toBe(50000);
    expect(jan.actualTotal).toBe(48000);
    expect(jan.variance).toBe(-2000);
  });

  it("marks a month On Budget when actual is within ±5% of budget", () => {
    const rows = computeMonthlySummary([
      makeEntry({ uid: "a", month: 3, line_type: "budget", amount: "10000" }),
      makeEntry({ uid: "b", month: 3, line_type: "actual", amount: "10400" }),
    ]);
    expect(rows.find((r) => r.month === 3)!.status).toBe("On Budget");
  });

  it("marks a month Over Budget when actual exceeds budget by more than 5%", () => {
    const rows = computeMonthlySummary([
      makeEntry({ uid: "a", month: 4, line_type: "budget", amount: "10000" }),
      makeEntry({ uid: "b", month: 4, line_type: "actual", amount: "12000" }),
    ]);
    expect(rows.find((r) => r.month === 4)!.status).toBe("Over Budget");
  });

  it("marks a month Under Budget when actual is more than 5% below budget", () => {
    const rows = computeMonthlySummary([
      makeEntry({ uid: "a", month: 5, line_type: "budget", amount: "10000" }),
      makeEntry({ uid: "b", month: 5, line_type: "actual", amount: "8000" }),
    ]);
    expect(rows.find((r) => r.month === 5)!.status).toBe("Under Budget");
  });

  it("treats zero budget and zero actual as On Budget", () => {
    const rows = computeMonthlySummary([]);
    expect(rows[5].status).toBe("On Budget");
  });

  it("treats zero budget with a positive actual as Over Budget", () => {
    const rows = computeMonthlySummary([
      makeEntry({ uid: "a", month: 6, line_type: "actual", amount: "500" }),
    ]);
    expect(rows.find((r) => r.month === 6)!.status).toBe("Over Budget");
  });
});

describe("computeGrandTotal", () => {
  it("sums all 12 months and computes utilization", () => {
    const rows = computeMonthlySummary([
      makeEntry({ uid: "a", month: 1, line_type: "budget", amount: "10000" }),
      makeEntry({ uid: "b", month: 1, line_type: "actual", amount: "8000" }),
      makeEntry({ uid: "c", month: 2, line_type: "budget", amount: "10000" }),
      makeEntry({ uid: "d", month: 2, line_type: "actual", amount: "9000" }),
    ]);
    const total = computeGrandTotal(rows);
    expect(total.budgetTotal).toBe(20000);
    expect(total.actualTotal).toBe(17000);
    expect(total.remainingBudget).toBe(3000);
    expect(total.utilizationPct).toBeCloseTo(85, 5);
  });

  it("returns 0 utilization when there is no budget at all", () => {
    const total = computeGrandTotal(computeMonthlySummary([]));
    expect(total.utilizationPct).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/utils/budget.test.ts`
Expected: FAIL — `Cannot find module '@/utils/budget'`.

- [ ] **Step 3: Write the utility**

Create `frontend/task-tracker/src/utils/budget.ts`:

```ts
import type { BudgetLineItemDto } from "@/types/api/budget";

export type BudgetStatus = "Over Budget" | "Under Budget" | "On Budget";

export interface MonthlySummary {
  month: number; // 1-12
  budgetTotal: number;
  actualTotal: number;
  variance: number;
  variancePct: number;
  status: BudgetStatus;
}

export interface GrandTotal {
  budgetTotal: number;
  actualTotal: number;
  variance: number;
  variancePct: number;
  remainingBudget: number;
  utilizationPct: number;
}

const ON_BUDGET_TOLERANCE = 0.05; // ±5%

function statusFor(budgetTotal: number, actualTotal: number): BudgetStatus {
  if (budgetTotal === 0) {
    return actualTotal === 0 ? "On Budget" : "Over Budget";
  }
  const ratio = actualTotal / budgetTotal;
  if (ratio > 1 + ON_BUDGET_TOLERANCE) return "Over Budget";
  if (ratio < 1 - ON_BUDGET_TOLERANCE) return "Under Budget";
  return "On Budget";
}

/** Sums budget/actual line items into one row per month (1-12), computing
 *  variance, variance %, and status. Always returns exactly 12 rows —
 *  months with no items get zero totals. */
export function computeMonthlySummary(
  entries: readonly BudgetLineItemDto[],
): MonthlySummary[] {
  const budgetByMonth = new Map<number, number>();
  const actualByMonth = new Map<number, number>();
  for (const entry of entries) {
    const amount = Number.parseFloat(entry.amount) || 0;
    const map = entry.line_type === "budget" ? budgetByMonth : actualByMonth;
    map.set(entry.month, (map.get(entry.month) ?? 0) + amount);
  }
  const rows: MonthlySummary[] = [];
  for (let month = 1; month <= 12; month++) {
    const budgetTotal = budgetByMonth.get(month) ?? 0;
    const actualTotal = actualByMonth.get(month) ?? 0;
    const variance = actualTotal - budgetTotal;
    const variancePct = budgetTotal !== 0 ? (variance / budgetTotal) * 100 : 0;
    rows.push({
      month,
      budgetTotal,
      actualTotal,
      variance,
      variancePct,
      status: statusFor(budgetTotal, actualTotal),
    });
  }
  return rows;
}

/** Rolls the 12 monthly rows up into a single grand-total summary. */
export function computeGrandTotal(rows: readonly MonthlySummary[]): GrandTotal {
  const budgetTotal = rows.reduce((sum, r) => sum + r.budgetTotal, 0);
  const actualTotal = rows.reduce((sum, r) => sum + r.actualTotal, 0);
  const variance = actualTotal - budgetTotal;
  const variancePct = budgetTotal !== 0 ? (variance / budgetTotal) * 100 : 0;
  const remainingBudget = budgetTotal - actualTotal;
  const utilizationPct = budgetTotal !== 0 ? (actualTotal / budgetTotal) * 100 : 0;
  return { budgetTotal, actualTotal, variance, variancePct, remainingBudget, utilizationPct };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/utils/budget.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/utils/budget.ts frontend/task-tracker/src/__tests__/utils/budget.test.ts
git commit -m "feat(budget): add monthly Budget/Actual aggregation utility"
```

---

### Task 6: Frontend — BudgetVsActualPage UI

**Files:**
- Create: `frontend/task-tracker/src/pages/BudgetVsActualPage.tsx`

**Interfaces:**
- Consumes: `useBudget` (Task 4), `useMasters` (client dropdown), `computeMonthlySummary`/`computeGrandTotal` (Task 5).
- Produces: default-exported `BudgetVsActualPage({ profile, selectedOrg })` component (same prop shape as `CostingPage`).

- [ ] **Step 1: Verify current CostingPage prop/pattern**

Before writing this component, read `frontend/task-tracker/src/pages/CostingPage.tsx` in full — it's the direct template for this page's structure (filter bar, org-resolution `useMemo`, synchronous double-submit guard via `useRef`, modal shape, inline styles). Confirm its current prop signature (`{ profile, selectedOrg }`) matches what's used below.

- [ ] **Step 2: Write the component**

Create `frontend/task-tracker/src/pages/BudgetVsActualPage.tsx`:

```tsx
import { Fragment, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Profile } from "@/types";
import { useBudget } from "@/hooks/useBudget";
import { useMasters } from "@/hooks/useMasters";
import { computeGrandTotal, computeMonthlySummary, type MonthlySummary } from "@/utils/budget";
import type { BudgetLineItemDto, BudgetLineType } from "@/types/api/budget";

interface BudgetVsActualPageProps {
  profile: Profile | null;
  /** Header-org filter, threaded into new-entry POSTs the same way
   *  CostingPage/InvoicePage do — otherwise ``resolve_create_org`` 400s
   *  with "you belong to multiple orgs" for multi-org admins. */
  selectedOrg?: string;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface ItemFormState {
  description: string;
  amount: string;
}

const EMPTY_ITEM: ItemFormState = { description: "", amount: "" };

function currentYear(): number {
  return new Date().getFullYear();
}

const thS: CSSProperties = {
  padding: "8px 12px",
  textAlign: "left",
  fontWeight: 700,
  color: "#475569",
  fontSize: 11,
  borderBottom: "2px solid #e2e8f0",
  whiteSpace: "nowrap",
  background: "#f8fafc",
};
const tdS: CSSProperties = {
  padding: "8px 12px",
  color: "#374151",
  verticalAlign: "middle",
  fontSize: 13,
  borderBottom: "1px solid #f1f5f9",
};
const inpS: CSSProperties = {
  padding: "8px 10px",
  border: "2px solid #e2e8f0",
  borderRadius: 6,
  fontSize: 13,
  width: "100%",
  boxSizing: "border-box",
  background: "#fff",
  fontFamily: "inherit",
};
const labelS: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "#475569",
  display: "block",
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: ".5px",
};

function badgeStyle(status: MonthlySummary["status"]): CSSProperties {
  return {
    display: "inline-block",
    padding: "3px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    color: "#fff",
    background:
      status === "Over Budget" ? "#dc2626" : status === "Under Budget" ? "#d97706" : "#16a34a",
  };
}

export default function BudgetVsActualPage({ selectedOrg }: BudgetVsActualPageProps) {
  const { clients } = useMasters();
  const [selectedClient, setSelectedClient] = useState<string>("");
  const [financialYear, setFinancialYear] = useState<number>(currentYear());
  const { entries, loading, saving, createEntry, editEntry, removeEntry } = useBudget(
    selectedClient || null,
    selectedClient ? financialYear : null,
  );

  const [expandedMonth, setExpandedMonth] = useState<number | null>(null);
  const [modal, setModal] = useState<{
    month: number;
    lineType: BudgetLineType;
    row?: BudgetLineItemDto;
  } | null>(null);
  const [form, setForm] = useState<ItemFormState>(EMPTY_ITEM);
  const [deletingUid, setDeletingUid] = useState<string | null>(null);

  const monthlyRows = useMemo(() => computeMonthlySummary(entries), [entries]);
  const grandTotal = useMemo(() => computeGrandTotal(monthlyRows), [monthlyRows]);

  const activeOrgUid = useMemo(() => {
    const client = clients.find((c) => c.id === selectedClient);
    const clientOrgUid =
      client?.orgs && client.orgs.length ? client.orgs[0] : (client?.org ?? null);
    return selectedOrg || clientOrgUid || null;
  }, [clients, selectedClient, selectedOrg]);

  const yearOptions = useMemo(() => {
    const base = currentYear();
    return [base - 2, base - 1, base, base + 1, base + 2];
  }, []);

  const itemsFor = (month: number, lineType: BudgetLineType): BudgetLineItemDto[] =>
    entries.filter((e) => e.month === month && e.line_type === lineType);

  const openAddItem = (month: number, lineType: BudgetLineType): void => {
    setForm(EMPTY_ITEM);
    setModal({ month, lineType });
  };

  const openEditItem = (row: BudgetLineItemDto): void => {
    setForm({ description: row.description, amount: row.amount });
    setModal({ month: row.month, lineType: row.line_type, row });
  };

  const closeModal = (): void => setModal(null);

  // Synchronous re-entrancy guard — see CostingPage.tsx's identical
  // isSavingRef for why `saving` (async state) alone isn't enough to
  // prevent a fast double-click from submitting the same item twice.
  const isSavingRef = useRef(false);

  const handleSaveItem = async (): Promise<void> => {
    if (isSavingRef.current || !modal) return;
    if (!selectedClient) {
      alert("Select a client first");
      return;
    }
    if (!form.amount) {
      alert("Amount is required");
      return;
    }
    isSavingRef.current = true;
    try {
      if (modal.row) {
        await editEntry(modal.row.uid, {
          description: form.description,
          amount: form.amount || 0,
        });
      } else {
        await createEntry({
          ...(activeOrgUid ? { org: activeOrgUid } : {}),
          client: selectedClient,
          financial_year: financialYear,
          month: modal.month,
          line_type: modal.lineType,
          description: form.description,
          amount: form.amount || 0,
        });
      }
      closeModal();
    } catch (err) {
      alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      isSavingRef.current = false;
    }
  };

  const handleDeleteItem = async (row: BudgetLineItemDto): Promise<void> => {
    if (!window.confirm("Delete this line item?")) return;
    setDeletingUid(row.uid);
    try {
      await removeEntry(row.uid);
    } catch (err) {
      alert(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeletingUid(null);
    }
  };

  return (
    <div style={{ padding: "10px 16px", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ marginBottom: 12 }}>
        <div className="page-title">📊 Budget vs Actual</div>
      </div>

      <div
        className="dm-filter-bar"
        style={{
          background: "#fff",
          borderRadius: 8,
          padding: "8px 14px",
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 12,
          border: "1px solid #e2e8f0",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <label style={{ ...labelS, marginBottom: 0 }}>Financial Year</label>
          <select
            style={{ ...inpS, maxWidth: 140 }}
            value={financialYear}
            onChange={(e) => setFinancialYear(Number(e.target.value))}
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <label style={{ ...labelS, marginBottom: 0 }}>Client</label>
          <select
            style={{ ...inpS, maxWidth: 260 }}
            value={selectedClient}
            onChange={(e) => {
              setSelectedClient(e.target.value);
              setExpandedMonth(null);
            }}
          >
            <option value="">Select a client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!selectedClient && (
        <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>
          Select a financial year and client to view the budget report.
        </div>
      )}

      {selectedClient && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(5, 1fr)",
              gap: 10,
              marginBottom: 14,
            }}
          >
            {(
              [
                ["Total Budget", grandTotal.budgetTotal.toFixed(2)],
                ["Total Actual", grandTotal.actualTotal.toFixed(2)],
                ["Remaining Budget", grandTotal.remainingBudget.toFixed(2)],
                ["Total Variance", grandTotal.variance.toFixed(2)],
                ["Budget Utilization", `${grandTotal.utilizationPct.toFixed(1)}%`],
              ] as const
            ).map(([label, value]) => (
              <div
                key={label}
                style={{
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  padding: "10px 14px",
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#94a3b8",
                    textTransform: "uppercase",
                  }}
                >
                  {label}
                </div>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#1e293b" }}>{value}</div>
              </div>
            ))}
          </div>

          <div
            className="sticky-table-wrap dm-box"
            style={{
              background: "#fff",
              borderRadius: 10,
              border: "1px solid #e2e8f0",
              boxShadow: "0 1px 4px rgba(0,0,0,.06)",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={thS}>Month</th>
                  <th style={{ ...thS, width: 120 }}>Budget</th>
                  <th style={{ ...thS, width: 120 }}>Actual</th>
                  <th style={{ ...thS, width: 120 }}>Variance</th>
                  <th style={{ ...thS, width: 110 }}>Variance %</th>
                  <th style={{ ...thS, width: 130 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={6} style={{ ...tdS, textAlign: "center", padding: 30, color: "#94a3b8" }}>
                      Loading…
                    </td>
                  </tr>
                )}
                {!loading &&
                  monthlyRows.map((row) => (
                    <Fragment key={row.month}>
                      <tr
                        onClick={() => setExpandedMonth(expandedMonth === row.month ? null : row.month)}
                        style={{ cursor: "pointer" }}
                      >
                        <td style={{ ...tdS, fontWeight: 600, color: "#1e293b" }}>
                          {expandedMonth === row.month ? "▾" : "▸"} {MONTH_NAMES[row.month - 1]}
                        </td>
                        <td style={tdS}>{row.budgetTotal.toFixed(2)}</td>
                        <td style={tdS}>{row.actualTotal.toFixed(2)}</td>
                        <td style={tdS}>{row.variance.toFixed(2)}</td>
                        <td style={tdS}>{row.variancePct.toFixed(1)}%</td>
                        <td style={tdS}>
                          <span style={badgeStyle(row.status)}>{row.status}</span>
                        </td>
                      </tr>
                      {expandedMonth === row.month && (
                        <tr>
                          <td colSpan={6} style={{ ...tdS, background: "#f8fafc", padding: 16 }}>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
                              {(["budget", "actual"] as const).map((lineType) => (
                                <div key={lineType}>
                                  <div
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      alignItems: "center",
                                      marginBottom: 8,
                                    }}
                                  >
                                    <span style={{ fontWeight: 700, textTransform: "capitalize" }}>
                                      {lineType} items
                                    </span>
                                    <button
                                      onClick={() => openAddItem(row.month, lineType)}
                                      style={{
                                        padding: "4px 10px",
                                        background: "#2563eb",
                                        color: "#fff",
                                        border: "none",
                                        borderRadius: 6,
                                        cursor: "pointer",
                                        fontSize: 12,
                                        fontWeight: 700,
                                      }}
                                    >
                                      + Add
                                    </button>
                                  </div>
                                  {itemsFor(row.month, lineType).length === 0 && (
                                    <div style={{ color: "#94a3b8", fontSize: 12 }}>No items yet.</div>
                                  )}
                                  {itemsFor(row.month, lineType).map((item) => (
                                    <div
                                      key={item.uid}
                                      style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                        padding: "6px 0",
                                        borderBottom: "1px solid #e2e8f0",
                                      }}
                                    >
                                      <span>{item.description || "—"}</span>
                                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <strong>{item.amount}</strong>
                                        <button
                                          onClick={() => openEditItem(item)}
                                          title="Edit"
                                          style={{ background: "none", border: "none", cursor: "pointer" }}
                                        >
                                          ✏️
                                        </button>
                                        <button
                                          onClick={() => void handleDeleteItem(item)}
                                          title="Delete"
                                          disabled={deletingUid === item.uid || saving}
                                          style={{ background: "none", border: "none", cursor: "pointer" }}
                                        >
                                          🗑️
                                        </button>
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                {!loading && (
                  <tr style={{ background: "#f8fafc", fontWeight: 800 }}>
                    <td style={tdS}>Grand Total</td>
                    <td style={tdS}>{grandTotal.budgetTotal.toFixed(2)}</td>
                    <td style={tdS}>{grandTotal.actualTotal.toFixed(2)}</td>
                    <td style={tdS}>{grandTotal.variance.toFixed(2)}</td>
                    <td style={tdS}>{grandTotal.variancePct.toFixed(1)}%</td>
                    <td style={tdS}>—</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {modal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={closeModal}
        >
          <div
            className="dm-modal-card"
            style={{
              background: "#fff",
              borderRadius: 14,
              padding: 28,
              minWidth: 340,
              maxWidth: 420,
              boxShadow: "0 20px 60px rgba(0,0,0,.25)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 20,
              }}
            >
              <span style={{ fontWeight: 800, fontSize: 18 }}>
                {modal.row ? "✏️ Edit" : "➕ Add"} {modal.lineType === "budget" ? "Budget" : "Actual"} Item —{" "}
                {MONTH_NAMES[modal.month - 1]}
              </span>
              <button
                onClick={closeModal}
                style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#64748b" }}
              >
                ✕
              </button>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={labelS}>Description</label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                style={inpS}
                autoFocus
              />
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={labelS}>Amount *</label>
              <input
                type="number"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                style={inpS}
              />
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={closeModal}
                style={{
                  padding: "8px 18px",
                  border: "1px solid #e2e8f0",
                  background: "#f8fafc",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: 13,
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSaveItem()}
                disabled={saving}
                style={{
                  padding: "8px 18px",
                  background: "#2563eb",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 13,
                  opacity: saving ? 0.7 : 1,
                }}
              >
                {saving ? "Saving…" : modal.row ? "Update" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `cd frontend/task-tracker && npx tsc -b`
Expected: clean, no output.

Run: `cd frontend/task-tracker && npx eslint src/pages/BudgetVsActualPage.tsx`
Expected: clean, no output.

- [ ] **Step 4: Run the full frontend suite as a regression check**

Run: `cd frontend/task-tracker && npx vitest run`
Expected: all tests pass (no regressions; this component has no dedicated test per the established Costing precedent — `CostingPage.tsx` has none either — verified manually per Step 5).

- [ ] **Step 5: Manual verification**

This page isn't wired into the nav yet (that's Task 7), so it can't be reached via the UI. If a way exists to preview it in isolation, use it; otherwise note in your report that this is deferred to Task 7's end-to-end check, per the same pattern used for `CostingPage.tsx` (Task 9) in the prior Costing feature.

- [ ] **Step 6: Commit**

```bash
git add frontend/task-tracker/src/pages/BudgetVsActualPage.tsx
git commit -m "feat(budget): add BudgetVsActualPage UI"
```

---

### Task 7: Wire Budget vs Actual into the top-level nav

**Files:**
- Modify: `frontend/task-tracker/src/App.tsx`, `frontend/task-tracker/src/components/header/NavMenu.tsx`, `frontend/task-tracker/src/components/layout/Header.tsx`

**Interfaces:**
- Consumes: `BudgetVsActualPage` (Task 6), menu code `"budget"` (Task 1), `navVisible`/`canView` from `usePermissions`.
- Produces: "Budget vs Actual" appears as a top-level nav tab right after Costing, gated by `budget_access`/menu rights, rendering `BudgetVsActualPage` when selected.

- [ ] **Step 1: Add the lazy import**

In `frontend/task-tracker/src/App.tsx`, find `const CostingPage = lazy(() => import("./pages/CostingPage"));` and add directly after it:

```tsx
const BudgetVsActualPage = lazy(() => import("./pages/BudgetVsActualPage"));
```

- [ ] **Step 2: Add to `navVisible`**

In the array passed to the `navVisible` `useMemo` (it currently reads `"board", "dashboard", "calendar", "worklog", "costing", "leads", "clients",` on its first line), add `"budget"` directly after `"costing"`:

```tsx
const navVisible = useMemo(
  () =>
    Object.fromEntries(
      [
        "board", "dashboard", "calendar", "worklog", "costing", "budget", "leads", "clients",
        "notice", "invoice", "conveyance", "masters", "holidays", "employee",
        "pace", "growthplan", "kaizen", "users", "settings",
      ].map((code) => [code, canView(code)]),
    ) as Record<string, boolean>,
  [canView],
);
```

(Read the actual current array before editing — confirm it still matches this exactly, since other tasks/commits may have touched it since this plan was written.)

- [ ] **Step 3: Register in `VIEW_MAP`**

Find `costing: navVisible.costing ? (<CostingPage profile={profile} selectedOrg={selectedOrg} />) : null,` in the `VIEW_MAP` object and add directly after it:

```tsx
    budget: navVisible.budget ? (
      <BudgetVsActualPage profile={profile} selectedOrg={selectedOrg} />
    ) : null,
```

- [ ] **Step 4: Add the nav icon**

In `frontend/task-tracker/src/components/layout/Header.tsx`, find the `costing:` entry in the `const icons = { ... }` object (it ends with a closing `),` right before `users:`) and add a `budget` entry directly after it:

```tsx
    budget: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M8 17V11" />
        <path d="M12 17V7" />
        <path d="M16 17v-4" />
      </svg>
    ),
```

- [ ] **Step 5: Add the nav tab**

In `frontend/task-tracker/src/components/header/NavMenu.tsx`, find the `costing` entry in `NAV_TABS_RAW` (`...(show("costing") ? [{ id: "costing", label: "Costing", icon: icons.costing }] : []),`) and add directly after it:

```tsx
      ...(show("budget") ? [{ id: "budget", label: "Budget vs Actual", icon: icons.budget }] : []),
```

- [ ] **Step 6: Manual verification**

Run: `cd frontend/task-tracker && npm run dev`, and separately `uv run python manage.py runserver` for the backend.

1. Log in as `admin@example.com` / `admin@123` (admin — sees Budget vs Actual automatically).
2. Confirm "Budget vs Actual" appears in the top nav, directly after "Costing".
3. Click it, pick a Financial Year and a Client (create one under Masters → Clients first if none exist).
4. Click a month row to expand it, click "+ Add" under Budget items, enter a description + amount, save. Confirm the row appears and the month's Budget total, Variance, and Status update.
5. Add an Actual item for the same month; confirm Variance/Variance %/Status recompute correctly (per the ±5% tolerance rule).
6. Edit an item, change its amount, save, confirm the table updates.
7. Delete an item, confirm it disappears and totals recompute.
8. Confirm the Grand Total row sums correctly across all 12 months.
9. If reachable in this environment, check the User Rights / admin area to confirm "Budget vs Actual" appears as a grantable per-user permission (menu code `budget` from Task 1).

If browser automation isn't available, verify via direct API calls (login → create a few `BudgetLineItem` rows across different months/types → list them back → confirm the response shape matches what the frontend expects) and say explicitly in your report what was and wasn't verified.

- [ ] **Step 7: Run the full test suites as a final regression check**

Run: `uv run python manage.py test` from the project root.
Expected: all tests pass (expect noisy, harmless `broadcast to '...' failed` / `redis.exceptions.ConnectionError` tracebacks if no local Redis is running — only real FAILED/ERROR lines matter).

Run: `cd frontend/task-tracker && npx vitest run`
Expected: all tests pass.

Run: `cd frontend/task-tracker && npx tsc -b`
Expected: clean.

Run: `uv run ruff check . && uv run ruff format --check .` from the project root.
Expected: clean (fix with `uv run ruff check --fix .` / `uv run ruff format .` if not, matching the exact pattern used to fix the Costing feature's CI failures).

Run: `uv run mypy core/budget users/models.py core/permissions.py` and `uv run pyright core/budget users/models.py core/permissions.py`.
Expected: clean.

Run: `uv run python manage.py makemigrations --check --dry-run`.
Expected: `No changes detected`.

- [ ] **Step 8: Commit**

```bash
git add frontend/task-tracker/src/App.tsx frontend/task-tracker/src/components/header/NavMenu.tsx frontend/task-tracker/src/components/layout/Header.tsx
git commit -m "feat(budget): wire Budget vs Actual into the top-level nav"
```
