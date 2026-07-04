# Costing Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-client "Costing" sheet (top-level nav item, gated by a new `costing_access` permission) where a user picks a client and maintains rows of Designation / Hr-Day / Days-Working / auto-computed Total, plus a new Designation master list that Employees can also be tagged with.

**Architecture:** Reuse the existing `masters.Master` model as the source of both Clients and the new Designations (add `"designation"` to its `TYPE_CHOICES`). Add a new small Django app `core/costing` holding one model (`CostingEntry`) following the exact `core/invoices` CRUD-viewset pattern (`UidLookupMixin`, `scoped()`/`resolve_create_org`, `core.realtime.broadcast`). Gate the whole feature with a new `costing_access` boolean on `OrgMembership` (mirroring `invoice_access` etc.) plus a matching top-level `MenuNode("costing", ...)` in the menu catalog, so it shows in the User Rights matrix and can be granted per-user. On the frontend, add a "Designations" tab to the existing Masters page, add a Designation dropdown to the Employee form, and build a new `CostingPage` following the `MonthlyReports`-style hook/api-client/page trio, wired into the nav exactly like `InvoicePage`.

**Tech Stack:** Django 5 / DRF (`core/*` apps), SQLite dev DB, React + TypeScript (Vite), Vitest for frontend tests, Django `TestCase` + DRF `APIClient` for backend tests.

## Global Constraints

- `uid` (UUID) is always the external identifier in URLs — every new viewset mixes in `UidLookupMixin` (`core/base.py`), never exposing the integer PK.
- Every org-scoped model/viewset must filter through the caller's orgs — use `core.org_utils.scoped()` / `resolve_create_org()`, never trust a client-supplied org blindly.
- Every mutating viewset action broadcasts via `core.realtime.broadcast(channel, event_type, payload)` on create/update/delete, matching every existing app.
- New DRF fields that reference another model use `SlugRelatedField(slug_field="uid", ...)` so the wire format never leaks integer PKs.
- Migrations are additive (`AddField`) except where an existing `CheckConstraint` must be widened (`RemoveConstraint` → `AlterField` → `AddConstraint`), matching `core/masters/migrations/0003_...`.
- Frontend API functions live in `src/lib/api/<feature>.ts`, hooks in `src/hooks/use<Feature>.ts`, DTOs/forms in `src/types/api/<feature>.ts` — never inline `fetch()` calls in components.
- No currency/rate concept in Costing — `Total = Hr/Day + Days Working`, a plain numeric sum, not a monetary calculation (per spec).

---

## File Structure

**Backend — modified:**
- `core/masters/models.py` — add `"designation"` to `Master.TYPE_CHOICES` + widen `master_type_valid` constraint
- `core/masters/migrations/` — new migration for the above
- `core/employees/models.py` — add `Employee.designation` FK
- `core/employees/migrations/` — new migration for the above
- `core/employees/serializers.py` — expose `designation` (+ `designation_detail`) on `EmployeeSerializer`
- `users/models.py` — add `"costing_access"` to `ACCESS_FEATURES`, add `OrgMembership.costing_access(_granted_by/_at)`, add `User.has_costing_in`/`has_costing_in_any`
- `users/migrations/` — new migration for the `OrgMembership` fields
- `users/menu_catalog.py` — add `MenuNode("costing", "Costing", None)`, `MenuNode("masters.designations", "Designations", "masters")`, `"costing_access": "costing"` in `FEATURE_TO_CODE`
- `core/permissions.py` — add `IsAdminOrCostingAccess`
- `config/settings.py` — add `"core.costing"` to `INSTALLED_APPS`
- `config/urls.py` — add `path("api/", include("core.costing.urls"))`

**Backend — new:**
- `core/costing/__init__.py`, `core/costing/apps.py` — standard Django app scaffold
- `core/costing/models.py` — `CostingEntry`
- `core/costing/migrations/0001_initial.py`
- `core/costing/serializers.py` — `CostingEntrySerializer`
- `core/costing/views.py` — `CostingEntryViewSet`
- `core/costing/urls.py`
- `core/costing/tests.py`

**Frontend — modified:**
- `frontend/task-tracker/src/types/api/master.ts` — widen `MasterTypeValue`
- `frontend/task-tracker/src/hooks/useMasters.ts` — add `designations` list alongside `clients`/`cats`
- `frontend/task-tracker/src/pages/MastersPage.tsx` — add `"designations"` tab
- `frontend/task-tracker/src/components/employee/EmpModal.tsx` — add Designation dropdown field
- `frontend/task-tracker/src/utils/employee.ts` — nothing structural (designations now come from the master list, fetched via `useMasters`, not a static const)
- `frontend/task-tracker/src/hooks/useEmployees.ts` — map `designation_detail`/`designation` through to the domain `Employee` type, and include `designation` (uid) in create/update payload
- `frontend/task-tracker/src/types/api/index.ts` — `export * from "./costing";`
- `frontend/task-tracker/src/App.tsx` — lazy-import `CostingPage`, add `"costing"` to the `navVisible` code list, add `costing` to `VIEW_MAP`
- `frontend/task-tracker/src/components/layout/Header.tsx` — add a `costing` SVG icon to the `icons` map
- `frontend/task-tracker/src/components/header/NavMenu.tsx` — add the `costing` tab entry

**Frontend — new:**
- `frontend/task-tracker/src/types/api/costing.ts` — `CostingEntryDto`, `CostingEntryCreateForm`, `CostingEntryEditForm`
- `frontend/task-tracker/src/lib/api/costing.ts` — `listCostingEntries`, `createCostingEntry`, `editCostingEntry`, `deleteCostingEntry`
- `frontend/task-tracker/src/hooks/useCosting.ts` — state + CRUD + websocket subscription
- `frontend/task-tracker/src/pages/CostingPage.tsx` — client dropdown + table + add/edit/delete
- `frontend/task-tracker/src/__tests__/hooks/useCosting.test.ts`

---

### Task 1: Designation as a Master type

**Files:**
- Modify: `core/masters/models.py:14-17` (TYPE_CHOICES), `core/masters/models.py:101-105` (CheckConstraint)
- Create: `core/masters/migrations/0005_master_designation_type.py` (next number after the last existing migration — verify with `python manage.py showmigrations masters` before naming the file)
- Test: `core/masters/tests.py`

**Interfaces:**
- Produces: `Master.objects.create(name=..., type="designation", org=...)` now valid; `Master.TYPE_CHOICES` includes `("designation", "Designation")`.

- [ ] **Step 1: Write the failing test**

Add to `core/masters/tests.py`:

