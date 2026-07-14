# Costing — Seat Cost & Profitability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Costing into a tabbed section: the existing table stays as the first tab; add three admin-only tabs — Seat Cost (org-wide default), Employee Seat Cost (per-employee overrides), and Profitability (a per-employee comparison of client-billed Costing value against salary + seat cost).

**Architecture:** Two new models in `core/costing` (`SeatCostSetting`, `EmployeeSeatCost`), each with its own CRUD viewset following the exact `CostingEntry` pattern (`UidLookupMixin`, `core.realtime.broadcast`), gated by the existing `IsAdminInAny` permission class (no new grantable permission — this is sensitive salary-adjacent data). On the frontend: a hook/api-client/types trio per model, a pure `computeProfitability` aggregation utility (mirrors the shape of Budget vs Actual's `computeMonthlySummary`/`computeGrandTotal`), and a tab bar added to `CostingPage.tsx` that's only rendered for admins.

**Tech Stack:** Django 5 / DRF (`core/costing`), SQLite dev DB, React + TypeScript (Vite), Vitest, Django `TestCase` + DRF `APIClient`.

## Global Constraints

- `uid` (UUID) is always the external identifier in URLs — every new viewset mixes in `UidLookupMixin`.
- Every mutating viewset action broadcasts via `core.realtime.broadcast(channel, event_type, payload)`.
- New DRF fields that reference another model use `SlugRelatedField(slug_field="uid", ...)`.
- Seat Cost config and Profitability are **admin-only** — gated by the existing `IsAdminInAny` permission class (`core/permissions.py`), not a new grantable `ACCESS_FEATURES` flag. `IsAdminInAny.has_permission` has no `SAFE_METHODS` bypass, so it gates reads too — use it directly, do not write a new permission class.
- `EmployeeSeatCost` has no `org` field of its own — its implicit org is `employee.org`. Scoping/validation must check the CALLER is admin of `employee.org` specifically (not just admin of *some* org), since `IsAdminInAny` alone doesn't check *which* org.
- Each Costing entry's `total` is treated as an ongoing monthly value (no date dimension on `CostingEntry`) — Profitability sums all of an employee's Costing `total`s across every client/designation they're assigned to, as a monthly figure.
- Break-even tolerance is ±5% (same shape as Budget vs Actual's On Budget band): **Profitable** if `client_value > cost × 1.05`, **Loss** if `client_value < cost × 0.95`, else **Break-even**.
- Missing data degrades gracefully: no salary record → `salary = 0`, flagged rather than silently treated as free; no seat cost anywhere (no override, no org default) → `seat_cost = 0`.
- No new "profitability" backend endpoint — the frontend fetches Costing entries, employees+salaries, seat cost settings, and seat cost overrides, then computes the comparison client-side in a pure utility (matches the established Costing/Budget pattern of client-side aggregation).

---

## File Structure

**Backend — modified:**
- `core/costing/models.py` — add `SeatCostSetting`, `EmployeeSeatCost`
- `core/costing/migrations/` — new migration
- `core/costing/serializers.py` — add `SeatCostSettingSerializer`, `EmployeeSeatCostSerializer`
- `core/costing/views.py` — add `SeatCostSettingViewSet`, `EmployeeSeatCostViewSet`
- `core/costing/urls.py` — register both new viewsets
- `core/costing/tests.py` — new test classes

**Frontend — new:**
- `frontend/task-tracker/src/types/api/seatCost.ts` — `SeatCostSettingDto`, `SeatCostSettingForm`, `EmployeeSeatCostDto`, `EmployeeSeatCostCreateForm`, `EmployeeSeatCostEditForm`
- `frontend/task-tracker/src/lib/api/seatCost.ts` — api client functions
- `frontend/task-tracker/src/hooks/useSeatCostSetting.ts` — single-row fetch-or-create hook
- `frontend/task-tracker/src/hooks/useEmployeeSeatCosts.ts` — standard CRUD-list hook
- `frontend/task-tracker/src/utils/profitability.ts` — `computeProfitability`, `computeProfitabilityGrandTotal`
- `frontend/task-tracker/src/__tests__/hooks/useSeatCostSetting.test.ts`
- `frontend/task-tracker/src/__tests__/hooks/useEmployeeSeatCosts.test.ts`
- `frontend/task-tracker/src/__tests__/utils/profitability.test.ts`

**Frontend — modified:**
- `frontend/task-tracker/src/types/api/index.ts` — `export * from "./seatCost";`
- `frontend/task-tracker/src/pages/CostingPage.tsx` — add the admin-only tab bar and three new tab bodies

---

### Task 1: `SeatCostSetting` and `EmployeeSeatCost` models

**Files:**
- Modify: `core/costing/models.py`
- Create: `core/costing/migrations/0003_seatcostsetting_employeeseatcost.py` (check `python manage.py showmigrations costing` for the actual next number — expected `0003`, confirm rather than assume)
- Modify: `core/costing/tests.py`

**Interfaces:**
- Produces: `SeatCostSetting` (`uid`, `org` OneToOne, `monthly_amount`, timestamps), `EmployeeSeatCost` (`uid`, `employee` OneToOne, `monthly_amount`, timestamps).

- [ ] **Step 1: Write the failing test**

Add to `core/costing/tests.py`:

```python
from django.core.exceptions import ValidationError

from core.employees.models import Employee

from .models import EmployeeSeatCost, SeatCostSetting


class SeatCostModelTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="Org-SeatCost")
        self.employee = Employee.objects.create(org=self.org, employee_name="Priya")

    def test_create_org_seat_cost_setting(self):
        setting = SeatCostSetting.objects.create(org=self.org, monthly_amount=Decimal("5000"))
        self.assertEqual(setting.monthly_amount, Decimal("5000"))

    def test_negative_org_seat_cost_rejected(self):
        setting = SeatCostSetting(org=self.org, monthly_amount=Decimal("-100"))
        with self.assertRaises(ValidationError):
            setting.full_clean()

    def test_one_setting_per_org(self):
        SeatCostSetting.objects.create(org=self.org, monthly_amount=Decimal("5000"))
        with self.assertRaises(Exception):
            SeatCostSetting.objects.create(org=self.org, monthly_amount=Decimal("6000"))

    def test_create_employee_seat_cost_override(self):
        override = EmployeeSeatCost.objects.create(employee=self.employee, monthly_amount=Decimal("7000"))
        self.assertEqual(override.monthly_amount, Decimal("7000"))

    def test_negative_employee_seat_cost_rejected(self):
        override = EmployeeSeatCost(employee=self.employee, monthly_amount=Decimal("-1"))
        with self.assertRaises(ValidationError):
            override.full_clean()
```

`Decimal` should already be imported at the top of `core/costing/tests.py` from the existing `CostingEntry` tests — confirm before adding a duplicate import.

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run python manage.py test core.costing.tests.SeatCostModelTests -v 2`
Expected: FAIL — `ImportError: cannot import name 'SeatCostSetting'`.

- [ ] **Step 3: Add the models**

In `core/costing/models.py`, add after the existing `CostingEntry` class:

```python
class SeatCostSetting(TimeStampedModel):
    """Org-wide default monthly office-overhead cost per employee ("seat").

    Used by the Profitability comparison as the fallback cost for any
    employee without their own ``EmployeeSeatCost`` override.
    """

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    org = models.OneToOneField(
        "users.Org",
        on_delete=models.CASCADE,
        related_name="seat_cost_setting",
    )
    monthly_amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0,
        validators=[MinValueValidator(0)],
    )

    class Meta:
        verbose_name = "seat cost setting"
        verbose_name_plural = "seat cost settings"

    def __str__(self):
        return f"{self.org} seat cost: {self.monthly_amount}"


class EmployeeSeatCost(TimeStampedModel):
    """Per-employee override of the org-wide seat cost default."""

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    employee = models.OneToOneField(
        "employees.Employee",
        on_delete=models.CASCADE,
        related_name="seat_cost",
    )
    monthly_amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=0,
        validators=[MinValueValidator(0)],
    )

    class Meta:
        verbose_name = "employee seat cost"
        verbose_name_plural = "employee seat costs"

    def __str__(self):
        return f"{self.employee} seat cost: {self.monthly_amount}"