```python
class MasterDesignationTypeTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="Org-Designation")
        self.admin = User.objects.create_user(username="desig-admin", password="pw", full_name="Desig Admin")
        OrgMembership.objects.create(user=self.admin, org=self.org, role="admin")
        self.client_api = APIClient()
        _auth(self.client_api, self.admin)

    def test_create_designation_master_succeeds(self):
        res = self.client_api.post(
            "/api/masters/",
            {
                "name": "Senior Consultant",
                "type": "designation",
                "org": str(self.org.uid),
                "orgs": [str(self.org.uid)],
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data["type"], "designation")

    def test_designation_model_check_constraint_allows_type(self):
        m = Master.objects.create(name="Analyst", type="designation", org=self.org)
        self.assertEqual(m.type, "designation")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run python manage.py test core.masters.tests.MasterDesignationTypeTests -v 2`
Expected: FAIL — `django.db.utils.IntegrityError` or DRF 400, because `"designation"` isn't in `TYPE_CHOICES` / violates `master_type_valid`.

- [ ] **Step 3: Update the model**

In `core/masters/models.py`, change:

```python
    TYPE_CHOICES = [
        ("client", "Client"),
        ("category", "Category"),
    ]
```
to:
```python
    TYPE_CHOICES = [
        ("client", "Client"),
        ("category", "Category"),
        ("designation", "Designation"),
    ]
```

And change the constraint:
```python
            models.CheckConstraint(
                condition=models.Q(type__in=["client", "category"]),
                name="master_type_valid",
            ),
```
to:
```python
            models.CheckConstraint(
                condition=models.Q(type__in=["client", "category", "designation"]),
                name="master_type_valid",
            ),
```

- [ ] **Step 4: Generate and inspect the migration**

Run: `uv run python manage.py makemigrations masters --name master_designation_type`

Confirm the generated file (rename only if `makemigrations` doesn't already produce this exact shape) contains:

```python
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("masters", "0004_alter_master_orgs"),  # use the actual last migration name from showmigrations
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="master",
            name="master_type_valid",
        ),
        migrations.AlterField(
            model_name="master",
            name="type",
            field=models.CharField(
                choices=[("client", "Client"), ("category", "Category"), ("designation", "Designation")],
                db_index=True,
                max_length=20,
            ),
        ),
        migrations.AddConstraint(
            model_name="master",
            constraint=models.CheckConstraint(
                condition=models.Q(("type__in", ["client", "category", "designation"])),
                name="master_type_valid",
            ),
        ),
    ]
```

- [ ] **Step 5: Apply the migration**

Run: `uv run python manage.py migrate masters`
Expected: `Applying masters.000X_master_designation_type... OK`

- [ ] **Step 6: Run test to verify it passes**

Run: `uv run python manage.py test core.masters.tests.MasterDesignationTypeTests -v 2`
Expected: PASS (2 tests)

- [ ] **Step 7: Commit**

```bash
git add core/masters/models.py core/masters/migrations/ core/masters/tests.py
git commit -m "feat(masters): add designation as a Master type"
```

---

### Task 2: Employee.designation field

**Files:**
- Modify: `core/employees/models.py:27-99` (Employee model), `core/employees/serializers.py:46-` (EmployeeSerializer)
- Create: `core/employees/migrations/000X_employee_designation.py`
- Test: `core/employees/tests.py` (create the file if it doesn't already exist — check with `Glob core/employees/test*.py` first; if `test_employee_api.py` or similar already exists, add the test class there instead)

**Interfaces:**
- Consumes: `masters.Master` (Task 1) with `type="designation"`.
- Produces: `Employee.designation` (nullable FK to `Master`), `EmployeeSerializer` fields `designation` (write: uid) and `designation_detail` (read: `{uid, name}`).

- [ ] **Step 1: Write the failing test**

```python
from core.masters.models import Master
from core.employees.models import Employee

class EmployeeDesignationTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="Org-EmpDesig")
        self.admin = User.objects.create_user(username="emp-desig-admin", password="pw", full_name="Admin")
        OrgMembership.objects.create(user=self.admin, org=self.org, role="admin", employee_access=True)
        self.designation = Master.objects.create(name="Team Lead", type="designation", org=self.org)
        self.client_api = APIClient()
        self.client_api.force_authenticate(user=self.admin)

    def test_create_employee_with_designation(self):
        res = self.client_api.post(
            "/api/employees/",
            {
                "employee_name": "Priya",
                "org": str(self.org.uid),
                "designation": str(self.designation.uid),
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data["designation_detail"]["name"], "Team Lead")
        emp = Employee.objects.get(uid=res.data["uid"])
        self.assertEqual(emp.designation_id, self.designation.id)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run python manage.py test core.employees.tests.EmployeeDesignationTests -v 2`
Expected: FAIL — `TypeError`/400, `Employee` has no field `designation`.

- [ ] **Step 3: Add the field to the model**

In `core/employees/models.py`, add after the `status` field (line 84):

```python
    designation = models.ForeignKey(
        "masters.Master",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="employees_with_designation",
        limit_choices_to={"type": "designation"},
    )
```

- [ ] **Step 4: Generate and apply the migration**

Run: `uv run python manage.py makemigrations employees --name employee_designation`
Run: `uv run python manage.py migrate employees`
Expected: `Applying employees.000X_employee_designation... OK`

- [ ] **Step 5: Expose the field on the serializer**

In `core/employees/serializers.py`, add near the top (below the existing imports):

```python
from core.masters.models import Master
from core.masters.serializers import MasterMinSerializer
```

In `EmployeeSerializer`, add a field and include it in `Meta.fields`:

```python
class EmployeeSerializer(serializers.ModelSerializer):
    salary_records = EmployeeSalarySerializer(many=True, read_only=True)
    user_detail = UserMinSerializer(source="user", read_only=True)
    address_proof_url = serializers.SerializerMethodField()
    designation = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Master.objects.filter(type="designation"),
        required=False,
        allow_null=True,
    )
    designation_detail = MasterMinSerializer(source="designation", read_only=True)

    class Meta:
        model = Employee
        fields = [
            "id",
            "uid",
            "user_detail",
            "employee_name",
            "status",
            "designation",
            "designation_detail",
            "date_of_joining",
            ... # keep every existing field name from the current Meta.fields list unchanged
        ]
```

(Insert `"designation"` and `"designation_detail"` into the existing `fields` list right after `"status"` — do not remove or reorder any pre-existing field.)

- [ ] **Step 6: Run test to verify it passes**

Run: `uv run python manage.py test core.employees.tests.EmployeeDesignationTests -v 2`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add core/employees/models.py core/employees/migrations/ core/employees/serializers.py core/employees/tests.py
git commit -m "feat(employees): add designation field backed by the Designation master list"
```

---

### Task 3: `costing_access` permission infrastructure

**Files:**
- Modify: `users/models.py` (ACCESS_FEATURES, OrgMembership, User helpers), `users/menu_catalog.py`, `core/permissions.py`
- Create: `users/migrations/000X_orgmembership_costing_access.py` (dependency on the latest existing migration — check with `python manage.py showmigrations users`, likely depends on `0007_backfill_menu_rights`)
- Test: `users/tests.py` (check `Glob users/test*.py` for the right existing file first — likely `users/test_user_rights_api.py` or a plain `users/tests.py`; add to whichever already covers `ACCESS_FEATURES`/permissions, else create `users/tests.py`)

**Interfaces:**
- Produces: `OrgMembership.costing_access: bool`, `User.has_costing_in(org) -> bool`, `User.has_costing_in_any() -> bool`, `core.permissions.IsAdminOrCostingAccess`, menu code `"costing"`.

- [ ] **Step 1: Write the failing test**

```python
from users.models import ACCESS_FEATURES

class CostingAccessTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="Org-Costing-Access")
        self.admin = User.objects.create_user(username="cost-admin", password="pw", full_name="Admin")
        OrgMembership.objects.create(user=self.admin, org=self.org, role="admin")
        self.plain = User.objects.create_user(username="cost-plain", password="pw", full_name="Plain")
        OrgMembership.objects.create(user=self.plain, org=self.org, role="employee")
        self.granted = User.objects.create_user(username="cost-granted", password="pw", full_name="Granted")
        OrgMembership.objects.create(user=self.granted, org=self.org, role="employee", costing_access=True)

    def test_costing_access_in_features_tuple(self):
        self.assertIn("costing_access", ACCESS_FEATURES)

    def test_admin_has_costing_access(self):
        self.assertTrue(self.admin.has_costing_in(self.org))

    def test_plain_employee_lacks_costing_access(self):
        self.assertFalse(self.plain.has_costing_in(self.org))

    def test_granted_employee_has_costing_access(self):
        self.assertTrue(self.granted.has_costing_in(self.org))
        self.assertTrue(self.granted.has_costing_in_any())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run python manage.py test users.tests.CostingAccessTests -v 2`
Expected: FAIL — `AttributeError: 'OrgMembership' object has no attribute 'costing_access'` (or `ImportError`/`AssertionError` on the tuple check).

- [ ] **Step 3: Add `costing_access` to `ACCESS_FEATURES`**

In `users/models.py`:

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
)
```

- [ ] **Step 4: Add the `OrgMembership` fields**

In `users/models.py`, in the `OrgMembership` class, add alongside the existing `conveyance_access` block:

```python
    costing_access = models.BooleanField(default=False)
    costing_access_granted_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    costing_access_granted_at = models.DateTimeField(null=True, blank=True)
```

- [ ] **Step 5: Add the `User` helper methods**

In `users/models.py`, on the `User` class, alongside `has_invoice_in`/`has_invoice_in_any`:

```python
    # Costing access
    def has_costing_in(self, org) -> bool:
        return self._has_access_in("costing_access", org)

    def has_costing_in_any(self) -> bool:
        return self._has_access_in_any("costing_access")
```

- [ ] **Step 6: Register the menu code**

In `users/menu_catalog.py`, add to `MENU_CATALOG` (after the `conveyance.*` block, before `masters`):

```python
    MenuNode("costing", "Costing", None),
```

And add a Designations tab under Masters (after `MenuNode("masters.team", "Team Members", "masters")`):

```python
    MenuNode("masters.designations", "Designations", "masters"),
```

Add to `FEATURE_TO_CODE`:

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
}
```

- [ ] **Step 7: Add the permission class**

In `core/permissions.py`, add after `IsAdminOrEmployeeAccess`:

```python
class IsAdminOrCostingAccess(permissions.BasePermission):
    """Costing gate — mirrors IsAdminOrEmployeeAccess for the costing_access flag."""

    def has_permission(self, request, view):
        if request.method in permissions.SAFE_METHODS:
            return request.user.is_authenticated
        u = _as_user(request)
        return bool(u and (u.is_admin_in_any() or u.has_costing_in_any()))

    def has_object_permission(self, request, view, obj):
        if request.method in permissions.SAFE_METHODS:
            return True
        u = _as_user(request)
        org = _access_org(obj)
        return bool(u and (u.is_admin_in(org) or u.has_costing_in(org)))