```

Add `MinValueValidator` to the existing `from django.core.validators import ...` import at the top of the file if not already present (check first — `CostingEntry` may not currently import validators at all, in which case add the import line fresh: `from django.core.validators import MinValueValidator`).

- [ ] **Step 4: Generate and apply the migration**

Run: `uv run python manage.py makemigrations costing`
Run: `uv run python manage.py migrate costing`
Expected: `Applying costing.0003_seatcostsetting_employeeseatcost... OK` (or whatever number `makemigrations` actually assigns — confirm it matches the file you expected).

- [ ] **Step 5: Run test to verify it passes**

Run: `uv run python manage.py test core.costing.tests.SeatCostModelTests -v 2`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add core/costing/models.py core/costing/migrations/ core/costing/tests.py
git commit -m "feat(costing): add SeatCostSetting and EmployeeSeatCost models"
```

---

### Task 2: `SeatCostSetting` API

**Files:**
- Modify: `core/costing/serializers.py`, `core/costing/views.py`, `core/costing/urls.py`, `core/costing/tests.py`

**Interfaces:**
- Consumes: `SeatCostSetting` (Task 1), `IsAdminInAny` (`core/permissions.py`, already exists), `core.org_utils.resolve_admin_org` (already exists — confirm its signature by reading `core/org_utils.py` before use: returns `(org, error_response)` and requires the caller be admin of the resolved org).
- Produces: `GET/POST/PATCH /api/seat_cost_settings/`, one row per org, admin-only for both read and write.

- [ ] **Step 1: Write the failing tests**

Add to `core/costing/tests.py`:

```python
class SeatCostSettingApiTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="Org-SeatCost-Api")
        self.other_org = Org.objects.create(name="Org-SeatCost-Other")

        self.admin = User.objects.create_user(username="seatcost-admin", password="pw", full_name="Admin")
        OrgMembership.objects.create(user=self.admin, org=self.org, role="admin")

        self.plain = User.objects.create_user(username="seatcost-plain", password="pw", full_name="Plain")
        OrgMembership.objects.create(user=self.plain, org=self.org, role="employee")

        self.api = APIClient()

    def test_admin_can_create_seat_cost_setting(self):
        self.api.force_authenticate(user=self.admin)
        res = self.api.post(
            "/api/seat_cost_settings/",
            {"org": str(self.org.uid), "monthly_amount": "5000"},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data["monthly_amount"], "5000.00")
        self.assertEqual(res.data["org_name"], self.org.name)

    def test_non_admin_forbidden_on_read_and_write(self):
        self.api.force_authenticate(user=self.plain)
        res = self.api.get("/api/seat_cost_settings/")
        self.assertEqual(res.status_code, 403)
        res = self.api.post(
            "/api/seat_cost_settings/",
            {"org": str(self.org.uid), "monthly_amount": "5000"},
            format="json",
        )
        self.assertEqual(res.status_code, 403)

    def test_settings_scoped_to_admin_orgs(self):
        setting = SeatCostSetting.objects.create(org=self.org, monthly_amount=Decimal("5000"))
        outsider_admin = User.objects.create_user(
            username="seatcost-outsider", password="pw", full_name="Outsider",
        )
        OrgMembership.objects.create(user=outsider_admin, org=self.other_org, role="admin")
        self.api.force_authenticate(user=outsider_admin)
        res = self.api.get("/api/seat_cost_settings/")
        self.assertEqual(res.status_code, 200)
        uids = [row["uid"] for row in res.data]
        self.assertNotIn(str(setting.uid), uids)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run python manage.py test core.costing.tests.SeatCostSettingApiTests -v 2`
Expected: FAIL — 404s, since no urls/views/serializer exist yet.

- [ ] **Step 3: Write the serializer**

In `core/costing/serializers.py`, add (alongside the existing `CostingEntrySerializer`):

```python
from .models import EmployeeSeatCost, SeatCostSetting


class SeatCostSettingSerializer(serializers.ModelSerializer):
    org = serializers.SlugRelatedField(slug_field="uid", queryset=Org.objects.all(), required=False)
    org_name = serializers.SerializerMethodField()

    class Meta:
        model = SeatCostSetting
        fields = ["id", "uid", "org", "org_name", "monthly_amount", "created_at", "updated_at"]
        read_only_fields = ["id", "uid", "created_at", "updated_at"]

    def get_org_name(self, obj):
        return obj.org.name if obj.org_id else None
```

(`Org` is already imported at the top of `core/costing/serializers.py` from the existing `CostingEntrySerializer` — confirm before adding a duplicate import. Update the existing `from .models import CostingEntry` line to also import `SeatCostSetting`, or add the import shown above alongside it — whichever keeps the file's existing import grouping clean.)

- [ ] **Step 4: Write the viewset**

In `core/costing/views.py`, add:

```python
from core.org_utils import resolve_admin_org

from .models import EmployeeSeatCost, SeatCostSetting
from .serializers import SeatCostSettingSerializer


class SeatCostSettingViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = SeatCostSettingSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminInAny]

    def get_queryset(self):
        user = cast(User, self.request.user)
        admin_org_ids = user.memberships.filter(role="admin").values_list("org_id", flat=True)
        return SeatCostSetting.objects.filter(org_id__in=admin_org_ids).select_related("org")

    def perform_create(self, serializer):
        org, err = resolve_admin_org(self.request)
        if err is not None:
            _raise_from_response(err)
        obj = serializer.save(org=org)
        broadcast("seat-cost-settings", "INSERT", SeatCostSettingSerializer(obj).data)

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast("seat-cost-settings", "UPDATE", SeatCostSettingSerializer(obj).data)
```

Add `IsAdminInAny` to the existing `from core.permissions import IsAdminOrCostingAccess` import line (change to `from core.permissions import IsAdminInAny, IsAdminOrCostingAccess`).

- [ ] **Step 5: Register the URL**

In `core/costing/urls.py`, add:

```python
from .views import CostingEntryViewSet, SeatCostSettingViewSet

router.register("seat_cost_settings", SeatCostSettingViewSet, basename="seatcostsetting")
```

(Update the existing single-name import line to include both view classes.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `uv run python manage.py test core.costing.tests.SeatCostSettingApiTests -v 2`
Expected: PASS (3 tests)

- [ ] **Step 7: Commit**

```bash
git add core/costing/serializers.py core/costing/views.py core/costing/urls.py core/costing/tests.py
git commit -m "feat(costing): add SeatCostSetting API, admin-only"
```

---

### Task 3: `EmployeeSeatCost` API

**Files:**
- Modify: `core/costing/serializers.py`, `core/costing/views.py`, `core/costing/urls.py`, `core/costing/tests.py`

**Interfaces:**
- Consumes: `EmployeeSeatCost` (Task 1), `IsAdminInAny`, `EmployeeMinSerializer` (already exists in `core/costing/serializers.py` from the Costing employee field work).
- Produces: `GET/POST/PATCH/DELETE /api/employee_seat_costs/`, admin-only, org-scoped by the target employee's own org.

- [ ] **Step 1: Write the failing tests**

Add to `core/costing/tests.py`:

```python
class EmployeeSeatCostApiTests(TestCase):
    def setUp(self):
        self.org = Org.objects.create(name="Org-EmpSeatCost")
        self.other_org = Org.objects.create(name="Org-EmpSeatCost-Other")
        self.employee = Employee.objects.create(org=self.org, employee_name="Priya")
        self.other_employee = Employee.objects.create(org=self.other_org, employee_name="Rahul")

        self.admin = User.objects.create_user(username="empseatcost-admin", password="pw", full_name="Admin")
        OrgMembership.objects.create(user=self.admin, org=self.org, role="admin")

        self.plain = User.objects.create_user(username="empseatcost-plain", password="pw", full_name="Plain")
        OrgMembership.objects.create(user=self.plain, org=self.org, role="employee")

        self.api = APIClient()

    def test_admin_can_create_override_for_own_org_employee(self):
        self.api.force_authenticate(user=self.admin)
        res = self.api.post(
            "/api/employee_seat_costs/",
            {"employee": str(self.employee.uid), "monthly_amount": "7000"},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(res.data["employee_detail"]["employee_name"], "Priya")

    def test_admin_cannot_create_override_for_other_org_employee(self):
        self.api.force_authenticate(user=self.admin)
        res = self.api.post(
            "/api/employee_seat_costs/",
            {"employee": str(self.other_employee.uid), "monthly_amount": "7000"},
            format="json",
        )
        self.assertEqual(res.status_code, 400, res.data)

    def test_non_admin_forbidden(self):
        self.api.force_authenticate(user=self.plain)
        res = self.api.post(
            "/api/employee_seat_costs/",
            {"employee": str(self.employee.uid), "monthly_amount": "7000"},
            format="json",
        )
        self.assertEqual(res.status_code, 403)

    def test_entries_scoped_to_admin_orgs(self):
        override = EmployeeSeatCost.objects.create(employee=self.employee, monthly_amount=Decimal("7000"))
        outsider_admin = User.objects.create_user(
            username="empseatcost-outsider", password="pw", full_name="Outsider",
        )
        OrgMembership.objects.create(user=outsider_admin, org=self.other_org, role="admin")
        self.api.force_authenticate(user=outsider_admin)
        res = self.api.get("/api/employee_seat_costs/")
        self.assertEqual(res.status_code, 200)
        uids = [row["uid"] for row in res.data]
        self.assertNotIn(str(override.uid), uids)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run python manage.py test core.costing.tests.EmployeeSeatCostApiTests -v 2`
Expected: FAIL — 404s.

- [ ] **Step 3: Write the serializer**

In `core/costing/serializers.py`, add:

```python
class EmployeeSeatCostSerializer(serializers.ModelSerializer):
    employee = serializers.SlugRelatedField(slug_field="uid", queryset=Employee.objects.all())
    employee_detail = EmployeeMinSerializer(source="employee", read_only=True)

    class Meta:
        model = EmployeeSeatCost
        fields = ["id", "uid", "employee", "employee_detail", "monthly_amount", "created_at", "updated_at"]
        read_only_fields = ["id", "uid", "created_at", "updated_at"]

    def validate_employee(self, value):
        """The employee must belong to an org the CALLER is admin of.

        Unlike CostingEntry.employee (which is checked against the entry's
        own org), EmployeeSeatCost has no org field of its own — its
        implicit org is `employee.org`. IsAdminInAny only confirms the
        caller is admin of *some* org, not this one, so that check has to
        happen here.
        """
        request = self.context.get("request")
        if request is None:
            return value
        admin_org_ids = set(request.user.memberships.filter(role="admin").values_list("org_id", flat=True))
        if value.org_id not in admin_org_ids:
            raise serializers.ValidationError("You must be an admin of this employee's organisation.")
        return value
```

(`Employee` is already imported at the top of `core/costing/serializers.py` from the existing `EmployeeMinSerializer`/`CostingEntrySerializer.employee` field — confirm before adding a duplicate import.)

- [ ] **Step 4: Write the viewset**

In `core/costing/views.py`, add:

```python
from .serializers import EmployeeSeatCostSerializer


class EmployeeSeatCostViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = EmployeeSeatCostSerializer
    permission_classes = [permissions.IsAuthenticated, IsAdminInAny]

    def get_queryset(self):
        user = cast(User, self.request.user)
        admin_org_ids = list(user.memberships.filter(role="admin").values_list("org_id", flat=True))
        return EmployeeSeatCost.objects.filter(employee__org_id__in=admin_org_ids).select_related("employee")

    def perform_create(self, serializer):
        obj = serializer.save()
        broadcast("employee-seat-costs", "INSERT", EmployeeSeatCostSerializer(obj).data)

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast("employee-seat-costs", "UPDATE", EmployeeSeatCostSerializer(obj).data)

    def perform_destroy(self, instance):
        broadcast("employee-seat-costs", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()
```

- [ ] **Step 5: Register the URL**

In `core/costing/urls.py`, add:

```python
from .views import EmployeeSeatCostViewSet

router.register("employee_seat_costs", EmployeeSeatCostViewSet, basename="employeeseatcost")
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `uv run python manage.py test core.costing.tests.EmployeeSeatCostApiTests -v 2`
Expected: PASS (4 tests)

- [ ] **Step 7: Commit**

```bash
git add core/costing/serializers.py core/costing/views.py core/costing/urls.py core/costing/tests.py
git commit -m "feat(costing): add EmployeeSeatCost API, admin-only, org-scoped by employee"
```

---

### Task 4: Frontend — Seat Cost types, API client, hooks

**Files:**
- Create: `frontend/task-tracker/src/types/api/seatCost.ts`, `frontend/task-tracker/src/lib/api/seatCost.ts`, `frontend/task-tracker/src/hooks/useSeatCostSetting.ts`, `frontend/task-tracker/src/hooks/useEmployeeSeatCosts.ts`, `frontend/task-tracker/src/__tests__/hooks/useSeatCostSetting.test.ts`, `frontend/task-tracker/src/__tests__/hooks/useEmployeeSeatCosts.test.ts`
- Modify: `frontend/task-tracker/src/types/api/index.ts`

**Interfaces:**
- Consumes: `GET/POST/PATCH /api/seat_cost_settings/` and `GET/POST/PATCH/DELETE /api/employee_seat_costs/` (Tasks 2–3), `EmployeeRefDto` (already exists in `@/types/api/costing`).
- Produces: `useSeatCostSetting()` returning `{setting, loading, saving, reload, save}`; `useEmployeeSeatCosts()` returning `{entries, loading, saving, reload, createEntry, editEntry, removeEntry}`.

- [ ] **Step 1: Verify the real serializer field shapes**

Read `core/costing/serializers.py` (Tasks 2–3, already committed) directly to confirm `SeatCostSettingSerializer.Meta.fields` and `EmployeeSeatCostSerializer.Meta.fields` match what's written below.

- [ ] **Step 2: Write the types**

Create `frontend/task-tracker/src/types/api/seatCost.ts`:

```ts
/**
 * DTOs for Seat Cost — mirrors `core/costing/serializers.py`
 * (`SeatCostSettingSerializer`, `EmployeeSeatCostSerializer`).
 */

import type { BaseDto } from "./common";
import type { EmployeeRefDto } from "./costing";

/** Org-wide default seat cost (`/api/seat_cost_settings/`). */
export interface SeatCostSettingDto extends BaseDto {
  readonly org: string;
  readonly org_name: string | null;
  readonly monthly_amount: string;
}

export interface SeatCostSettingForm {
  org?: string;
  monthly_amount: string | number;
}

/** Per-employee override (`/api/employee_seat_costs/`). */
export interface EmployeeSeatCostDto extends BaseDto {
  readonly employee: string; // Employee uid
  readonly employee_detail: EmployeeRefDto | null;
  readonly monthly_amount: string;
}

export interface EmployeeSeatCostCreateForm {
  employee: string;
  monthly_amount: string | number;
}

export interface EmployeeSeatCostEditForm {
  monthly_amount?: string | number;
}
```

- [ ] **Step 3: Write the api client**

Create `frontend/task-tracker/src/lib/api/seatCost.ts`:

```ts
import { apiDelete, apiGet, apiPatch, apiPost } from "./client";
import type {
  EmployeeSeatCostCreateForm,
  EmployeeSeatCostDto,
  EmployeeSeatCostEditForm,
  SeatCostSettingDto,
  SeatCostSettingForm,
} from "@/types/api/seatCost";

export const listSeatCostSettings = () => apiGet<SeatCostSettingDto[]>("/seat_cost_settings/");

export const createSeatCostSetting = (form: SeatCostSettingForm) =>
  apiPost<SeatCostSettingDto>("/seat_cost_settings/", form);

export const editSeatCostSetting = (uid: string, form: SeatCostSettingForm) =>
  apiPatch<SeatCostSettingDto>(`/seat_cost_settings/${uid}/`, form);

export const listEmployeeSeatCosts = () => apiGet<EmployeeSeatCostDto[]>("/employee_seat_costs/");

export const createEmployeeSeatCost = (form: EmployeeSeatCostCreateForm) =>
  apiPost<EmployeeSeatCostDto>("/employee_seat_costs/", form);

export const editEmployeeSeatCost = (uid: string, form: EmployeeSeatCostEditForm) =>
  apiPatch<EmployeeSeatCostDto>(`/employee_seat_costs/${uid}/`, form);

export const deleteEmployeeSeatCost = (uid: string) => apiDelete(`/employee_seat_costs/${uid}/`);
```

- [ ] **Step 4: Write the failing hook tests**

Create `frontend/task-tracker/src/__tests__/hooks/useSeatCostSetting.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useSeatCostSetting } from "@/hooks/useSeatCostSetting";
import * as seatCostApi from "@/lib/api/seatCost";

describe("useSeatCostSetting", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("loads the org's existing setting", async () => {
    vi.spyOn(seatCostApi, "listSeatCostSettings").mockResolvedValue([
      {
        id: 1,
        uid: "s1",
        org: "o1",
        org_name: "Acme Org",
        monthly_amount: "5000.00",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);
    const { result } = renderHook(() => useSeatCostSetting());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.setting?.monthly_amount).toBe("5000.00");
  });

  it("creates a setting when none exists yet", async () => {
    vi.spyOn(seatCostApi, "listSeatCostSettings").mockResolvedValue([]);
    const created = {
      id: 2,
      uid: "s2",
      org: "o1",
      org_name: "Acme Org",
      monthly_amount: "6000.00",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    vi.spyOn(seatCostApi, "createSeatCostSetting").mockResolvedValue(created);
    const { result } = renderHook(() => useSeatCostSetting());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.save("6000", "o1");
    });
    expect(result.current.setting?.uid).toBe("s2");
  });

  it("edits the existing setting instead of creating a second one", async () => {
    vi.spyOn(seatCostApi, "listSeatCostSettings").mockResolvedValue([
      {
        id: 1,
        uid: "s1",
        org: "o1",
        org_name: "Acme Org",
        monthly_amount: "5000.00",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);
    const createSpy = vi.spyOn(seatCostApi, "createSeatCostSetting");
    const editSpy = vi.spyOn(seatCostApi, "editSeatCostSetting").mockResolvedValue({
      id: 1,
      uid: "s1",
      org: "o1",
      org_name: "Acme Org",
      monthly_amount: "9000.00",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
    });
    const { result } = renderHook(() => useSeatCostSetting());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.save("9000");
    });
    expect(editSpy).toHaveBeenCalledWith("s1", { monthly_amount: "9000" });
    expect(createSpy).not.toHaveBeenCalled();
    expect(result.current.setting?.monthly_amount).toBe("9000.00");
  });
});
```

Create `frontend/task-tracker/src/__tests__/hooks/useEmployeeSeatCosts.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useEmployeeSeatCosts } from "@/hooks/useEmployeeSeatCosts";
import * as seatCostApi from "@/lib/api/seatCost";