```

Note: for GET requests this permission only checks `is_authenticated`, same as `IsAdminOrEmployeeAccess` — actual row visibility is enforced by the viewset's `get_queryset` org-scoping (see Task 5), not by this permission class.

- [ ] **Step 8: Generate and apply the migration**

Run: `uv run python manage.py makemigrations users --name orgmembership_costing_access`
Run: `uv run python manage.py migrate users`
Expected: `Applying users.000X_orgmembership_costing_access... OK`

- [ ] **Step 9: Run test to verify it passes**

Run: `uv run python manage.py test users.tests.CostingAccessTests -v 2`
Expected: PASS (4 tests)

- [ ] **Step 10: Commit**

```bash
git add users/models.py users/menu_catalog.py users/migrations/ core/permissions.py users/tests.py
git commit -m "feat(users): add costing_access permission, menu entry, and Designations masters tab code"
```

---

### Task 4: `CostingEntry` model

**Files:**
- Create: `core/costing/__init__.py`, `core/costing/apps.py`, `core/costing/models.py`, `core/costing/migrations/__init__.py`, `core/costing/migrations/0001_initial.py`, `core/costing/tests.py`
- Modify: `config/settings.py` (`INSTALLED_APPS`)

**Interfaces:**
- Consumes: `masters.Master` (`type="client"` and `type="designation"`, Task 1), `users.Org`.
- Produces: `CostingEntry` model with `uid`, `org`, `client`, `designation`, `hr_day` (Decimal), `days_working` (Decimal), `total` (Decimal, auto-computed in `save()`), `created_by`, timestamps.

- [ ] **Step 1: Scaffold the app**

Create `core/costing/__init__.py` (empty file).

Create `core/costing/apps.py`:

```python
from django.apps import AppConfig


class CostingConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "core.costing"
```

Create `core/costing/migrations/__init__.py` (empty file).

- [ ] **Step 2: Register the app**

In `config/settings.py`, add `"core.costing",` to `INSTALLED_APPS` (after `"core.invoices",`, matching the existing grouping):

```python
    "core.invoices",
    "core.costing",
    "core.kaizen",
```

- [ ] **Step 3: Write the failing test**

Create `core/costing/tests.py`:

```python
from decimal import Decimal

from django.test import TestCase

from core.masters.models import Master
from users.models import Org

from .models import CostingEntry


class CostingEntryModelTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="Org-Costing")
        self.client_master = Master.objects.create(name="Acme", type="client", org=self.org)
        self.designation = Master.objects.create(name="Analyst", type="designation", org=self.org)

    def test_total_is_auto_computed_on_save(self):
        entry = CostingEntry.objects.create(
            org=self.org,
            client=self.client_master,
            designation=self.designation,
            hr_day=Decimal("8"),
            days_working=Decimal("22"),
        )
        self.assertEqual(entry.total, Decimal("30"))

    def test_total_recomputed_on_update(self):
        entry = CostingEntry.objects.create(
            org=self.org,
            client=self.client_master,
            designation=self.designation,
            hr_day=Decimal("8"),
            days_working=Decimal("22"),
        )
        entry.hr_day = Decimal("6")
        entry.save()
        entry.refresh_from_db()
        self.assertEqual(entry.total, Decimal("28"))