describe("useEmployeeSeatCosts", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("loads existing overrides", async () => {
    vi.spyOn(seatCostApi, "listEmployeeSeatCosts").mockResolvedValue([
      {
        id: 1,
        uid: "e1",
        employee: "emp1",
        employee_detail: { id: 1, uid: "emp1", employee_name: "Priya" },
        monthly_amount: "7000.00",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);
    const { result } = renderHook(() => useEmployeeSeatCosts());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries).toHaveLength(1);
  });

  it("creates an override and appends it to state", async () => {
    vi.spyOn(seatCostApi, "listEmployeeSeatCosts").mockResolvedValue([]);
    const created = {
      id: 2,
      uid: "e2",
      employee: "emp2",
      employee_detail: { id: 2, uid: "emp2", employee_name: "Rahul" },
      monthly_amount: "8000.00",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    vi.spyOn(seatCostApi, "createEmployeeSeatCost").mockResolvedValue(created);
    const { result } = renderHook(() => useEmployeeSeatCosts());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.createEntry({ employee: "emp2", monthly_amount: 8000 });
    });
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].uid).toBe("e2");
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/hooks/useSeatCostSetting.test.ts src/__tests__/hooks/useEmployeeSeatCosts.test.ts`
Expected: FAIL — modules don't exist yet.

- [ ] **Step 6: Write the hooks**

Create `frontend/task-tracker/src/hooks/useSeatCostSetting.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import { createSeatCostSetting, editSeatCostSetting, listSeatCostSettings } from "@/lib/api/seatCost";
import type { SeatCostSettingDto } from "@/types/api/seatCost";

export interface UseSeatCostSettingReturn {
  setting: SeatCostSettingDto | null;
  loading: boolean;
  saving: boolean;
  reload: () => Promise<void>;
  save: (monthlyAmount: string | number, orgUid?: string) => Promise<SeatCostSettingDto>;
}

export function useSeatCostSetting(): UseSeatCostSettingReturn {
  const [setting, setSetting] = useState<SeatCostSettingDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listSeatCostSettings();
      setSetting(rows[0] ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(
    async (monthlyAmount: string | number, orgUid?: string) => {
      setSaving(true);
      try {
        const saved = setting
          ? await editSeatCostSetting(setting.uid, { monthly_amount: monthlyAmount })
          : await createSeatCostSetting({ monthly_amount: monthlyAmount, org: orgUid });
        setSetting(saved);
        return saved;
      } finally {
        setSaving(false);
      }
    },
    [setting],
  );

  return { setting, loading, saving, reload, save };
}
```

Create `frontend/task-tracker/src/hooks/useEmployeeSeatCosts.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import {
  createEmployeeSeatCost,
  deleteEmployeeSeatCost,
  editEmployeeSeatCost,
  listEmployeeSeatCosts,
} from "@/lib/api/seatCost";
import type {
  EmployeeSeatCostCreateForm,
  EmployeeSeatCostDto,
  EmployeeSeatCostEditForm,
} from "@/types/api/seatCost";

export interface UseEmployeeSeatCostsReturn {
  entries: EmployeeSeatCostDto[];
  loading: boolean;
  saving: boolean;
  reload: () => Promise<void>;
  createEntry: (form: EmployeeSeatCostCreateForm) => Promise<EmployeeSeatCostDto>;
  editEntry: (uid: string, form: EmployeeSeatCostEditForm) => Promise<EmployeeSeatCostDto>;
  removeEntry: (uid: string) => Promise<void>;
}

export function useEmployeeSeatCosts(): UseEmployeeSeatCostsReturn {
  const [entries, setEntries] = useState<EmployeeSeatCostDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listEmployeeSeatCosts();
      setEntries(rows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const createEntry = useCallback(async (form: EmployeeSeatCostCreateForm) => {
    setSaving(true);
    try {
      const created = await createEmployeeSeatCost(form);
      setEntries((prev) => [...prev, created]);
      return created;
    } finally {
      setSaving(false);
    }
  }, []);

  const editEntry = useCallback(async (uid: string, form: EmployeeSeatCostEditForm) => {
    setSaving(true);
    try {
      const updated = await editEmployeeSeatCost(uid, form);
      setEntries((prev) => prev.map((e) => (e.uid === uid ? updated : e)));
      return updated;
    } finally {
      setSaving(false);
    }
  }, []);

  const removeEntry = useCallback(async (uid: string) => {
    setSaving(true);
    try {
      await deleteEmployeeSeatCost(uid);
      setEntries((prev) => prev.filter((e) => e.uid !== uid));
    } finally {
      setSaving(false);
    }
  }, []);

  return { entries, loading, saving, reload, createEntry, editEntry, removeEntry };
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/hooks/useSeatCostSetting.test.ts src/__tests__/hooks/useEmployeeSeatCosts.test.ts`
Expected: PASS (3 + 2 tests)

- [ ] **Step 8: Add to the barrel export**

In `frontend/task-tracker/src/types/api/index.ts`, add alphabetically:

```ts
export * from "./seatCost";
```

- [ ] **Step 9: Typecheck**

Run: `cd frontend/task-tracker && npx tsc -b`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add frontend/task-tracker/src/types/api/seatCost.ts frontend/task-tracker/src/lib/api/seatCost.ts frontend/task-tracker/src/hooks/useSeatCostSetting.ts frontend/task-tracker/src/hooks/useEmployeeSeatCosts.ts frontend/task-tracker/src/__tests__/hooks/useSeatCostSetting.test.ts frontend/task-tracker/src/__tests__/hooks/useEmployeeSeatCosts.test.ts frontend/task-tracker/src/types/api/index.ts
git commit -m "feat(costing): add Seat Cost frontend types, api client, and hooks"
```

---

### Task 5: Frontend — profitability aggregation utility

**Files:**
- Create: `frontend/task-tracker/src/utils/profitability.ts`, `frontend/task-tracker/src/__tests__/utils/profitability.test.ts`

**Interfaces:**
- Consumes: `CostingEntryDto` (`@/types/api/costing`), `Employee`/`SalaryRecord` (`@/types`), `SeatCostSettingDto`/`EmployeeSeatCostDto` (Task 4).
- Produces: `computeProfitability(costingEntries, employees, salaries, seatCostSetting, employeeSeatCosts): ProfitabilityRow[]`, `computeProfitabilityGrandTotal(rows): ProfitabilityGrandTotal`, types `ProfitabilityRow`, `ProfitabilityStatus`, `ProfitabilityGrandTotal`.

- [ ] **Step 1: Write the failing test**

Create `frontend/task-tracker/src/__tests__/utils/profitability.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeProfitability, computeProfitabilityGrandTotal } from "@/utils/profitability";
import type { CostingEntryDto } from "@/types/api/costing";
import type { Employee, SalaryRecord } from "@/types";
import type { EmployeeSeatCostDto, SeatCostSettingDto } from "@/types/api/seatCost";

function makeCostingEntry(overrides: Partial<CostingEntryDto>): CostingEntryDto {
  return {
    id: 1,
    uid: "c1",
    org: "o1",
    org_name: "Org",
    client: "cl1",
    client_detail: null,
    designation: "d1",
    designation_detail: null,
    employee: null,
    employee_detail: null,
    hr_day: "0",
    days_working: "0",
    total: "0",
    created_by_uid: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeEmployee(overrides: Partial<Employee>): Employee {
  return {
    id: "emp1",
    org: "o1",
    employee_name: "Priya",
    father_name: null,
    phone: null,
    alt_phone: null,
    email: null,
    designation: null,
    designation_uid: null,
    designation_name: null,
    department: null,
    status: "Active",
    gender: null,
    marital_status: null,
    date_of_birth: null,
    blood_group: null,
    permanent_address: null,
    current_address: null,
    address_proof_url: null,
    emergency_contact_name: null,
    emergency_contact_phone: null,
    reference_name: null,
    reference_contact: null,
    date_of_joining: null,
    created_by: null,
    created_at: null,
    updated_at: null,
    ...overrides,
  } as Employee;
}

function makeSalary(overrides: Partial<SalaryRecord>): SalaryRecord {
  return {
    id: "s1",
    employee_id: "emp1",
    employee_name: "Priya",
    designation: null,
    department: null,
    date_of_joining: null,
    fixed_salary: 30000,
    basic_salary: null,
    hra: null,
    da: null,
    other_allowances: null,
    pf_number: null,
    effective_from: "2026-01-01",
    updated_at: null,
    ...overrides,
  } as SalaryRecord;
}

describe("computeProfitability", () => {
  it("sums client value across multiple costing entries for the same employee", () => {
    const rows = computeProfitability(
      [
        makeCostingEntry({ uid: "c1", employee: "emp1", total: "20000" }),
        makeCostingEntry({ uid: "c2", employee: "emp1", total: "15000" }),
      ],
      [makeEmployee({})],
      [makeSalary({ fixed_salary: 30000 })],
      null,
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].clientValue).toBe(35000);
    expect(rows[0].salary).toBe(30000);
    expect(rows[0].seatCost).toBe(0);
    expect(rows[0].cost).toBe(30000);
  });

  it("uses the org default seat cost when no override exists", () => {
    const rows = computeProfitability(
      [makeCostingEntry({ uid: "c1", employee: "emp1", total: "40000" })],
      [makeEmployee({})],
      [makeSalary({ fixed_salary: 30000 })],
      {
        id: 1,
        uid: "s1",
        org: "o1",
        org_name: "Org",
        monthly_amount: "5000",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      } as SeatCostSettingDto,
      [],
    );
    expect(rows[0].seatCost).toBe(5000);
    expect(rows[0].cost).toBe(35000);
  });

  it("prefers a per-employee seat cost override over the org default", () => {
    const rows = computeProfitability(
      [makeCostingEntry({ uid: "c1", employee: "emp1", total: "40000" })],
      [makeEmployee({})],
      [makeSalary({ fixed_salary: 30000 })],
      {
        id: 1,
        uid: "s1",
        org: "o1",
        org_name: "Org",
        monthly_amount: "5000",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      } as SeatCostSettingDto,
      [
        {
          id: 1,
          uid: "e1",
          employee: "emp1",
          employee_detail: null,
          monthly_amount: "8000",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        } as EmployeeSeatCostDto,
      ],
    );
    expect(rows[0].seatCost).toBe(8000);
  });

  it("flags an employee with no salary record rather than treating them as free", () => {
    const rows = computeProfitability(
      [makeCostingEntry({ uid: "c1", employee: "emp1", total: "40000" })],
      [makeEmployee({})],
      [],
      null,
      [],
    );
    expect(rows[0].hasSalary).toBe(false);
    expect(rows[0].salary).toBe(0);
  });

  it("picks the most recent salary record by effective_from", () => {
    const rows = computeProfitability(
      [makeCostingEntry({ uid: "c1", employee: "emp1", total: "40000" })],
      [makeEmployee({})],
      [
        makeSalary({ id: "s1", fixed_salary: 25000, effective_from: "2025-01-01" }),
        makeSalary({ id: "s2", fixed_salary: 32000, effective_from: "2026-01-01" }),
      ],
      null,
      [],
    );
    expect(rows[0].salary).toBe(32000);
  });

  it("marks Profitable when client value exceeds cost by more than 5%", () => {
    const rows = computeProfitability(
      [makeCostingEntry({ uid: "c1", employee: "emp1", total: "40000" })],
      [makeEmployee({})],
      [makeSalary({ fixed_salary: 30000 })],
      null,
      [],
    );
    expect(rows[0].status).toBe("Profitable");
  });

  it("marks Loss when client value is more than 5% below cost", () => {
    const rows = computeProfitability(
      [makeCostingEntry({ uid: "c1", employee: "emp1", total: "20000" })],
      [makeEmployee({})],
      [makeSalary({ fixed_salary: 30000 })],
      null,
      [],
    );
    expect(rows[0].status).toBe("Loss");
  });

  it("marks Break-even when client value is within 5% of cost", () => {
    const rows = computeProfitability(
      [makeCostingEntry({ uid: "c1", employee: "emp1", total: "31000" })],
      [makeEmployee({})],
      [makeSalary({ fixed_salary: 30000 })],
      null,
      [],
    );
    expect(rows[0].status).toBe("Break-even");
  });

  it("excludes employees with no costing entries and no seat cost override", () => {
    const rows = computeProfitability([], [makeEmployee({})], [makeSalary({})], null, []);
    expect(rows).toHaveLength(0);
  });
});

describe("computeProfitabilityGrandTotal", () => {
  it("sums every row", () => {
    const rows = computeProfitability(
      [
        makeCostingEntry({ uid: "c1", employee: "emp1", total: "40000" }),
        makeCostingEntry({ uid: "c2", employee: "emp2", total: "10000" }),
      ],
      [makeEmployee({}), makeEmployee({ id: "emp2", employee_name: "Rahul" })],
      [makeSalary({ fixed_salary: 30000 }), makeSalary({ id: "s2", employee_id: "emp2", fixed_salary: 20000 })],
      null,
      [],
    );
    const total = computeProfitabilityGrandTotal(rows);
    expect(total.clientValue).toBe(50000);
    expect(total.salary).toBe(50000);
    expect(total.cost).toBe(50000);
    expect(total.profit).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/utils/profitability.test.ts`
Expected: FAIL — `Cannot find module '@/utils/profitability'`.

- [ ] **Step 3: Write the utility**

Create `frontend/task-tracker/src/utils/profitability.ts`:

```ts
import type { CostingEntryDto } from "@/types/api/costing";
import type { Employee, SalaryRecord } from "@/types";
import type { EmployeeSeatCostDto, SeatCostSettingDto } from "@/types/api/seatCost";

export type ProfitabilityStatus = "Profitable" | "Break-even" | "Loss";

export interface ProfitabilityRow {
  employeeId: string;
  employeeName: string;
  clientValue: number;
  salary: number;
  hasSalary: boolean;
  seatCost: number;
  cost: number;
  profit: number;
  marginPct: number;
  status: ProfitabilityStatus;
}

export interface ProfitabilityGrandTotal {
  clientValue: number;
  salary: number;
  seatCost: number;
  cost: number;
  profit: number;
  marginPct: number;
}

const BREAK_EVEN_TOLERANCE = 0.05; // ±5%

function statusFor(clientValue: number, cost: number): ProfitabilityStatus {
  if (cost === 0) {
    return clientValue === 0 ? "Break-even" : "Profitable";
  }
  const ratio = clientValue / cost;
  if (ratio > 1 + BREAK_EVEN_TOLERANCE) return "Profitable";
  if (ratio < 1 - BREAK_EVEN_TOLERANCE) return "Loss";
  return "Break-even";
}

function currentSalary(salaries: readonly SalaryRecord[], employeeId: string): number | null {
  const forEmployee = salaries.filter((s) => s.employee_id === employeeId && s.fixed_salary !== null);
  if (forEmployee.length === 0) return null;
  const latest = forEmployee.reduce((a, b) =>
    (a.effective_from ?? "") >= (b.effective_from ?? "") ? a : b,
  );
  return latest.fixed_salary;
}

/** Per-employee comparison of client-billed Costing value against what
 *  that employee costs the org (salary + seat cost). Only includes
 *  employees with at least one Costing entry (non-zero total) or a
 *  seat-cost override — everyone else has nothing to compare. */
export function computeProfitability(
  costingEntries: readonly CostingEntryDto[],
  employees: readonly Employee[],
  salaries: readonly SalaryRecord[],
  seatCostSetting: SeatCostSettingDto | null,
  employeeSeatCosts: readonly EmployeeSeatCostDto[],
): ProfitabilityRow[] {
  const clientValueByEmployee = new Map<string, number>();
  for (const entry of costingEntries) {
    if (!entry.employee) continue;
    const amount = Number.parseFloat(entry.total) || 0;
    clientValueByEmployee.set(entry.employee, (clientValueByEmployee.get(entry.employee) ?? 0) + amount);
  }

  const seatCostOverrideByEmployee = new Map<string, number>();
  for (const item of employeeSeatCosts) {
    seatCostOverrideByEmployee.set(item.employee, Number.parseFloat(item.monthly_amount) || 0);
  }
  const orgDefaultSeatCost = seatCostSetting ? Number.parseFloat(seatCostSetting.monthly_amount) || 0 : 0;

  const employeeIds = new Set<string>([
    ...clientValueByEmployee.keys(),
    ...seatCostOverrideByEmployee.keys(),
  ]);

  const rows: ProfitabilityRow[] = [];
  for (const employeeId of employeeIds) {
    const employee = employees.find((e) => e.id === employeeId);
    const clientValue = clientValueByEmployee.get(employeeId) ?? 0;
    const seatCost = seatCostOverrideByEmployee.get(employeeId) ?? orgDefaultSeatCost;
    const salary = currentSalary(salaries, employeeId);
    const hasSalary = salary !== null;
    const cost = (salary ?? 0) + seatCost;
    const profit = clientValue - cost;
    const marginPct = cost !== 0 ? (profit / cost) * 100 : 0;
    rows.push({
      employeeId,
      employeeName: employee?.employee_name ?? "Unknown",
      clientValue,
      salary: salary ?? 0,
      hasSalary,
      seatCost,
      cost,
      profit,
      marginPct,
      status: statusFor(clientValue, cost),
    });
  }
  return rows.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
}

/** Rolls every profitability row up into a single grand-total summary. */
export function computeProfitabilityGrandTotal(
  rows: readonly ProfitabilityRow[],
): ProfitabilityGrandTotal {
  const clientValue = rows.reduce((sum, r) => sum + r.clientValue, 0);
  const salary = rows.reduce((sum, r) => sum + r.salary, 0);
  const seatCost = rows.reduce((sum, r) => sum + r.seatCost, 0);
  const cost = rows.reduce((sum, r) => sum + r.cost, 0);
  const profit = clientValue - cost;
  const marginPct = cost !== 0 ? (profit / cost) * 100 : 0;
  return { clientValue, salary, seatCost, cost, profit, marginPct };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend/task-tracker && npx vitest run src/__tests__/utils/profitability.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/utils/profitability.ts frontend/task-tracker/src/__tests__/utils/profitability.test.ts
git commit -m "feat(costing): add profitability aggregation utility"
```

---

### Task 6: Frontend — CostingPage tab bar (Seat Cost, Employee Seat Cost, Profitability)

**Files:**
- Modify: `frontend/task-tracker/src/pages/CostingPage.tsx`

**Interfaces:**
- Consumes: `useSeatCostSetting`, `useEmployeeSeatCosts` (Task 4), `computeProfitability`/`computeProfitabilityGrandTotal` (Task 5), `useEmployees()` (existing — provides both `employees` and `salaries`), `listCostingEntries` (existing, `@/lib/api/costing` — called with no argument to fetch every Costing entry visible to the caller, not just one client's).
- Produces: `CostingPage` renders an admin-only tab bar; non-admins see exactly today's single table (no behavior change for them).

- [ ] **Step 1: Verify admin detection**

Read `frontend/task-tracker/src/types/api/profile.ts` to confirm `Profile.highest_role: RoleValue` exists (`RoleValue = "admin" | "manager" | "employee"`) — this is how you'll gate the tab bar (`profile?.highest_role === "admin"`). `CostingPage` doesn't currently receive `profile` even though `CostingPageProps` declares it — check `App.tsx`'s `VIEW_MAP` entry for `costing` to confirm `profile` is actually passed through (it should be, since the prop is already declared) and that `CostingPage`'s function signature destructures it (currently it destructures only `{ selectedOrg }` — you'll need to add `profile` to that destructure).

- [ ] **Step 2: Add the tab bar and three new tab bodies**

In `frontend/task-tracker/src/pages/CostingPage.tsx`:

Update the imports and props destructure:

```tsx
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Profile } from "@/types";
import { useCosting } from "@/hooks/useCosting";
import { useMasters } from "@/hooks/useMasters";
import { useEmployees } from "@/hooks/useEmployees";
import { useSeatCostSetting } from "@/hooks/useSeatCostSetting";
import { useEmployeeSeatCosts } from "@/hooks/useEmployeeSeatCosts";
import { listCostingEntries } from "@/lib/api/costing";
import {
  computeProfitability,
  computeProfitabilityGrandTotal,
} from "@/utils/profitability";
import type { CostingEntryDto } from "@/types/api/costing";
import type { EmployeeSeatCostDto } from "@/types/api/seatCost";
```

Change the component signature and add tab state right after the existing hook calls:

```tsx
export default function CostingPage({ profile, selectedOrg }: CostingPageProps) {
  const isAdmin = profile?.highest_role === "admin";
  const [activeTab, setActiveTab] = useState<"costing" | "seatCost" | "employeeSeatCost" | "profitability">(
    "costing",
  );
```

(This goes immediately after `export default function CostingPage({ ... }: CostingPageProps) {` — keep every existing hook call/state/handler in the function body exactly as-is below this, just wrapped by the new tab-bar JSX described in Step 3. Do not change `handleSave`/`handleDelete`/`openAdd`/`openEdit` or any of the existing Costing-table logic.)

- [ ] **Step 3: Wrap the existing return in tab bar + conditional bodies**

The existing `return (...)` renders the page title, filter bar, table, and modal directly. Change it so:
- The page title row keeps "💰 Costing" but the "+ Add Row" button only shows when `activeTab === "costing" && selectedClient`.
- Directly below the title row, add a tab bar (rendered only `{isAdmin && (...)}`) with four buttons: Costing, Seat Cost, Employee Seat Cost, Profitability — clicking sets `activeTab`.
- The existing filter bar + table + modal block only renders `{activeTab === "costing" && (...)}` (wrap the existing JSX, don't rewrite it).
- Add three new conditional blocks for the other tabs, each only reachable when `isAdmin` (non-admins never see the tab bar, so `activeTab` can never become anything but `"costing"` for them — but guard the tab BODIES on `isAdmin` too, defensively, not just the tab bar buttons).

Add the tab bar JSX (insert directly after the closing `</div>` of the existing title-row `<div>` that contains "💰 Costing" and the Add Row button, before the existing filter-bar `<div className="dm-filter-bar">`):

```tsx
      {isAdmin && (
        <div style={{ display: "flex", gap: 4, marginBottom: 12, borderBottom: "2px solid #e2e8f0" }}>
          {(
            [
              ["costing", "Costing"],
              ["seatCost", "Seat Cost"],
              ["employeeSeatCost", "Employee Seat Cost"],
              ["profitability", "Profitability"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              style={{
                padding: "8px 16px",
                background: "none",
                border: "none",
                borderBottom: activeTab === id ? "2px solid #2563eb" : "2px solid transparent",
                marginBottom: -2,
                color: activeTab === id ? "#2563eb" : "#64748b",
                fontWeight: activeTab === id ? 700 : 500,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
```

Wrap the title row's "+ Add Row" button condition (currently `{selectedClient && (...)}`) to also require the Costing tab:

```tsx
        {activeTab === "costing" && selectedClient && (
```

Wrap the existing filter-bar + table + modal block (everything from `<div className="dm-filter-bar">` through the closing of the `{modal && (...)}` block) in:

```tsx
      {activeTab === "costing" && (
        <>
          {/* existing filter bar, "select a client" message, table, and modal JSX go here unchanged */}
        </>
      )}
```

- [ ] **Step 4: Add the Seat Cost tab body**

Add this component-level state and JSX (as a sibling to the `{activeTab === "costing" && (...)}` block, still inside `CostingPage`'s return, gated by both the tab and `isAdmin`):

```tsx
      {isAdmin && activeTab === "seatCost" && <SeatCostTab orgUid={selectedOrg} />}
```

Define `SeatCostTab` as a separate function component in the same file, below `CostingPage`:

```tsx
function SeatCostTab({ orgUid }: { orgUid?: string }) {
  const { setting, loading, saving, save } = useSeatCostSetting();
  const [amount, setAmount] = useState<string>("");

  useEffect(() => {
    if (setting) setAmount(setting.monthly_amount);
  }, [setting]);

  const handleSave = async (): Promise<void> => {
    try {
      await save(amount || 0, orgUid);
      alert("Seat cost saved.");
    } catch (err) {
      alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (loading) return <div style={{ padding: 30, color: "#94a3b8" }}>Loading…</div>;

  return (
    <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", padding: 24, maxWidth: 360 }}>
      <label style={labelS}>Monthly Seat Cost</label>
      <input
        type="number"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        style={inpS}
      />
      <div style={{ marginTop: 16 }}>
        <button
          onClick={() => void handleSave()}
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
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Add the Employee Seat Cost tab body**

Add the render line alongside the Seat Cost one:

```tsx
      {isAdmin && activeTab === "employeeSeatCost" && <EmployeeSeatCostTab />}
```

Define `EmployeeSeatCostTab` below `SeatCostTab`:

```tsx
function EmployeeSeatCostTab() {
  const { employees } = useEmployees();
  const { entries, loading, saving, createEntry, editEntry, removeEntry } = useEmployeeSeatCosts();
  const [modal, setModal] = useState<{ row?: EmployeeSeatCostDto } | null>(null);
  const [form, setForm] = useState<{ employee: string; amount: string }>({ employee: "", amount: "" });
  const isSavingRef = useRef(false);

  const openAdd = (): void => {
    setForm({ employee: "", amount: "" });
    setModal({});
  };

  const openEdit = (row: EmployeeSeatCostDto): void => {
    setForm({ employee: row.employee, amount: row.monthly_amount });
    setModal({ row });
  };

  const handleSave = async (): Promise<void> => {
    if (isSavingRef.current) return;
    if (!form.employee) {
      alert("Select an employee");
      return;
    }
    isSavingRef.current = true;
    try {
      if (modal?.row) {
        await editEntry(modal.row.uid, { monthly_amount: form.amount || 0 });
      } else {
        await createEntry({ employee: form.employee, monthly_amount: form.amount || 0 });
      }
      setModal(null);
    } catch (err) {
      alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      isSavingRef.current = false;
    }
  };

  const handleDelete = async (row: EmployeeSeatCostDto): Promise<void> => {
    if (!window.confirm("Delete this seat cost override?")) return;
    await removeEntry(row.uid);
  };

  return (
    <div>
      <div style={{ marginBottom: 12, textAlign: "right" }}>
        <button
          onClick={openAdd}
          style={{
            padding: "7px 16px",
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 7,
            cursor: "pointer",
            fontWeight: 700,
            fontSize: 13,
          }}
        >
          + Add Override
        </button>
      </div>
      <div
        style={{
          background: "#fff",
          borderRadius: 10,
          border: "1px solid #e2e8f0",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={thS}>Employee</th>
              <th style={{ ...thS, width: 140 }}>Seat Cost</th>
              <th style={{ ...thS, width: 90 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={3} style={{ ...tdS, textAlign: "center", padding: 30, color: "#94a3b8" }}>
                  Loading…
                </td>
              </tr>
            )}
            {!loading && entries.length === 0 && (
              <tr>
                <td colSpan={3} style={{ ...tdS, textAlign: "center", padding: 30, color: "#94a3b8" }}>
                  No overrides yet.
                </td>
              </tr>
            )}
            {!loading &&
              entries.map((row) => (
                <tr key={row.uid}>
                  <td style={tdS}>{row.employee_detail?.employee_name ?? "—"}</td>
                  <td style={tdS}>{row.monthly_amount}</td>
                  <td style={{ ...tdS, whiteSpace: "nowrap" }}>
                    <button
                      onClick={() => openEdit(row)}
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14 }}
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => void handleDelete(row)}
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14 }}
                    >
                      🗑️
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

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
          onClick={() => setModal(null)}
        >
          <div
            style={{ background: "#fff", borderRadius: 14, padding: 28, minWidth: 340 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ marginBottom: 16 }}>
              <label style={labelS}>Employee *</label>
              <select
                value={form.employee}
                onChange={(e) => setForm({ ...form, employee: e.target.value })}
                style={inpS}
                disabled={!!modal.row}
              >
                <option value="">Select…</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.employee_name}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={labelS}>Monthly Seat Cost *</label>
              <input
                type="number"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                style={inpS}
              />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setModal(null)} style={{ padding: "8px 18px", cursor: "pointer" }}>
                Cancel
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={saving}
                style={{
                  padding: "8px 18px",
                  background: "#2563eb",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  cursor: "pointer",
                  fontWeight: 700,
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

- [ ] **Step 6: Add the Profitability tab body**

Add the render line:

```tsx
      {isAdmin && activeTab === "profitability" && <ProfitabilityTab />}
```

Define `ProfitabilityTab` below `EmployeeSeatCostTab`:

```tsx
function ProfitabilityTab() {
  const { employees, salaries } = useEmployees();
  const { setting: seatCostSetting } = useSeatCostSetting();
  const { entries: seatCostOverrides } = useEmployeeSeatCosts();
  const [allCostingEntries, setAllCostingEntries] = useState<CostingEntryDto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listCostingEntries()
      .then((rows) => {
        if (!cancelled) setAllCostingEntries(rows);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(
    () => computeProfitability(allCostingEntries, employees, salaries, seatCostSetting, seatCostOverrides),
    [allCostingEntries, employees, salaries, seatCostSetting, seatCostOverrides],
  );
  const grandTotal = useMemo(() => computeProfitabilityGrandTotal(rows), [rows]);

  if (loading) return <div style={{ padding: 30, color: "#94a3b8" }}>Loading…</div>;

  return (
    <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            <th style={thS}>Employee</th>
            <th style={{ ...thS, width: 110 }}>Client Value</th>
            <th style={{ ...thS, width: 100 }}>Salary</th>
            <th style={{ ...thS, width: 100 }}>Seat Cost</th>
            <th style={{ ...thS, width: 100 }}>Total Cost</th>
            <th style={{ ...thS, width: 100 }}>Profit</th>
            <th style={{ ...thS, width: 90 }}>Margin %</th>
            <th style={{ ...thS, width: 110 }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} style={{ ...tdS, textAlign: "center", padding: 30, color: "#94a3b8" }}>
                No employees with Costing entries or seat cost overrides yet.
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr key={row.employeeId}>
              <td style={{ ...tdS, fontWeight: 600 }}>
                {row.employeeName}
                {!row.hasSalary && (
                  <span style={{ color: "#dc2626", fontSize: 11, marginLeft: 6 }}>(No salary on file)</span>
                )}
              </td>
              <td style={tdS}>{row.clientValue.toFixed(2)}</td>
              <td style={tdS}>{row.salary.toFixed(2)}</td>
              <td style={tdS}>{row.seatCost.toFixed(2)}</td>
              <td style={tdS}>{row.cost.toFixed(2)}</td>
              <td style={tdS}>{row.profit.toFixed(2)}</td>
              <td style={tdS}>{row.marginPct.toFixed(1)}%</td>
              <td style={tdS}>
                <span
                  style={{
                    display: "inline-block",
                    padding: "3px 10px",
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#fff",
                    background:
                      row.status === "Profitable" ? "#16a34a" : row.status === "Loss" ? "#dc2626" : "#d97706",
                  }}
                >
                  {row.status}
                </span>
              </td>
            </tr>
          ))}
          {rows.length > 0 && (
            <tr style={{ background: "#f8fafc", fontWeight: 800 }}>
              <td style={tdS}>Grand Total</td>
              <td style={tdS}>{grandTotal.clientValue.toFixed(2)}</td>
              <td style={tdS}>{grandTotal.salary.toFixed(2)}</td>
              <td style={tdS}>{grandTotal.seatCost.toFixed(2)}</td>
              <td style={tdS}>{grandTotal.cost.toFixed(2)}</td>
              <td style={tdS}>{grandTotal.profit.toFixed(2)}</td>
              <td style={tdS}>{grandTotal.marginPct.toFixed(1)}%</td>
              <td style={tdS}>—</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 7: Typecheck and lint**

Run: `cd frontend/task-tracker && npx tsc -b`
Expected: clean.

Run: `cd frontend/task-tracker && npx eslint src/pages/CostingPage.tsx`
Expected: clean.

- [ ] **Step 8: Run the full frontend suite as a regression check**

Run: `cd frontend/task-tracker && npx vitest run`
Expected: all tests pass, no regressions.

- [ ] **Step 9: Manual verification**

Start both dev servers (`npm run dev` in `frontend/task-tracker`, `uv run python manage.py runserver` from the project root).

1. Log in as `admin@example.com` / `admin@123`.
2. Open Costing — confirm the tab bar now appears with Costing / Seat Cost / Employee Seat Cost / Profitability.
3. Confirm the "Costing" tab still works exactly as before (client dropdown, add/edit/delete rows).
4. Go to "Seat Cost", enter an amount, Save. Reload the page, confirm it persisted (fetch-or-create working correctly — second save should PATCH, not create a duplicate).
5. Go to "Employee Seat Cost", add an override for one employee, confirm it appears; edit it, confirm it updates; delete it, confirm it's removed.
6. Go to "Profitability" — confirm employees with Costing entries appear with correct Client Value/Salary/Seat Cost/Cost/Profit/Status, and the Grand Total row sums correctly.
7. Log in as a non-admin user with `costing_access` — confirm they see ONLY the Costing table, no tab bar at all.

If browser automation isn't available, verify via direct API calls (login as admin → create a `SeatCostSetting` → create an `EmployeeSeatCost` → confirm both round-trip correctly via GET) and say explicitly what was and wasn't verified.

- [ ] **Step 10: Commit**

```bash
git add frontend/task-tracker/src/pages/CostingPage.tsx
git commit -m "feat(costing): add Seat Cost and Profitability tabs to CostingPage"
```