```

- [ ] **Step 4: Run test to verify it fails**

Run: `uv run python manage.py test core.costing.tests -v 2`
Expected: FAIL — `ModuleNotFoundError: No module named 'core.costing.models'` (model doesn't exist yet).

- [ ] **Step 5: Write the model**

Create `core/costing/models.py`:

```python
import uuid

from django.conf import settings
from django.db import models

from core.base import TimeStampedModel


class CostingEntry(TimeStampedModel):
    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    org = models.ForeignKey(
        "users.Org",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="costing_entries",
    )
    client = models.ForeignKey(
        "masters.Master",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="costing_entries",
        limit_choices_to={"type": "client"},
    )
    designation = models.ForeignKey(
        "masters.Master",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="costing_entries",
        limit_choices_to={"type": "designation"},
    )
    hr_day = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    days_working = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=10, decimal_places=2, default=0, editable=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="costing_entries",
    )

    class Meta:
        ordering = ["client__name", "designation__name"]
        verbose_name = "costing entry"
        verbose_name_plural = "costing entries"

    def save(self, *args, **kwargs):
        self.total = (self.hr_day or 0) + (self.days_working or 0)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.client} — {self.designation} ({self.total})"
```

- [ ] **Step 6: Generate and apply the migration**

Run: `uv run python manage.py makemigrations costing`
Run: `uv run python manage.py migrate costing`
Expected: `Applying costing.0001_initial... OK`

- [ ] **Step 7: Run test to verify it passes**

Run: `uv run python manage.py test core.costing.tests -v 2`
Expected: PASS (2 tests)

- [ ] **Step 8: Commit**

```bash
git add core/costing/__init__.py core/costing/apps.py core/costing/models.py core/costing/migrations/ core/costing/tests.py config/settings.py
git commit -m "feat(costing): add CostingEntry model with auto-computed total"
```

---

### Task 5: `CostingEntry` API (serializer, viewset, urls, permission)

**Files:**
- Create: `core/costing/serializers.py`, `core/costing/views.py`, `core/costing/urls.py`
- Modify: `config/urls.py`, `core/costing/tests.py`

**Interfaces:**
- Consumes: `CostingEntry` (Task 4), `IsAdminOrCostingAccess` (Task 3), `core.org_utils.scoped`/`resolve_create_org`, `core.base.UidLookupMixin`, `core.realtime.broadcast`, `core.masters.serializers.MasterMinSerializer`.
- Produces: `GET/POST /api/costing_entries/`, `GET/PATCH/DELETE /api/costing_entries/<uid>/`, filterable by `?client=<uid>`.

- [ ] **Step 1: Write the failing tests**

Add to `core/costing/tests.py`:

```python
from rest_framework.test import APIClient

from users.models import OrgMembership, User


class CostingEntryApiTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="Org-Costing-Api")
        self.other_org = Org.objects.create(name="Org-Costing-Other")
        self.client_master = Master.objects.create(name="Acme", type="client", org=self.org)
        self.designation = Master.objects.create(name="Analyst", type="designation", org=self.org)

        self.admin = User.objects.create_user(username="costing-admin", password="pw", full_name="Admin")
        OrgMembership.objects.create(user=self.admin, org=self.org, role="admin")

        self.no_access = User.objects.create_user(username="costing-noaccess", password="pw", full_name="NoAccess")
        OrgMembership.objects.create(user=self.no_access, org=self.org, role="employee")

        self.api = APIClient()

    def test_admin_can_create_and_total_is_computed(self):
        self.api.force_authenticate(user=self.admin)
        res = self.api.post(
            "/api/costing_entries/",
            {
                "org": str(self.org.uid),
                "client": str(self.client_master.uid),
                "designation": str(self.designation.uid),
                "hr_day": "8",
                "days_working": "22",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data["total"], "30.00")

    def test_user_without_costing_access_is_forbidden_on_write(self):
        self.api.force_authenticate(user=self.no_access)
        res = self.api.post(
            "/api/costing_entries/",
            {
                "org": str(self.org.uid),
                "client": str(self.client_master.uid),
                "designation": str(self.designation.uid),
                "hr_day": "8",
                "days_working": "22",
            },
            format="json",
        )
        self.assertEqual(res.status_code, 403)

    def test_entries_scoped_to_caller_org(self):
        entry = CostingEntry.objects.create(
            org=self.org, client=self.client_master, designation=self.designation, hr_day=8, days_working=22,
        )
        outsider = User.objects.create_user(username="costing-outsider", password="pw", full_name="Outsider")
        OrgMembership.objects.create(user=outsider, org=self.other_org, role="admin")
        self.api.force_authenticate(user=outsider)
        res = self.api.get("/api/costing_entries/")
        self.assertEqual(res.status_code, 200)
        uids = [row["uid"] for row in res.data]
        self.assertNotIn(str(entry.uid), uids)

    def test_filter_by_client(self):
        self.api.force_authenticate(user=self.admin)
        other_client = Master.objects.create(name="Globex", type="client", org=self.org)
        CostingEntry.objects.create(
            org=self.org, client=self.client_master, designation=self.designation, hr_day=8, days_working=22,
        )
        CostingEntry.objects.create(
            org=self.org, client=other_client, designation=self.designation, hr_day=4, days_working=10,
        )
        res = self.api.get(f"/api/costing_entries/?client={self.client_master.uid}")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 1)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run python manage.py test core.costing.tests.CostingEntryApiTests -v 2`
Expected: FAIL — 404s, since no urls/views/serializer exist yet.

- [ ] **Step 3: Write the serializer**

Create `core/costing/serializers.py`:

```python
from rest_framework import serializers

from core.masters.models import Master
from core.masters.serializers import MasterMinSerializer
from users.models import Org

from .models import CostingEntry


class CostingEntrySerializer(serializers.ModelSerializer):
    org = serializers.SlugRelatedField(slug_field="uid", queryset=Org.objects.all(), required=False)
    client = serializers.SlugRelatedField(slug_field="uid", queryset=Master.objects.filter(type="client"))
    designation = serializers.SlugRelatedField(slug_field="uid", queryset=Master.objects.filter(type="designation"))
    client_detail = MasterMinSerializer(source="client", read_only=True)
    designation_detail = MasterMinSerializer(source="designation", read_only=True)
    created_by_uid = serializers.UUIDField(source="created_by.uid", read_only=True, allow_null=True)

    class Meta:
        model = CostingEntry
        fields = [
            "id",
            "uid",
            "org",
            "client",
            "client_detail",
            "designation",
            "designation_detail",
            "hr_day",
            "days_working",
            "total",
            "created_by_uid",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "uid", "total", "created_by_uid", "created_at", "updated_at"]
```

- [ ] **Step 4: Write the viewset**

Create `core/costing/views.py`:

```python
from typing import cast

from rest_framework import permissions
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.viewsets import ModelViewSet

from core.base import UidLookupMixin
from core.org_utils import resolve_create_org, scoped
from core.permissions import IsAdminOrCostingAccess
from core.realtime import broadcast
from users.models import User

from .models import CostingEntry
from .serializers import CostingEntrySerializer


def _raise_from_response(err):
    exc_cls = PermissionDenied if err.status_code == 403 else ValidationError
    raise exc_cls(err.data)


class CostingEntryViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = CostingEntrySerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminOrCostingAccess]

    def get_queryset(self):
        user = cast(User, self.request.user)
        qs = scoped(
            CostingEntry.objects.select_related("client", "designation", "created_by"),
            user,
        )
        client_uid = self.request.query_params.get("client")
        if client_uid:
            qs = qs.filter(client__uid=client_uid)
        return qs

    def perform_create(self, serializer):
        org, err = resolve_create_org(self.request)
        if err is not None:
            _raise_from_response(err)
        obj = serializer.save(created_by=self.request.user, org=org)
        broadcast("costing-entries", "INSERT", CostingEntrySerializer(obj).data)

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast("costing-entries", "UPDATE", CostingEntrySerializer(obj).data)

    def perform_destroy(self, instance):
        broadcast("costing-entries", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()
```

- [ ] **Step 5: Write urls and wire into the project**

Create `core/costing/urls.py`:

```python
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import CostingEntryViewSet

router = DefaultRouter()
router.register("costing_entries", CostingEntryViewSet, basename="costingentry")

urlpatterns = [path("", include(router.urls))]
```

In `config/urls.py`, add (after `path("api/", include("core.invoices.urls")),`):

```python
    path("api/", include("core.costing.urls")),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `uv run python manage.py test core.costing.tests -v 2`
Expected: PASS (6 tests total: 2 model + 4 API)

- [ ] **Step 7: Commit**

```bash
git add core/costing/serializers.py core/costing/views.py core/costing/urls.py core/costing/tests.py config/urls.py
git commit -m "feat(costing): add CostingEntry CRUD API scoped by org and gated by costing_access"
```

---

### Task 6: Frontend — Designations tab on Masters page

**Files:**
- Modify: `frontend/task-tracker/src/types/api/master.ts:14` (`MasterTypeValue`)
- Modify: `frontend/task-tracker/src/hooks/useMasters.ts` (add `designations` list)
- Modify: `frontend/task-tracker/src/pages/MastersPage.tsx` (add `"designations"` tab)
- Test: `frontend/task-tracker/src/__tests__/hooks/useMasters.test.ts` (create if none exists — check `Glob frontend/task-tracker/src/__tests__/hooks/useMasters*` first)

**Interfaces:**
- Consumes: `GET /api/masters/?type=designation` (Task 1 backend).
- Produces: `useMasters().designations: MasterItem[]`, a `"designations"` tab in `MastersPage`.

- [ ] **Step 1: Widen the type**

In `frontend/task-tracker/src/types/api/master.ts`, change:

```ts
export type MasterTypeValue = "client" | "category";
```
to:
```ts
export type MasterTypeValue = "client" | "category" | "designation";
```

- [ ] **Step 2: Write the failing test**

Create/extend `frontend/task-tracker/src/__tests__/hooks/useMasters.test.ts` (mirror the existing `useMastersToggleActive.test.ts` setup for `apiGet` mocking):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useMasters } from "@/hooks/useMasters";
import * as apiClient from "@/lib/api";

describe("useMasters designations", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("splits designation-type rows into a separate `designations` list", async () => {
    vi.spyOn(apiClient, "apiGet").mockResolvedValue([
      { uid: "1", name: "Acme", type: "client", org_uid: null, orgs: [], color: "", is_active: true },
      { uid: "2", name: "Team Lead", type: "designation", org_uid: null, orgs: [], color: "", is_active: true },
    ]);
    const { result } = renderHook(() => useMasters());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.designations).toHaveLength(1);
    expect(result.current.designations[0].name).toBe("Team Lead");
    expect(result.current.clients).toHaveLength(1);
  });
});
```

(If `useMasters` fetches multiple types via separate calls rather than one combined list — check the actual `reload()` implementation in `useMasters.ts` before finalizing this test's mock shape; adjust the mock to match however `clients`/`cats` are currently split.)

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/hooks/useMasters.test.ts`
Expected: FAIL — `result.current.designations` is `undefined`.

- [ ] **Step 4: Add `designations` to the hook**

In `frontend/task-tracker/src/hooks/useMasters.ts`:
- Add `designations: MasterItem[]` to `UseMastersReturn`.
- Wherever `clients`/`cats` are derived from the fetched list (via `.filter(m => m.type === "client")` / `"category"`, or via separate `apiGet` calls with `?type=`), add the equivalent `designations` derivation filtering on `type === "designation"`.
- Include `designations` in the hook's returned object.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/hooks/useMasters.test.ts`
Expected: PASS

- [ ] **Step 6: Add the tab to MastersPage**

In `frontend/task-tracker/src/pages/MastersPage.tsx`:
- Add `"designations"` to the `TabId` union (line 25).
- Add `designations: "designation"` to `TAB_TO_KIND` (lines 27–30).
- Add `designations: "masters.designations"` to `TAB_CODE` (lines 451–456) — matches the menu code registered in Task 3 Step 6.
- Add a tab button for "Designations" alongside the existing Clients/Categories buttons, gated by `tabViewable("designations")`.
- The existing grid-rendering block (list card `.map()`) and Add/Edit modal already key off `TAB_TO_KIND[tab]` to decide which `MasterKind` to save — no further branching needed there, since `saveItem`/`deleteItem` from `useMasters` are generic over `MasterKind`.

- [ ] **Step 7: Manual verification**

Run: `cd frontend/task-tracker && npm run dev`, log in as an admin, open Masters, confirm a "Designations" tab appears and you can add/edit/delete a designation.

- [ ] **Step 8: Commit**

```bash
git add frontend/task-tracker/src/types/api/master.ts frontend/task-tracker/src/hooks/useMasters.ts frontend/task-tracker/src/pages/MastersPage.tsx frontend/task-tracker/src/__tests__/hooks/useMasters.test.ts
git commit -m "feat(masters): add Designations tab backed by the designation Master type"
```

---

### Task 7: Frontend — Designation field on the Employee form

**Files:**
- Modify: `frontend/task-tracker/src/components/employee/EmpModal.tsx`
- Modify: `frontend/task-tracker/src/hooks/useEmployees.ts`
- Modify: `frontend/task-tracker/src/types/api/employee.ts` (add `designation`/`designation_detail` to `EmployeeDto`, `designation` to `EmployeeCreate`/`EmployeeUpdate`)

**Interfaces:**
- Consumes: `useMasters().designations` (Task 6), `EmployeeSerializer.designation`/`designation_detail` (Task 2).
- Produces: Employee create/edit form has a Designation dropdown; saved value round-trips through `Employee.designation`.

- [ ] **Step 1: Add the DTO/form fields**

In `frontend/task-tracker/src/types/api/employee.ts`, add to `EmployeeDto`:

```ts
readonly designation: string | null; // Master uid
readonly designation_detail: { uid: string; name: string } | null;
```

Add `designation?: string | null;` to both the `EmployeeCreate` and `EmployeeUpdate` interfaces.

- [ ] **Step 2: Map the field through the hook**

In `frontend/task-tracker/src/hooks/useEmployees.ts`, in `dtoToEmployee`, add:

```ts
designation_uid: dto.designation ?? null,
designation_name: dto.designation_detail?.name ?? null,
```

(Named `designation_uid`/`designation_name` — not `designation` — because the existing `Employee` domain type already uses `designation` for the free-text value read off `salary_records[0].designation`; keep both so the Salary tab's existing display is untouched.)

In the create/update payload builder (where `employee_name`, `status`, etc. are assembled into `EmployeeCreate`/`EmployeeUpdate`), add:

```ts
designation: form.designation_uid || null,
```

- [ ] **Step 3: Add the dropdown to the form**

In `frontend/task-tracker/src/components/employee/EmpModal.tsx`:
- Import `useMasters` and destructure `designations`.
- Add a dropdown field, following the exact `FormField` pattern used for Gender/Blood Group/Marital Status:

```tsx
<FormField
  label="Designation"
  field="designation_uid"
  form={form}
  setForm={setForm}
  options={designations.map((d) => ({ value: d.id, label: d.name }))}
/>
```

(Confirm the exact `options` shape `FormField` expects — `{value, label}[]` vs `string[]` — by reading its prop type before finalizing; match whatever `GENDERS`/`BLOOD_GROUPS` already use.)

- [ ] **Step 4: Manual verification**

Run: `cd frontend/task-tracker && npm run dev`. In Employee Management, create a new employee, pick a Designation from the dropdown, save, reopen the row, confirm the Designation persisted.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/components/employee/EmpModal.tsx frontend/task-tracker/src/hooks/useEmployees.ts frontend/task-tracker/src/types/api/employee.ts
git commit -m "feat(employees): add Designation dropdown backed by the Designation master list"
```

---

### Task 8: Frontend — Costing types, API client, hook

**Files:**
- Create: `frontend/task-tracker/src/types/api/costing.ts`
- Create: `frontend/task-tracker/src/lib/api/costing.ts`
- Create: `frontend/task-tracker/src/hooks/useCosting.ts`
- Create: `frontend/task-tracker/src/__tests__/hooks/useCosting.test.ts`
- Modify: `frontend/task-tracker/src/types/api/index.ts` (add `export * from "./costing";`)

**Interfaces:**
- Consumes: `GET/POST/PATCH/DELETE /api/costing_entries/` (Task 5), `apiGet`/`apiPost`/`apiPatch`/`apiDelete` from `@/lib/api`, `ws.subscribe` from `@/lib/api`.
- Produces: `useCosting(clientUid)` returning `{entries, loading, saving, createEntry, editEntry, removeEntry}`; `CostingEntryDto`/`CostingEntryCreateForm`/`CostingEntryEditForm` types.

- [ ] **Step 1: Write the types**

Create `frontend/task-tracker/src/types/api/costing.ts`:

```ts
import type { BaseDto } from "./common";

export interface CostingEntryDto extends BaseDto {
  readonly uid: string;
  readonly org: string | null;
  readonly client: string; // Master uid
  readonly client_detail: { uid: string; name: string; type: string; color: string } | null;
  readonly designation: string; // Master uid
  readonly designation_detail: { uid: string; name: string; type: string; color: string } | null;
  readonly hr_day: string;
  readonly days_working: string;
  readonly total: string;
  readonly created_by_uid: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface CostingEntryCreateForm {
  org?: string;
  client: string;
  designation: string;
  hr_day: string | number;
  days_working: string | number;
}

export interface CostingEntryEditForm {
  client?: string;
  designation?: string;
  hr_day?: string | number;
  days_working?: string | number;
}
```

(Check `frontend/task-tracker/src/types/api/common.ts` for the actual `BaseDto` shape before finalizing — if it doesn't exist, drop the `extends BaseDto` and inline `created_at`/`updated_at` directly as done above.)

- [ ] **Step 2: Write the api client**

Create `frontend/task-tracker/src/lib/api/costing.ts`:

```ts
import { apiDelete, apiGet, apiPatch, apiPost } from "./client";
import type {
  CostingEntryCreateForm,
  CostingEntryDto,
  CostingEntryEditForm,
} from "@/types/api/costing";

export const listCostingEntries = (clientUid?: string) =>
  apiGet<CostingEntryDto[]>("/costing_entries/", clientUid ? { client: clientUid } : undefined);

export const createCostingEntry = (form: CostingEntryCreateForm) =>
  apiPost<CostingEntryDto>("/costing_entries/", form);

export const editCostingEntry = (uid: string, form: CostingEntryEditForm) =>
  apiPatch<CostingEntryDto>(`/costing_entries/${uid}/`, form);

export const deleteCostingEntry = (uid: string) => apiDelete(`/costing_entries/${uid}/`);
```

- [ ] **Step 3: Write the failing hook test**

Create `frontend/task-tracker/src/__tests__/hooks/useCosting.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useCosting } from "@/hooks/useCosting";
import * as costingApi from "@/lib/api/costing";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, ws: { subscribe: vi.fn(() => () => {}) } };
});

describe("useCosting", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("loads entries for the given client", async () => {
    vi.spyOn(costingApi, "listCostingEntries").mockResolvedValue([
      {
        uid: "e1",
        org: "o1",
        client: "c1",
        client_detail: { uid: "c1", name: "Acme", type: "client", color: "" },
        designation: "d1",
        designation_detail: { uid: "d1", name: "Analyst", type: "designation", color: "" },
        hr_day: "8.00",
        days_working: "22.00",
        total: "30.00",
        created_by_uid: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);
    const { result } = renderHook(() => useCosting("c1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].total).toBe("30.00");
  });

  it("creates an entry and appends it to state", async () => {
    vi.spyOn(costingApi, "listCostingEntries").mockResolvedValue([]);
    const created = {
      uid: "e2",
      org: "o1",
      client: "c1",
      client_detail: null,
      designation: "d1",
      designation_detail: null,
      hr_day: "6.00",
      days_working: "10.00",
      total: "16.00",
      created_by_uid: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    vi.spyOn(costingApi, "createCostingEntry").mockResolvedValue(created);
    const { result } = renderHook(() => useCosting("c1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.createEntry({ client: "c1", designation: "d1", hr_day: 6, days_working: 10 });
    });
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].uid).toBe("e2");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/hooks/useCosting.test.ts`
Expected: FAIL — `Cannot find module '@/hooks/useCosting'`.

- [ ] **Step 5: Write the hook**

Create `frontend/task-tracker/src/hooks/useCosting.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import { ws } from "@/lib/api";
import {
  createCostingEntry,
  deleteCostingEntry,
  editCostingEntry,
  listCostingEntries,
} from "@/lib/api/costing";
import type {
  CostingEntryCreateForm,
  CostingEntryDto,
  CostingEntryEditForm,
} from "@/types/api/costing";

export function useCosting(clientUid: string | null) {
  const [entries, setEntries] = useState<CostingEntryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!clientUid) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rows = await listCostingEntries(clientUid);
      setEntries(rows);
    } finally {
      setLoading(false);
    }
  }, [clientUid]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    return ws.subscribe<CostingEntryDto>("costing-entries", (event) => {
      if (event.record.client !== clientUid) return;
      setEntries((prev) => {
        if (event.type === "DELETE") return prev.filter((e) => e.uid !== event.record.uid);
        const idx = prev.findIndex((e) => e.uid === event.record.uid);
        if (idx === -1) return [...prev, event.record];
        const next = [...prev];
        next[idx] = event.record;
        return next;
      });
    });
  }, [clientUid]);

  const createEntry = useCallback(async (form: CostingEntryCreateForm) => {
    setSaving(true);
    try {
      const created = await createCostingEntry(form);
      setEntries((prev) => [...prev, created]);
      return created;
    } finally {
      setSaving(false);
    }
  }, []);

  const editEntry = useCallback(async (uid: string, form: CostingEntryEditForm) => {
    setSaving(true);
    try {
      const updated = await editCostingEntry(uid, form);
      setEntries((prev) => prev.map((e) => (e.uid === uid ? updated : e)));
      return updated;
    } finally {
      setSaving(false);
    }
  }, []);

  const removeEntry = useCallback(async (uid: string) => {
    setSaving(true);
    try {
      await deleteCostingEntry(uid);
      setEntries((prev) => prev.filter((e) => e.uid !== uid));
    } finally {
      setSaving(false);
    }
  }, []);

  return { entries, loading, saving, reload, createEntry, editEntry, removeEntry };
}
```

(Verify the exact shape of `ws.subscribe`'s callback event — `{type, record}` vs positional args — against another hook like `useMonthlyReports.ts` before finalizing; adjust the subscription block to match the real signature.)

- [ ] **Step 6: Run test to verify it passes**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/hooks/useCosting.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 7: Add to the barrel export**

In `frontend/task-tracker/src/types/api/index.ts`, add alphabetically:

```ts
export * from "./costing";
```

- [ ] **Step 8: Commit**

```bash
git add frontend/task-tracker/src/types/api/costing.ts frontend/task-tracker/src/lib/api/costing.ts frontend/task-tracker/src/hooks/useCosting.ts frontend/task-tracker/src/__tests__/hooks/useCosting.test.ts frontend/task-tracker/src/types/api/index.ts
git commit -m "feat(costing): add frontend types, api client, and useCosting hook"
```

---

### Task 9: Frontend — CostingPage UI

**Files:**
- Create: `frontend/task-tracker/src/pages/CostingPage.tsx`

**Interfaces:**
- Consumes: `useCosting` (Task 8), `useMasters` (for the client dropdown — Task 6), `useMasters().designations` (for the row dropdown — Task 6).
- Produces: default-exported `CostingPage({ profile, selectedOrg })` component (matching `InvoicePage`'s prop signature — verify against `InvoicePage.tsx`'s actual props before finalizing).

- [ ] **Step 1: Write the component**

Create `frontend/task-tracker/src/pages/CostingPage.tsx`:

```tsx
import { useMemo, useState } from "react";
import { useCosting } from "@/hooks/useCosting";
import { useMasters } from "@/hooks/useMasters";
import type { CostingEntryDto } from "@/types/api/costing";

interface RowFormState {
  designation: string;
  hr_day: string;
  days_working: string;
}

const EMPTY_ROW: RowFormState = { designation: "", hr_day: "", days_working: "" };

function computeTotal(hrDay: string, daysWorking: string): string {
  const a = Number.parseFloat(hrDay) || 0;
  const b = Number.parseFloat(daysWorking) || 0;
  return (a + b).toFixed(2);
}

export default function CostingPage() {
  const { clients, designations } = useMasters();
  const [selectedClient, setSelectedClient] = useState<string>("");
  const { entries, loading, saving, createEntry, editEntry, removeEntry } = useCosting(
    selectedClient || null,
  );
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState<RowFormState>(EMPTY_ROW);
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<RowFormState>(EMPTY_ROW);

  const designationName = useMemo(
    () => new Map(designations.map((d) => [d.id, d.name])),
    [designations],
  );

  async function handleAddSave() {
    if (!selectedClient || !addForm.designation) return;
    await createEntry({
      client: selectedClient,
      designation: addForm.designation,
      hr_day: addForm.hr_day || 0,
      days_working: addForm.days_working || 0,
    });
    setAddForm(EMPTY_ROW);
    setAdding(false);
  }

  function startEdit(row: CostingEntryDto) {
    setEditingUid(row.uid);
    setEditForm({ designation: row.designation, hr_day: row.hr_day, days_working: row.days_working });
  }

  async function handleEditSave(uid: string) {
    await editEntry(uid, {
      designation: editForm.designation,
      hr_day: editForm.hr_day || 0,
      days_working: editForm.days_working || 0,
    });
    setEditingUid(null);
  }

  return (
    <div className="costing-page">
      <h1>Costing</h1>

      <label>
        Client
        <select value={selectedClient} onChange={(e) => setSelectedClient(e.target.value)}>
          <option value="">Select a client…</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      {selectedClient && (
        <table className="costing-table">
          <thead>
            <tr>
              <th>Designation</th>
              <th>Hr/Day</th>
              <th>No. of Days Working</th>
              <th>Total</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5}>Loading…</td>
              </tr>
            )}
            {!loading &&
              entries.map((row) =>
                editingUid === row.uid ? (
                  <tr key={row.uid}>
                    <td>
                      <select
                        value={editForm.designation}
                        onChange={(e) => setEditForm({ ...editForm, designation: e.target.value })}
                      >
                        {designations.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        value={editForm.hr_day}
                        onChange={(e) => setEditForm({ ...editForm, hr_day: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        value={editForm.days_working}
                        onChange={(e) => setEditForm({ ...editForm, days_working: e.target.value })}
                      />
                    </td>
                    <td>{computeTotal(editForm.hr_day, editForm.days_working)}</td>
                    <td>
                      <button disabled={saving} onClick={() => handleEditSave(row.uid)}>
                        Save
                      </button>
                      <button onClick={() => setEditingUid(null)}>Cancel</button>
                    </td>
                  </tr>
                ) : (
                  <tr key={row.uid}>
                    <td>{row.designation_detail?.name ?? designationName.get(row.designation) ?? "—"}</td>
                    <td>{row.hr_day}</td>
                    <td>{row.days_working}</td>
                    <td>{row.total}</td>
                    <td>
                      <button onClick={() => startEdit(row)}>Edit</button>
                      <button
                        onClick={() => {
                          if (confirm("Delete this costing row?")) void removeEntry(row.uid);
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ),
              )}
            {adding && (
              <tr>
                <td>
                  <select
                    value={addForm.designation}
                    onChange={(e) => setAddForm({ ...addForm, designation: e.target.value })}
                  >
                    <option value="">Select…</option>
                    {designations.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    value={addForm.hr_day}
                    onChange={(e) => setAddForm({ ...addForm, hr_day: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    value={addForm.days_working}
                    onChange={(e) => setAddForm({ ...addForm, days_working: e.target.value })}
                  />
                </td>
                <td>{computeTotal(addForm.hr_day, addForm.days_working)}</td>
                <td>
                  <button disabled={saving} onClick={handleAddSave}>
                    Save
                  </button>
                  <button onClick={() => setAdding(false)}>Cancel</button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {selectedClient && !adding && <button onClick={() => setAdding(true)}>Add</button>}
    </div>
  );
}
```

Note: check `InvoicePage.tsx`'s actual prop signature (`{ profile, selectedOrg }` or similar) before finalizing — if other top-level pages require those props (e.g. to scope `resolve_create_org` payloads), thread `selectedOrg` into `createEntry`'s `org` field the same way `InvoicePage` does, instead of leaving `org` unset and relying purely on `resolve_create_org`'s single-org fallback.

- [ ] **Step 2: Manual verification (deferred to Task 10)**

This component can't be exercised in the browser until it's wired into `App.tsx`'s nav — verification happens at the end of Task 10.

- [ ] **Step 3: Commit**

```bash
git add frontend/task-tracker/src/pages/CostingPage.tsx
git commit -m "feat(costing): add CostingPage UI with add/edit/delete rows"
```

---

### Task 10: Wire Costing into the top-level nav

**Files:**
- Modify: `frontend/task-tracker/src/App.tsx`
- Modify: `frontend/task-tracker/src/components/layout/Header.tsx`
- Modify: `frontend/task-tracker/src/components/header/NavMenu.tsx`

**Interfaces:**
- Consumes: `CostingPage` (Task 9), menu code `"costing"` (Task 3), `navVisible`/`canView` from `usePermissions`.
- Produces: "Costing" appears as a top-level nav tab, gated by `costing_access`/menu rights, rendering `CostingPage` when selected.

- [ ] **Step 1: Add the lazy import**

In `frontend/task-tracker/src/App.tsx`, add alongside the other lazy imports (near `InvoicePage`):

```tsx
const CostingPage = lazy(() => import("./pages/CostingPage"));
```

- [ ] **Step 2: Add to `navVisible`**

In the array passed to the `navVisible` `useMemo` (the list including `"board"`, `"invoice"`, `"masters"`, etc.), add `"costing"`:

```tsx
const navVisible = useMemo(
  () =>
    Object.fromEntries(
      [
        "board", "dashboard", "calendar", "worklog", "leads", "clients",
        "notice", "invoice", "costing", "conveyance", "masters", "holidays",
        "employee", "pace", "growthplan", "kaizen", "users", "settings",
      ].map((code) => [code, canView(code)]),
    ) as Record<string, boolean>,
  [canView],
);
```

- [ ] **Step 3: Register in `VIEW_MAP`**

In the `VIEW_MAP: Record<View, ReactElement | null>` object, add alongside the `invoice:` entry:

```tsx
costing: navVisible.costing ? <CostingPage /> : null,
```

(Adjust props if Task 9's final `CostingPage` signature takes `profile`/`selectedOrg` — match whatever `invoice:` passes.)

- [ ] **Step 4: Add the nav icon**

In `frontend/task-tracker/src/components/layout/Header.tsx`, in the `const icons = { ... }` object, add after the `masters:` entry (before `users:`):

```tsx
    costing: (
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
        <line x1="12" y1="1" x2="12" y2="23" />
        <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
      </svg>
    ),
```

- [ ] **Step 5: Add the nav tab**

In `frontend/task-tracker/src/components/header/NavMenu.tsx`, in the `NAV_TABS_RAW` array, add after the `invoice` entry:

```tsx
      ...(show("invoice") ? [{ id: "invoice", label: "Invoice", icon: icons.invoice }] : []),
      ...(show("costing") ? [{ id: "costing", label: "Costing", icon: icons.costing }] : []),
```

- [ ] **Step 6: Manual verification**

Run: `cd frontend/task-tracker && npm run dev`, and separately `uv run python manage.py runserver` for the backend.

1. Log in as `admin@example.com` / `admin@123` (admin — sees Costing automatically).
2. Confirm "Costing" appears in the top nav.
3. Click it, select a client (create one under Masters → Clients first if none exist), click Add, pick a Designation (create one under Masters → Designations first), enter Hr/Day and Days Working, confirm Total updates live, Save.
4. Confirm the row appears in the table with the correct Total.
5. Click Edit on the row, change a value, Save, confirm it updates.
6. Click Delete, confirm the row disappears.
7. Go to Users → User Rights (or wherever the matrix lives), confirm "Costing" appears as a grantable menu item for a non-admin user; toggle it off for a test user, log in as them, confirm the Costing tab disappears from their nav.

- [ ] **Step 7: Run the full frontend test suite**

Run: `cd frontend/task-tracker && npx vitest run`
Expected: all tests PASS, including the new `useCosting.test.ts` and `useMasters.test.ts`.

- [ ] **Step 8: Run the full backend test suite**

Run: `uv run python manage.py test`
Expected: all tests PASS, including the new `core.masters.tests.MasterDesignationTypeTests`, `core.employees.tests.EmployeeDesignationTests`, `users.tests.CostingAccessTests`, `core.costing.tests`.

- [ ] **Step 9: Commit**

```bash
git add frontend/task-tracker/src/App.tsx frontend/task-tracker/src/components/layout/Header.tsx frontend/task-tracker/src/components/header/NavMenu.tsx
git commit -m "feat(costing): wire Costing into the top-level nav"
```
