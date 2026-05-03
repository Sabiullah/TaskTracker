# Invoice Attribution & Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Project Status, Invoice Categories, and Owners (with contribution %) to invoice plans/entries, and surface a Report tab that pivots attributed value across the FY.

**Architecture:** Backend introduces a new `InvoiceCategory` model and four through tables (`InvoicePlanCategory`, `InvoicePlanOwner`, `InvoiceEntryCategory`, `InvoiceEntryOwner`) holding `contribution_pct`. Plan defaults are copied onto entries at generation time and editable per entry afterwards. A new server-side aggregation endpoint (`/api/invoice_reports/`) returns pivot-ready rows. Frontend extends `PlanModal`, `ScheduleTab`, and `AmountEditModal`, and adds a new `ReportTab`. Migration is purely additive — existing entries, files, and amounts are preserved.

**Tech Stack:** Django 5 + DRF, React + TypeScript + Vite, vitest for frontend tests, pytest+APIClient for backend.

**Spec:** [docs/superpowers/specs/2026-05-03-invoice-attribution-and-reporting-design.md](../specs/2026-05-03-invoice-attribution-and-reporting-design.md)

---

## File Structure

### Backend — `core/invoices/`

| File | Action | Responsibility |
| --- | --- | --- |
| `models.py` | modify | Add `InvoiceCategory`, four through models, `project_status` and M2Ms on `InvoicePlan`/`InvoiceEntry` |
| `serializers.py` | modify | Add `InvoiceCategorySerializer`; extend plan/entry serializers with attribution fields + sum-100 validation |
| `views.py` | modify | Add `InvoiceCategoryViewSet`, `InvoiceReportView`; update `generate` to copy plan defaults; add `?project_status=` filter |
| `urls.py` | modify | Register new viewsets/views |
| `admin.py` | modify | Register `InvoiceCategory`; add inlines for the through tables |
| `tests.py` | modify | Add tests for category CRUD, generate-copies-defaults, sum=100 validation, report math/reconciliation |
| `migrations/0004_invoicecategory.py` | create | Create `InvoiceCategory` table |
| `migrations/0005_project_status.py` | create | Add `project_status` columns |
| `migrations/0006_attribution_through_tables.py` | create | Create the four through tables and add M2M fields |

### Frontend — `frontend/task-tracker/src/`

| File | Action | Responsibility |
| --- | --- | --- |
| `types/api/invoice.ts` | modify | Add DTO fields (`project_status`, `categories`, `owners`, attribution payloads), `InvoiceCategoryDto`, report DTOs |
| `types/invoice.ts` | modify | Add domain type fields and `InvoiceCategory` |
| `hooks/useInvoices.ts` | modify | Map new attribution fields in DTO→domain |
| `hooks/useInvoiceCategories.ts` | create | CRUD + realtime for categories |
| `components/invoice/AttributionChips.tsx` | create | Reusable chip-input for `[{key, contribution_pct}]` lists with live sum indicator |
| `components/invoice/PlanModal.tsx` | modify | Add Project Status select + Categories/Owners chip-inputs |
| `components/invoice/ScheduleTab.tsx` | modify | Add filter bar; inline category/owner badges; attributed-value cell totals |
| `components/invoice/AmountEditModal.tsx` | modify | Add collapsible Attribution section (status + chips) |
| `components/invoice/ReportTab.tsx` | create | New tab — pivot table from `/api/invoice_reports/` with filters and CSV export |
| `pages/InvoicePage.tsx` | modify | Wire up the new tab and shared filter state |
| `components/invoice/InvoiceCategoriesAdmin.tsx` | create | Small CRUD UI (modal launched from PlanModal + accessible from a settings cog on ScheduleTab) |
| `utils/invoice.ts` | modify | Add helpers: `attributedValue(entry, dim)`, `validateContributionPcts(items)`, `summariseChips(items)` |

---

## Task Order Rationale

1. **Backend first** — model, migration, serializer, generate, report endpoint, tests. Each task lands working software (tests pass, server runs).
2. **Frontend types & hooks** — match the DTO shape so the rest of the UI compiles cleanly.
3. **Reusable chip-input component** — used in PlanModal, AmountEditModal, and ReportTab filters.
4. **PlanModal → ScheduleTab → AmountEditModal → ReportTab → CategoriesAdmin** — small surfaces first, then the new tab.

---

## Task 1: Create `InvoiceCategory` model + migration + admin

**Files:**
- Modify: `core/invoices/models.py`
- Create: `core/invoices/migrations/0004_invoicecategory.py`
- Modify: `core/invoices/admin.py`
- Modify: `core/invoices/tests.py`

- [ ] **Step 1: Write the failing test**

Append to `core/invoices/tests.py`:

```python
class InvoiceCategoryModelTests(TestCase):
    def test_unique_per_org(self):
        from core.invoices.models import InvoiceCategory

        org, _ = _make_org_admin("cat_admin")
        InvoiceCategory.objects.create(org=org, name="Audit")
        with self.assertRaises(Exception):
            InvoiceCategory.objects.create(org=org, name="Audit")

    def test_same_name_allowed_across_orgs(self):
        from core.invoices.models import InvoiceCategory

        org1, _ = _make_org_admin("cat_a1")
        org2, _ = _make_org_admin("cat_a2")
        InvoiceCategory.objects.create(org=org1, name="Audit")
        InvoiceCategory.objects.create(org=org2, name="Audit")  # must not raise
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd D:/TaskTracker && python -m pytest core/invoices/tests.py::InvoiceCategoryModelTests -v
```

Expected: ImportError / cannot import name 'InvoiceCategory'.

- [ ] **Step 3: Add the model**

Append to `core/invoices/models.py`:

```python
class InvoiceCategory(TimeStampedModel):
    id: int

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    name = models.CharField(max_length=255)
    org = models.ForeignKey(
        "users.Org",
        on_delete=models.PROTECT,
        related_name="invoice_categories",
    )
    color = models.CharField(max_length=20, blank=True, default="")
    is_active = models.BooleanField(default=True, db_index=True)
    sort_order = models.IntegerField(default=0)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="created_invoice_categories",
    )

    class Meta:
        ordering = ["sort_order", "name"]
        unique_together = ("org", "name")
        verbose_name = "invoice category"
        verbose_name_plural = "invoice categories"

    def __str__(self):
        return self.name
```

- [ ] **Step 4: Generate migration**

```bash
cd D:/TaskTracker && python manage.py makemigrations invoices --name invoicecategory
```

Verify the file is `core/invoices/migrations/0004_invoicecategory.py` and contains `CreateModel('InvoiceCategory', ...)`. If a different number is generated, rename it (and any subsequent steps reference `0004`).

- [ ] **Step 5: Run migrations + tests**

```bash
cd D:/TaskTracker && python manage.py migrate && python -m pytest core/invoices/tests.py::InvoiceCategoryModelTests -v
```

Expected: both pass.

- [ ] **Step 6: Register in admin**

Modify `core/invoices/admin.py`. Add at the bottom:

```python
from .models import InvoiceCategory  # add to existing import line

@admin.register(InvoiceCategory)
class InvoiceCategoryAdmin(admin.ModelAdmin):
    list_display = ["name", "org", "color", "is_active", "sort_order"]
    list_filter = ["org", "is_active"]
    search_fields = ["name"]
    readonly_fields = ["uid", "created_at", "updated_at"]
```

- [ ] **Step 7: Commit**

```bash
git add core/invoices/models.py core/invoices/migrations/0004_invoicecategory.py core/invoices/admin.py core/invoices/tests.py
git commit -m "feat(invoices): add InvoiceCategory model"
```

---

## Task 2: `InvoiceCategory` API (serializer + viewset + URL + realtime + tests)

**Files:**
- Modify: `core/invoices/serializers.py`
- Modify: `core/invoices/views.py`
- Modify: `core/invoices/urls.py`
- Modify: `core/invoices/tests.py`

- [ ] **Step 1: Write the failing test**

Append to `core/invoices/tests.py`:

```python
class InvoiceCategoryApiTests(TestCase):
    def setUp(self):
        self.org, self.admin = _make_org_admin("cat_api_admin")
        self.api = APIClient()
        _auth(self.api, self.admin)

    def test_admin_can_create_and_list(self):
        res = self.api.post(
            "/api/invoice_categories/",
            {"name": "Audit", "org": str(self.org.uid)},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)
        list_res = self.api.get("/api/invoice_categories/")
        self.assertEqual(list_res.status_code, 200)
        names = [r["name"] for r in list_res.data]
        self.assertIn("Audit", names)

    def test_other_org_cannot_see(self):
        other_org, other_admin = _make_org_admin("cat_other")
        from core.invoices.models import InvoiceCategory
        InvoiceCategory.objects.create(org=self.org, name="Audit")
        other_api = APIClient()
        _auth(other_api, other_admin)
        res = other_api.get("/api/invoice_categories/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data, [])

    def test_non_admin_cannot_create(self):
        member = User.objects.create_user(username="cat_member", password="pw", full_name="M")
        OrgMembership.objects.create(user=member, org=self.org, role="member")
        member_api = APIClient()
        _auth(member_api, member)
        res = member_api.post(
            "/api/invoice_categories/",
            {"name": "Tax", "org": str(self.org.uid)},
            format="json",
        )
        self.assertEqual(res.status_code, 403)
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd D:/TaskTracker && python -m pytest core/invoices/tests.py::InvoiceCategoryApiTests -v
```

Expected: 404 / NoReverseMatch on `/api/invoice_categories/`.

- [ ] **Step 3: Add the serializer**

Append to `core/invoices/serializers.py`:

```python
from .models import InvoiceCategory  # add to existing import line


class InvoiceCategorySerializer(serializers.ModelSerializer):
    org = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=__import__("users.models", fromlist=["Org"]).Org.objects.all(),
    )

    class Meta:
        model = InvoiceCategory
        fields = [
            "id",
            "uid",
            "name",
            "org",
            "color",
            "is_active",
            "sort_order",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "uid", "created_at", "updated_at"]
```

- [ ] **Step 4: Add the viewset**

Append to `core/invoices/views.py`:

```python
from .models import InvoiceCategory  # add to existing import line
from .serializers import InvoiceCategorySerializer  # add to existing import line


class InvoiceCategoryViewSet(UidLookupMixin, ModelViewSet):
    serializer_class = InvoiceCategorySerializer

    def get_permissions(self):
        if self.action in {"list", "retrieve"}:
            return [permissions.IsAuthenticated()]
        return [permissions.IsAuthenticated(), IsAdmin()]

    def get_queryset(self):
        user = cast(User, self.request.user)
        return scoped(InvoiceCategory.objects.select_related("org", "created_by"), user)

    def perform_create(self, serializer):
        obj = serializer.save(created_by=self.request.user)
        broadcast(
            "invoice-categories",
            "INSERT",
            InvoiceCategorySerializer(obj, context={"request": self.request}).data,
        )

    def perform_update(self, serializer):
        obj = serializer.save()
        broadcast(
            "invoice-categories",
            "UPDATE",
            InvoiceCategorySerializer(obj, context={"request": self.request}).data,
        )

    def perform_destroy(self, instance):
        broadcast("invoice-categories", "DELETE", {"id": instance.pk, "uid": str(instance.uid)})
        instance.delete()
```

- [ ] **Step 5: Register the URL**

Modify `core/invoices/urls.py`:

```python
from .views import (
    InvoiceCategoryViewSet,
    InvoiceEntryViewSet,
    InvoicePlanViewSet,
)

router.register("invoice_categories", InvoiceCategoryViewSet, basename="invoicecategory")
```

- [ ] **Step 6: Run tests to verify pass**

```bash
cd D:/TaskTracker && python -m pytest core/invoices/tests.py::InvoiceCategoryApiTests -v
```

Expected: 3/3 pass.

- [ ] **Step 7: Commit**

```bash
git add core/invoices/serializers.py core/invoices/views.py core/invoices/urls.py core/invoices/tests.py
git commit -m "feat(invoices): InvoiceCategory CRUD API + tests"
```

---

## Task 3: Add `project_status` to `InvoicePlan` and `InvoiceEntry`

**Files:**
- Modify: `core/invoices/models.py`
- Create: `core/invoices/migrations/0005_project_status.py`
- Modify: `core/invoices/tests.py`

- [ ] **Step 1: Write the failing test**

Append to `core/invoices/tests.py`:

```python
class ProjectStatusFieldTests(TestCase):
    def test_plan_defaults_to_projected(self):
        org, _ = _make_org_admin("ps_admin")
        client = Master.objects.create(name="X", type="client", org=org)
        plan = InvoicePlan.objects.create(
            org=org,
            client=client,
            job_description="J",
            periodicity="Monthly",
            start_month=_dt.date(2026, 4, 1),
            end_month=_dt.date(2026, 4, 1),
            invoice_day=1,
            base_amount=1000,
        )
        self.assertEqual(plan.project_status, "Projected")

    def test_entry_defaults_to_projected(self):
        org, _ = _make_org_admin("ps_e_admin")
        client = Master.objects.create(name="X", type="client", org=org)
        plan = InvoicePlan.objects.create(
            org=org,
            client=client,
            job_description="J",
            periodicity="Monthly",
            start_month=_dt.date(2026, 4, 1),
            end_month=_dt.date(2026, 4, 1),
            invoice_day=1,
            base_amount=1000,
        )
        entry = InvoiceEntry.objects.create(plan=plan, invoice_month=_dt.date(2026, 4, 1))
        self.assertEqual(entry.project_status, "Projected")
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd D:/TaskTracker && python -m pytest core/invoices/tests.py::ProjectStatusFieldTests -v
```

Expected: AttributeError on `.project_status`.

- [ ] **Step 3: Add field to `InvoicePlan` and `InvoiceEntry`**

In `core/invoices/models.py`, add at the top of each class (just below the `STATUS_CHOICES` for entry, just below `PERIODICITY_CHOICES` for plan):

```python
PROJECT_STATUS_CHOICES = [
    ("Confirmed", "Confirmed"),
    ("Projected", "Projected"),
]
```

(define once at module scope, above the classes.)

In `InvoicePlan`, add a field:

```python
project_status = models.CharField(
    max_length=20,
    choices=PROJECT_STATUS_CHOICES,
    default="Projected",
    db_index=True,
)
```

In `InvoiceEntry`, add the same field with the same default.

- [ ] **Step 4: Generate migration**

```bash
cd D:/TaskTracker && python manage.py makemigrations invoices --name project_status
```

Verify file is `0005_project_status.py` and contains two `AddField` operations with `default='Projected'`.

- [ ] **Step 5: Migrate + run tests**

```bash
cd D:/TaskTracker && python manage.py migrate && python -m pytest core/invoices/tests.py::ProjectStatusFieldTests -v
```

Expected: 2/2 pass.

- [ ] **Step 6: Commit**

```bash
git add core/invoices/models.py core/invoices/migrations/0005_project_status.py core/invoices/tests.py
git commit -m "feat(invoices): add project_status to plan and entry"
```

---

## Task 4: Add through tables for plan/entry × categories/owners

**Files:**
- Modify: `core/invoices/models.py`
- Create: `core/invoices/migrations/0006_attribution_through_tables.py`
- Modify: `core/invoices/tests.py`

- [ ] **Step 1: Write the failing test**

Append to `core/invoices/tests.py`:

```python
class AttributionThroughTableTests(TestCase):
    def setUp(self):
        from core.invoices.models import InvoiceCategory

        self.org, self.admin = _make_org_admin("attr_admin")
        self.client_master = Master.objects.create(name="X", type="client", org=self.org)
        self.cat = InvoiceCategory.objects.create(org=self.org, name="Audit")
        self.plan = InvoicePlan.objects.create(
            org=self.org,
            client=self.client_master,
            job_description="J",
            periodicity="Monthly",
            start_month=_dt.date(2026, 4, 1),
            end_month=_dt.date(2026, 4, 1),
            invoice_day=1,
            base_amount=1000,
        )
        self.entry = InvoiceEntry.objects.create(plan=self.plan, invoice_month=_dt.date(2026, 4, 1))

    def test_plan_can_link_category_with_pct(self):
        from core.invoices.models import InvoicePlanCategory

        link = InvoicePlanCategory.objects.create(plan=self.plan, category=self.cat, contribution_pct=100)
        self.assertEqual(link.contribution_pct, 100)
        self.assertIn(self.cat, self.plan.default_categories.all())

    def test_plan_can_link_owner_with_pct(self):
        from core.invoices.models import InvoicePlanOwner

        link = InvoicePlanOwner.objects.create(plan=self.plan, user=self.admin, contribution_pct=100)
        self.assertEqual(link.contribution_pct, 100)

    def test_entry_can_link_category_and_owner(self):
        from core.invoices.models import InvoiceEntryCategory, InvoiceEntryOwner

        InvoiceEntryCategory.objects.create(entry=self.entry, category=self.cat, contribution_pct=100)
        InvoiceEntryOwner.objects.create(entry=self.entry, user=self.admin, contribution_pct=100)
        self.assertEqual(self.entry.categories.count(), 1)
        self.assertEqual(self.entry.owners.count(), 1)

    def test_category_protected_from_delete_when_in_use(self):
        from core.invoices.models import InvoiceCategory, InvoicePlanCategory
        from django.db.models.deletion import ProtectedError

        InvoicePlanCategory.objects.create(plan=self.plan, category=self.cat, contribution_pct=100)
        with self.assertRaises(ProtectedError):
            self.cat.delete()
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd D:/TaskTracker && python -m pytest core/invoices/tests.py::AttributionThroughTableTests -v
```

Expected: ImportError on `InvoicePlanCategory`.

- [ ] **Step 3: Add through models + M2M fields**

Append to `core/invoices/models.py` (below the existing classes):

```python
class InvoicePlanCategory(models.Model):
    id: int

    plan = models.ForeignKey(InvoicePlan, on_delete=models.CASCADE, related_name="category_links")
    category = models.ForeignKey(InvoiceCategory, on_delete=models.PROTECT)
    contribution_pct = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        validators=[MinValueValidator(0), MaxValueValidator(100)],
    )

    class Meta:
        unique_together = ("plan", "category")


class InvoicePlanOwner(models.Model):
    id: int

    plan = models.ForeignKey(InvoicePlan, on_delete=models.CASCADE, related_name="owner_links")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    contribution_pct = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        validators=[MinValueValidator(0), MaxValueValidator(100)],
    )

    class Meta:
        unique_together = ("plan", "user")


class InvoiceEntryCategory(models.Model):
    id: int

    entry = models.ForeignKey(InvoiceEntry, on_delete=models.CASCADE, related_name="category_links")
    category = models.ForeignKey(InvoiceCategory, on_delete=models.PROTECT)
    contribution_pct = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        validators=[MinValueValidator(0), MaxValueValidator(100)],
    )

    class Meta:
        unique_together = ("entry", "category")


class InvoiceEntryOwner(models.Model):
    id: int

    entry = models.ForeignKey(InvoiceEntry, on_delete=models.CASCADE, related_name="owner_links")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    contribution_pct = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        validators=[MinValueValidator(0), MaxValueValidator(100)],
    )

    class Meta:
        unique_together = ("entry", "user")
```

In `InvoicePlan`, add (just below `project_status`):

```python
default_categories = models.ManyToManyField(
    "InvoiceCategory", through="InvoicePlanCategory", related_name="default_for_plans"
)
default_owners = models.ManyToManyField(
    settings.AUTH_USER_MODEL, through="InvoicePlanOwner", related_name="default_for_invoice_plans"
)
```

In `InvoiceEntry`, add (just below `project_status`):

```python
categories = models.ManyToManyField(
    "InvoiceCategory", through="InvoiceEntryCategory", related_name="entries"
)
owners = models.ManyToManyField(
    settings.AUTH_USER_MODEL, through="InvoiceEntryOwner", related_name="invoice_entries"
)
```

- [ ] **Step 4: Generate migration**

```bash
cd D:/TaskTracker && python manage.py makemigrations invoices --name attribution_through_tables
```

Verify file is `0006_attribution_through_tables.py` with four `CreateModel`s and four `AddField` operations for the M2Ms.

- [ ] **Step 5: Migrate + run tests**

```bash
cd D:/TaskTracker && python manage.py migrate && python -m pytest core/invoices/tests.py::AttributionThroughTableTests -v
```

Expected: 4/4 pass.

- [ ] **Step 6: Commit**

```bash
git add core/invoices/models.py core/invoices/migrations/0006_attribution_through_tables.py core/invoices/tests.py
git commit -m "feat(invoices): attribution through tables for categories and owners"
```

---

## Task 5: Plan serializer — read/write attribution + sum=100 validation

**Files:**
- Modify: `core/invoices/serializers.py`
- Modify: `core/invoices/tests.py`

- [ ] **Step 1: Write the failing test**

Append to `core/invoices/tests.py`:

```python
class PlanSerializerAttributionTests(TestCase):
    def setUp(self):
        from core.invoices.models import InvoiceCategory

        self.org, self.admin = _make_org_admin("plan_attr_admin")
        self.client_master = Master.objects.create(name="X", type="client", org=self.org)
        self.client_master.orgs.add(self.org)
        self.cat_a = InvoiceCategory.objects.create(org=self.org, name="Audit")
        self.cat_b = InvoiceCategory.objects.create(org=self.org, name="Tax")
        self.api = APIClient()
        _auth(self.api, self.admin)

    def _create_payload(self, default_categories=None, default_owners=None, project_status="Projected"):
        return {
            "client": str(self.client_master.uid),
            "job_description": "J",
            "periodicity": "Monthly",
            "start_month": "2026-04-01",
            "end_month": "2026-04-01",
            "invoice_day": 1,
            "base_amount": "1000.00",
            "org": str(self.org.uid),
            "project_status": project_status,
            "default_categories": default_categories or [],
            "default_owners": default_owners or [],
        }

    def test_create_with_valid_attribution(self):
        body = self._create_payload(
            default_categories=[
                {"category_uid": str(self.cat_a.uid), "contribution_pct": "60.00"},
                {"category_uid": str(self.cat_b.uid), "contribution_pct": "40.00"},
            ],
            default_owners=[
                {"user_uid": str(self.admin.uid), "contribution_pct": "100.00"},
            ],
            project_status="Confirmed",
        )
        res = self.api.post("/api/invoice_plans/", body, format="json")
        self.assertEqual(res.status_code, 201, res.data)
        self.assertEqual(len(res.data["default_categories"]), 2)
        self.assertEqual(res.data["project_status"], "Confirmed")

    def test_reject_pct_sum_not_100(self):
        body = self._create_payload(
            default_categories=[
                {"category_uid": str(self.cat_a.uid), "contribution_pct": "60.00"},
                {"category_uid": str(self.cat_b.uid), "contribution_pct": "30.00"},
            ],
        )
        res = self.api.post("/api/invoice_plans/", body, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("default_categories", res.data)

    def test_reject_duplicate_category(self):
        body = self._create_payload(
            default_categories=[
                {"category_uid": str(self.cat_a.uid), "contribution_pct": "50.00"},
                {"category_uid": str(self.cat_a.uid), "contribution_pct": "50.00"},
            ],
        )
        res = self.api.post("/api/invoice_plans/", body, format="json")
        self.assertEqual(res.status_code, 400)

    def test_empty_attribution_allowed(self):
        body = self._create_payload(default_categories=[], default_owners=[])
        res = self.api.post("/api/invoice_plans/", body, format="json")
        self.assertEqual(res.status_code, 201, res.data)
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd D:/TaskTracker && python -m pytest core/invoices/tests.py::PlanSerializerAttributionTests -v
```

Expected: 4 failures (`default_categories` not on serializer, etc.).

- [ ] **Step 3: Extend `InvoicePlanSerializer`**

Modify `core/invoices/serializers.py`. Add a helper near the top:

```python
from decimal import Decimal

from .models import (
    InvoiceCategory,
    InvoiceEntry,
    InvoiceEntryCategory,
    InvoiceEntryOwner,
    InvoicePlan,
    InvoicePlanCategory,
    InvoicePlanOwner,
)


def _validate_pct_list(items, *, key_field, label):
    """Shared validator for the four attribution lists.

    ``key_field`` is ``'category_uid'`` or ``'user_uid'``. Returns the
    cleaned list. Raises ``serializers.ValidationError`` with a list of
    field-level messages on failure.
    """
    if not items:
        return []
    seen = set()
    total = Decimal("0")
    for entry in items:
        key = entry.get(key_field)
        pct_raw = entry.get("contribution_pct")
        if key is None or pct_raw is None:
            raise serializers.ValidationError(
                {label: f"each item needs '{key_field}' and 'contribution_pct'"}
            )
        if key in seen:
            raise serializers.ValidationError({label: f"duplicate {key_field}: {key}"})
        seen.add(key)
        try:
            pct = Decimal(str(pct_raw))
        except Exception:
            raise serializers.ValidationError({label: f"invalid contribution_pct: {pct_raw}"}) from None
        if pct <= 0 or pct > 100:
            raise serializers.ValidationError({label: "contribution_pct must be in (0, 100]"})
        total += pct
    if total != Decimal("100.00"):
        raise serializers.ValidationError(
            {label: f"contribution_pct must sum to 100.00 (got {total})"}
        )
    return items
```

Replace `InvoicePlanSerializer` with:

```python
class InvoicePlanSerializer(serializers.ModelSerializer):
    client_detail = MasterMinSerializer(source="client", read_only=True)
    created_by_detail = UserMinSerializer(source="created_by", read_only=True)
    entries = InvoiceEntrySerializer(many=True, read_only=True)
    default_categories = serializers.SerializerMethodField()
    default_owners = serializers.SerializerMethodField()

    client = serializers.SlugRelatedField(
        slug_field="uid",
        queryset=Master.objects.filter(type="client"),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = InvoicePlan
        fields = [
            "id",
            "uid",
            "serial_no",
            "client",
            "client_detail",
            "job_description",
            "periodicity",
            "start_month",
            "end_month",
            "invoice_day",
            "base_amount",
            "project_status",
            "default_categories",
            "default_owners",
            "entries",
            "created_by_detail",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "uid",
            "serial_no",
            "client_detail",
            "created_by_detail",
            "entries",
            "created_at",
            "updated_at",
        ]

    def get_default_categories(self, obj):
        return [
            {
                "category_uid": str(link.category.uid),
                "category_name": link.category.name,
                "color": link.category.color,
                "contribution_pct": str(link.contribution_pct),
            }
            for link in obj.category_links.select_related("category").all()
        ]

    def get_default_owners(self, obj):
        return [
            {
                "user_uid": str(link.user.uid),
                "user_name": link.user.full_name or link.user.username,
                "contribution_pct": str(link.contribution_pct),
            }
            for link in obj.owner_links.select_related("user").all()
        ]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        # Pull from initial_data because the SerializerMethodField is
        # read-only — write data lives on initial_data, not attrs.
        cats = self.initial_data.get("default_categories", [])
        owns = self.initial_data.get("default_owners", [])
        _validate_pct_list(cats, key_field="category_uid", label="default_categories")
        _validate_pct_list(owns, key_field="user_uid", label="default_owners")
        attrs["_default_categories"] = cats
        attrs["_default_owners"] = owns
        return attrs

    def _sync_links(self, plan, cats, owns):
        from users.models import User as _User

        # Replace-all semantics.
        plan.category_links.all().delete()
        for item in cats:
            cat = InvoiceCategory.objects.get(uid=item["category_uid"])
            InvoicePlanCategory.objects.create(
                plan=plan, category=cat, contribution_pct=Decimal(str(item["contribution_pct"]))
            )
        plan.owner_links.all().delete()
        for item in owns:
            user = _User.objects.get(uid=item["user_uid"])
            InvoicePlanOwner.objects.create(
                plan=plan, user=user, contribution_pct=Decimal(str(item["contribution_pct"]))
            )

    def create(self, validated_data):
        cats = validated_data.pop("_default_categories", [])
        owns = validated_data.pop("_default_owners", [])
        plan = super().create(validated_data)
        self._sync_links(plan, cats, owns)
        return plan

    def update(self, instance, validated_data):
        cats = validated_data.pop("_default_categories", None)
        owns = validated_data.pop("_default_owners", None)
        plan = super().update(instance, validated_data)
        # Only sync if the field was provided in the request payload —
        # PATCHes that don't mention attribution leave the existing rows.
        if "default_categories" in self.initial_data or "default_owners" in self.initial_data:
            self._sync_links(plan, cats or [], owns or [])
        return plan
```

Note: `users.User` model exposes `uid` (UUIDField, see `users/models.py:50`). The codebase already uses `slug_field="uid"` for users elsewhere — see `UserMinSerializer`.

- [ ] **Step 4: Run tests**

```bash
cd D:/TaskTracker && python -m pytest core/invoices/tests.py::PlanSerializerAttributionTests -v
```

Expected: 4/4 pass.

- [ ] **Step 5: Commit**

```bash
git add core/invoices/serializers.py core/invoices/tests.py
git commit -m "feat(invoices): plan serializer reads/writes attribution"
```

---

## Task 6: Entry serializer — same shape + `?project_status=` filter

**Files:**
- Modify: `core/invoices/serializers.py`
- Modify: `core/invoices/views.py`
- Modify: `core/invoices/tests.py`

- [ ] **Step 1: Write the failing test**

Append to `core/invoices/tests.py`:

```python
class EntrySerializerAttributionTests(TestCase):
    def setUp(self):
        from core.invoices.models import InvoiceCategory

        self.org, self.admin = _make_org_admin("entry_attr_admin")
        self.client_master = Master.objects.create(name="X", type="client", org=self.org)
        self.client_master.orgs.add(self.org)
        self.cat = InvoiceCategory.objects.create(org=self.org, name="Audit")
        self.plan = InvoicePlan.objects.create(
            org=self.org,
            client=self.client_master,
            job_description="J",
            periodicity="Monthly",
            start_month=_dt.date(2026, 4, 1),
            end_month=_dt.date(2026, 4, 1),
            invoice_day=1,
            base_amount=1000,
        )
        self.entry = InvoiceEntry.objects.create(plan=self.plan, invoice_month=_dt.date(2026, 4, 1))
        self.api = APIClient()
        _auth(self.api, self.admin)

    def test_patch_entry_attribution(self):
        body = {
            "project_status": "Confirmed",
            "categories": [
                {"category_uid": str(self.cat.uid), "contribution_pct": "100.00"},
            ],
            "owners": [
                {"user_uid": str(self.admin.uid), "contribution_pct": "100.00"},
            ],
        }
        res = self.api.patch(f"/api/invoice_entries/{self.entry.uid}/", body, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["project_status"], "Confirmed")
        self.assertEqual(len(res.data["categories"]), 1)
        self.assertEqual(len(res.data["owners"]), 1)

    def test_filter_by_project_status(self):
        e2 = InvoiceEntry.objects.create(plan=self.plan, invoice_month=_dt.date(2026, 5, 1))
        e2.project_status = "Confirmed"
        e2.save()
        res = self.api.get("/api/invoice_entries/?project_status=Confirmed")
        self.assertEqual(res.status_code, 200)
        uids = [r["uid"] for r in res.data]
        self.assertIn(str(e2.uid), uids)
        self.assertNotIn(str(self.entry.uid), uids)
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd D:/TaskTracker && python -m pytest core/invoices/tests.py::EntrySerializerAttributionTests -v
```

Expected: 2 failures.

- [ ] **Step 3: Extend `InvoiceEntrySerializer`**

Replace `InvoiceEntrySerializer` in `core/invoices/serializers.py`:

```python
class InvoiceEntrySerializer(serializers.ModelSerializer):
    uploaded_by_detail = UserMinSerializer(source="uploaded_by", read_only=True)
    approved_by_detail = UserMinSerializer(source="approved_by", read_only=True)
    file_url = serializers.SerializerMethodField()
    file_name = serializers.SerializerMethodField()
    categories = serializers.SerializerMethodField()
    owners = serializers.SerializerMethodField()

    class Meta:
        model = InvoiceEntry
        fields = [
            "id",
            "uid",
            "invoice_month",
            "invoice_date",
            "amount",
            "status",
            "project_status",
            "invoice_number",
            "notes",
            "file",
            "file_url",
            "file_name",
            "rejection_reason",
            "categories",
            "owners",
            "uploaded_by_detail",
            "uploaded_at",
            "approved_by_detail",
            "approved_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "uid",
            "file_url",
            "file_name",
            "categories",
            "owners",
            "uploaded_by_detail",
            "uploaded_at",
            "approved_by_detail",
            "approved_at",
            "created_at",
            "updated_at",
        ]
        extra_kwargs = {"file": {"write_only": True}}

    def get_file_name(self, obj):
        if not obj.file:
            return None
        return obj.file.name.rsplit("/", 1)[-1]

    def get_file_url(self, obj):
        if not obj.file:
            return None
        path = reverse("invoiceentry-download", kwargs={"uid": str(obj.uid)})
        request = self.context.get("request")
        return request.build_absolute_uri(path) if request else path

    def get_categories(self, obj):
        return [
            {
                "category_uid": str(link.category.uid),
                "category_name": link.category.name,
                "color": link.category.color,
                "contribution_pct": str(link.contribution_pct),
            }
            for link in obj.category_links.select_related("category").all()
        ]

    def get_owners(self, obj):
        return [
            {
                "user_uid": str(link.user.uid),
                "user_name": link.user.full_name or link.user.username,
                "contribution_pct": str(link.contribution_pct),
            }
            for link in obj.owner_links.select_related("user").all()
        ]

    def validate(self, attrs):
        attrs = super().validate(attrs)
        cats = self.initial_data.get("categories")
        owns = self.initial_data.get("owners")
        if cats is not None:
            _validate_pct_list(cats, key_field="category_uid", label="categories")
            attrs["_categories"] = cats
        if owns is not None:
            _validate_pct_list(owns, key_field="user_uid", label="owners")
            attrs["_owners"] = owns
        return attrs

    def _sync_links(self, entry, cats, owns):
        from users.models import User as _User

        if cats is not None:
            entry.category_links.all().delete()
            for item in cats:
                cat = InvoiceCategory.objects.get(uid=item["category_uid"])
                InvoiceEntryCategory.objects.create(
                    entry=entry, category=cat, contribution_pct=Decimal(str(item["contribution_pct"]))
                )
        if owns is not None:
            entry.owner_links.all().delete()
            for item in owns:
                user = _User.objects.get(uid=item["user_uid"])
                InvoiceEntryOwner.objects.create(
                    entry=entry, user=user, contribution_pct=Decimal(str(item["contribution_pct"]))
                )

    def update(self, instance, validated_data):
        cats = validated_data.pop("_categories", None)
        owns = validated_data.pop("_owners", None)
        entry = super().update(instance, validated_data)
        self._sync_links(entry, cats, owns)
        return entry

    def create(self, validated_data):
        cats = validated_data.pop("_categories", None)
        owns = validated_data.pop("_owners", None)
        entry = super().create(validated_data)
        self._sync_links(entry, cats, owns)
        return entry
```

- [ ] **Step 4: Add the filter in `InvoiceEntryViewSet.get_queryset`**

In `core/invoices/views.py`, inside `InvoiceEntryViewSet.get_queryset`, after the existing `month` block:

```python
project_status = self.request.query_params.get("project_status")
if project_status:
    qs = qs.filter(project_status=project_status)
```

- [ ] **Step 5: Run tests**

```bash
cd D:/TaskTracker && python -m pytest core/invoices/tests.py::EntrySerializerAttributionTests -v
```

Expected: 2/2 pass.

- [ ] **Step 6: Commit**

```bash
git add core/invoices/serializers.py core/invoices/views.py core/invoices/tests.py
git commit -m "feat(invoices): entry serializer attribution + project_status filter"
```

---

## Task 7: `generate` copies plan defaults to new entries

**Files:**
- Modify: `core/invoices/views.py`
- Modify: `core/invoices/tests.py`

- [ ] **Step 1: Write the failing test**

Append to `core/invoices/tests.py`:

```python
class GenerateCopiesDefaultsTests(TestCase):
    def setUp(self):
        from core.invoices.models import (
            InvoiceCategory,
            InvoicePlanCategory,
            InvoicePlanOwner,
        )

        self.org, self.admin = _make_org_admin("gen_def_admin")
        self.client_master = Master.objects.create(name="X", type="client", org=self.org)
        self.client_master.orgs.add(self.org)
        self.cat = InvoiceCategory.objects.create(org=self.org, name="Audit")
        self.plan = InvoicePlan.objects.create(
            org=self.org,
            client=self.client_master,
            job_description="J",
            periodicity="Monthly",
            start_month=_dt.date(2026, 4, 1),
            end_month=_dt.date(2026, 6, 1),
            invoice_day=1,
            base_amount=1000,
            project_status="Confirmed",
        )
        InvoicePlanCategory.objects.create(plan=self.plan, category=self.cat, contribution_pct=100)
        InvoicePlanOwner.objects.create(plan=self.plan, user=self.admin, contribution_pct=100)
        self.api = APIClient()
        _auth(self.api, self.admin)

    def test_generated_entries_inherit_defaults(self):
        res = self.api.post(
            "/api/invoice_entries/generate/",
            {"plan_uid": str(self.plan.uid)},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.data)
        for entry in InvoiceEntry.objects.filter(plan=self.plan):
            self.assertEqual(entry.project_status, "Confirmed")
            self.assertEqual(entry.categories.count(), 1)
            self.assertEqual(entry.owners.count(), 1)

    def test_existing_entries_not_retro_updated(self):
        from core.invoices.models import InvoicePlanCategory

        self.api.post("/api/invoice_entries/generate/", {"plan_uid": str(self.plan.uid)}, format="json")
        # Add a second default category to the plan; existing entries
        # should not get the new one.
        from core.invoices.models import InvoiceCategory
        cat2 = InvoiceCategory.objects.create(org=self.org, name="Tax")
        InvoicePlanCategory.objects.filter(plan=self.plan).delete()
        InvoicePlanCategory.objects.create(plan=self.plan, category=self.cat, contribution_pct=50)
        InvoicePlanCategory.objects.create(plan=self.plan, category=cat2, contribution_pct=50)
        for entry in InvoiceEntry.objects.filter(plan=self.plan):
            self.assertEqual(entry.categories.count(), 1)  # still just Audit
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd D:/TaskTracker && python -m pytest core/invoices/tests.py::GenerateCopiesDefaultsTests -v
```

Expected: first test fails (entries have no categories).

- [ ] **Step 3: Update `generate` action**

In `core/invoices/views.py`, find the `for month_date in expected_months:` loop in `generate`. After `entry = InvoiceEntry.objects.create(...)`, add (still inside the loop, inside a `with transaction.atomic():` if not already wrapped — wrap if needed):

```python
# Copy plan attribution defaults onto each new entry. Existing
# entries are intentionally not retro-updated when plan defaults
# change — same model as ``base_amount``: the plan supplies the
# starting value and per-entry edits are the escape hatch.
entry.project_status = plan.project_status
entry.save(update_fields=["project_status"])
for link in plan.category_links.select_related("category"):
    InvoiceEntryCategory.objects.create(
        entry=entry,
        category=link.category,
        contribution_pct=link.contribution_pct,
    )
for link in plan.owner_links.select_related("user"):
    InvoiceEntryOwner.objects.create(
        entry=entry,
        user=link.user,
        contribution_pct=link.contribution_pct,
    )
```

Add the import at the top of the file:

```python
from .models import (
    InvoiceCategory,
    InvoiceEntry,
    InvoiceEntryCategory,
    InvoiceEntryOwner,
    InvoicePlan,
)
```

- [ ] **Step 4: Run tests**

```bash
cd D:/TaskTracker && python -m pytest core/invoices/tests.py::GenerateCopiesDefaultsTests -v
```

Expected: 2/2 pass.

- [ ] **Step 5: Commit**

```bash
git add core/invoices/views.py core/invoices/tests.py
git commit -m "feat(invoices): generate copies plan attribution to new entries"
```

---

## Task 8: `invoice_reports` aggregation endpoint + tests

**Files:**
- Modify: `core/invoices/views.py`
- Modify: `core/invoices/urls.py`
- Modify: `core/invoices/tests.py`

- [ ] **Step 1: Write the failing test**

Append to `core/invoices/tests.py`:

```python
class InvoiceReportsTests(TestCase):
    def setUp(self):
        from core.invoices.models import (
            InvoiceCategory,
            InvoiceEntryCategory,
            InvoiceEntryOwner,
            InvoicePlanCategory,
            InvoicePlanOwner,
        )

        self.org, self.admin = _make_org_admin("rep_admin")
        self.user2 = User.objects.create_user(username="rep_u2", password="pw", full_name="U2")
        OrgMembership.objects.create(user=self.user2, org=self.org, role="member")
        self.client_master = Master.objects.create(name="X", type="client", org=self.org)
        self.client_master.orgs.add(self.org)
        self.cat_a = InvoiceCategory.objects.create(org=self.org, name="Audit")
        self.cat_b = InvoiceCategory.objects.create(org=self.org, name="Tax")
        self.plan = InvoicePlan.objects.create(
            org=self.org,
            client=self.client_master,
            job_description="J",
            periodicity="Monthly",
            start_month=_dt.date(2026, 4, 1),
            end_month=_dt.date(2026, 4, 1),
            invoice_day=1,
            base_amount=1000,
            project_status="Confirmed",
        )
        # 1 entry with two categories 60/40 and two owners 50/50
        self.entry = InvoiceEntry.objects.create(
            plan=self.plan, invoice_month=_dt.date(2026, 4, 1), amount=1000
        )
        InvoiceEntryCategory.objects.create(entry=self.entry, category=self.cat_a, contribution_pct=60)
        InvoiceEntryCategory.objects.create(entry=self.entry, category=self.cat_b, contribution_pct=40)
        InvoiceEntryOwner.objects.create(entry=self.entry, user=self.admin, contribution_pct=50)
        InvoiceEntryOwner.objects.create(entry=self.entry, user=self.user2, contribution_pct=50)
        self.api = APIClient()
        _auth(self.api, self.admin)

    def test_group_by_category_attributes_correctly(self):
        res = self.api.get("/api/invoice_reports/?fy=2026-27&group_by=category")
        self.assertEqual(res.status_code, 200, res.data)
        rows = {r["label"]: r for r in res.data["rows"]}
        self.assertEqual(float(rows["Audit"]["monthly"]["2026-04"]), 600.0)
        self.assertEqual(float(rows["Tax"]["monthly"]["2026-04"]), 400.0)
        self.assertEqual(float(res.data["totals"]["total"]), 1000.0)

    def test_group_by_owner(self):
        res = self.api.get("/api/invoice_reports/?fy=2026-27&group_by=owner")
        rows = {r["label"]: r for r in res.data["rows"]}
        self.assertEqual(float(rows["U2"]["monthly"]["2026-04"]), 500.0)

    def test_unattributed_bucket(self):
        e2 = InvoiceEntry.objects.create(plan=self.plan, invoice_month=_dt.date(2026, 5, 1), amount=300)
        res = self.api.get("/api/invoice_reports/?fy=2026-27&group_by=category")
        rows = {r["label"]: r for r in res.data["rows"]}
        self.assertEqual(float(rows["Unattributed"]["monthly"]["2026-05"]), 300.0)

    def test_filter_by_category(self):
        res = self.api.get(f"/api/invoice_reports/?fy=2026-27&group_by=owner&category={self.cat_a.uid}")
        # Filter narrows entries; only Audit's 60% share is now considered for owner attribution.
        # Entry total still 1000; owner totals still 500/500 from the underlying entry.
        self.assertEqual(res.status_code, 200)

    def test_filter_by_project_status(self):
        # Entry is Confirmed; ?project_status=Projected should return zero rows.
        res = self.api.get("/api/invoice_reports/?fy=2026-27&group_by=category&project_status=Projected")
        self.assertEqual(res.status_code, 200)
        # Either no rows or all-zero monthly values.
        total = sum(float(r["monthly"].get("2026-04", 0)) for r in res.data["rows"])
        self.assertEqual(total, 0.0)
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd D:/TaskTracker && python -m pytest core/invoices/tests.py::InvoiceReportsTests -v
```

Expected: 5 failures (`/api/invoice_reports/` not found).

- [ ] **Step 3: Add the report view**

Append to `core/invoices/views.py`:

```python
from collections import defaultdict
from decimal import Decimal

from rest_framework.views import APIView


def _fy_months(fy: str) -> list[str]:
    """Convert ``"2026-27"`` to ``["2026-04", ..., "2027-03"]``."""
    start_year = int(fy.split("-")[0])
    months = []
    for offset in range(12):
        m = 4 + offset
        y = start_year + (m - 1) // 12
        m = ((m - 1) % 12) + 1
        months.append(f"{y:04d}-{m:02d}")
    return months


class InvoiceReportView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        fy = request.query_params.get("fy")
        group_by = request.query_params.get("group_by")
        if not fy or group_by not in {"owner", "category", "month", "client"}:
            return Response(
                {"error": "fy and group_by (owner|category|month|client) are required"},
                status=400,
            )

        months = _fy_months(fy)
        user = cast(User, request.user)

        qs = InvoiceEntry.objects.filter(plan__org_id__in=user.org_ids())
        # FY filter — month string prefix match.
        qs = qs.filter(invoice_month__gte=f"{months[0]}-01", invoice_month__lte=f"{months[-1]}-31")

        cat_uids = request.query_params.getlist("category")
        owner_uids = request.query_params.getlist("owner")
        ps = request.query_params.get("project_status")
        if cat_uids:
            qs = qs.filter(categories__uid__in=cat_uids).distinct()
        if owner_uids:
            qs = qs.filter(owners__uid__in=owner_uids).distinct()
        if ps:
            qs = qs.filter(project_status=ps)

        qs = qs.select_related("plan", "plan__client").prefetch_related(
            "category_links__category", "owner_links__user"
        )

        # rows[key] = {"label": ..., "monthly": defaultdict(Decimal)}
        rows: dict[str, dict] = {}
        col_totals: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))

        UNATTRIB_KEY = "Unattributed"

        def _bump(key, label, month_str, value):
            if key not in rows:
                rows[key] = {"key": key, "label": label, "monthly": defaultdict(lambda: Decimal("0")), "total": Decimal("0")}
            rows[key]["monthly"][month_str] += value
            rows[key]["total"] += value
            col_totals[month_str] += value

        for entry in qs:
            amt = entry.amount or Decimal("0")
            month_str = entry.invoice_month.strftime("%Y-%m")
            if group_by == "category":
                links = list(entry.category_links.all())
                if not links:
                    _bump(UNATTRIB_KEY, "Unattributed", month_str, amt)
                else:
                    for link in links:
                        share = amt * link.contribution_pct / Decimal("100")
                        _bump(str(link.category.uid), link.category.name, month_str, share)
            elif group_by == "owner":
                links = list(entry.owner_links.all())
                if not links:
                    _bump(UNATTRIB_KEY, "Unattributed", month_str, amt)
                else:
                    for link in links:
                        share = amt * link.contribution_pct / Decimal("100")
                        label = link.user.full_name or link.user.username
                        _bump(str(link.user.uid), label, month_str, share)
            elif group_by == "month":
                _bump(month_str, month_str, month_str, amt)
            elif group_by == "client":
                client = entry.plan.client
                key = str(client.uid) if client else "no-client"
                label = client.name if client else "(no client)"
                _bump(key, label, month_str, amt)

        # Serialise Decimals to strings for JSON; flatten monthly dict.
        out_rows = []
        for r in rows.values():
            out_rows.append({
                "key": r["key"],
                "label": r["label"],
                "monthly": {m: str(r["monthly"].get(m, Decimal("0"))) for m in months},
                "total": str(r["total"]),
            })
        out_rows.sort(key=lambda r: (r["key"] == UNATTRIB_KEY, r["label"].lower()))

        return Response({
            "fy": fy,
            "group_by": group_by,
            "rows": out_rows,
            "totals": {
                **{m: str(col_totals.get(m, Decimal("0"))) for m in months},
                "total": str(sum(col_totals.values()) or Decimal("0")),
            },
        })
```

- [ ] **Step 4: Register URL**

Modify `core/invoices/urls.py`:

```python
from .views import (
    InvoiceCategoryViewSet,
    InvoiceEntryViewSet,
    InvoicePlanViewSet,
    InvoiceReportView,
)

urlpatterns = [
    path("", include(router.urls)),
    path("invoice_reports/", InvoiceReportView.as_view(), name="invoice-reports"),
]
```

- [ ] **Step 5: Run tests**

```bash
cd D:/TaskTracker && python -m pytest core/invoices/tests.py::InvoiceReportsTests -v
```

Expected: 5/5 pass.

- [ ] **Step 6: Run the full invoice test suite — make sure nothing regressed**

```bash
cd D:/TaskTracker && python -m pytest core/invoices/tests.py -v
```

Expected: every existing test still passes.

- [ ] **Step 7: Commit**

```bash
git add core/invoices/views.py core/invoices/urls.py core/invoices/tests.py
git commit -m "feat(invoices): /api/invoice_reports/ pivot endpoint"
```

---

## Task 9: Frontend types — DTO + domain

**Files:**
- Modify: `frontend/task-tracker/src/types/api/invoice.ts`
- Modify: `frontend/task-tracker/src/types/invoice.ts`

- [ ] **Step 1: Modify `frontend/task-tracker/src/types/api/invoice.ts`**

Add at the top (next to `InvoiceEntryStatusValue`):

```typescript
export type InvoiceProjectStatus = "Confirmed" | "Projected";

export interface InvoiceCategoryDto extends BaseDto {
  readonly name: string;
  readonly org: Uid;
  readonly color: string;
  readonly is_active: boolean;
  readonly sort_order: number;
}

export interface InvoiceCategoryCreate {
  readonly name: string;
  readonly org: Uid;
  readonly color?: string;
  readonly is_active?: boolean;
  readonly sort_order?: number;
}

export type InvoiceCategoryUpdate = Partial<InvoiceCategoryCreate>;

export interface AttributionCategoryItem {
  readonly category_uid: Uid;
  readonly category_name?: string;
  readonly color?: string;
  readonly contribution_pct: string;
}

export interface AttributionOwnerItem {
  readonly user_uid: Uid;
  readonly user_name?: string;
  readonly contribution_pct: string;
}
```

In `InvoicePlanDto`, add fields (just below `base_amount`):

```typescript
  readonly project_status: InvoiceProjectStatus;
  readonly default_categories: readonly AttributionCategoryItem[];
  readonly default_owners: readonly AttributionOwnerItem[];
```

In `InvoicePlanCreate`, add (after `base_amount`):

```typescript
  readonly project_status?: InvoiceProjectStatus;
  readonly default_categories?: readonly AttributionCategoryItem[];
  readonly default_owners?: readonly AttributionOwnerItem[];
```

In `InvoiceEntryDto`, add (after `status`):

```typescript
  readonly project_status: InvoiceProjectStatus;
  readonly categories: readonly AttributionCategoryItem[];
  readonly owners: readonly AttributionOwnerItem[];
```

In `InvoiceEntryUpdate`, add:

```typescript
  readonly project_status?: InvoiceProjectStatus;
  readonly categories?: readonly AttributionCategoryItem[];
  readonly owners?: readonly AttributionOwnerItem[];
```

Append at the bottom:

```typescript
export type InvoiceReportGroupBy = "owner" | "category" | "month" | "client";

export interface InvoiceReportRow {
  readonly key: string;
  readonly label: string;
  readonly monthly: Readonly<Record<string, string>>;
  readonly total: string;
}

export interface InvoiceReportResponse {
  readonly fy: string;
  readonly group_by: InvoiceReportGroupBy;
  readonly rows: readonly InvoiceReportRow[];
  readonly totals: Readonly<Record<string, string>>;
}

export interface InvoiceReportRequest {
  readonly fy: string;
  readonly group_by: InvoiceReportGroupBy;
  readonly category?: readonly Uid[];
  readonly owner?: readonly Uid[];
  readonly project_status?: InvoiceProjectStatus;
}
```

- [ ] **Step 2: Modify `frontend/task-tracker/src/types/invoice.ts`**

Append:

```typescript
export type InvoiceProjectStatus = "Confirmed" | "Projected";

export interface InvoiceAttributionCategory {
  category_uid: string;
  category_name: string;
  color: string;
  contribution_pct: number;
}

export interface InvoiceAttributionOwner {
  user_uid: string;
  user_name: string;
  contribution_pct: number;
}

export interface InvoiceCategory {
  id: string; // uid
  name: string;
  org_uid: string;
  color: string;
  is_active: boolean;
  sort_order: number;
}
```

In `InvoicePlan`, add fields:

```typescript
  project_status: InvoiceProjectStatus;
  default_categories: InvoiceAttributionCategory[];
  default_owners: InvoiceAttributionOwner[];
```

In `InvoiceEntry`, add fields:

```typescript
  project_status: InvoiceProjectStatus;
  categories: InvoiceAttributionCategory[];
  owners: InvoiceAttributionOwner[];
```

In `PlanForm`, add:

```typescript
  project_status: InvoiceProjectStatus;
  default_categories: InvoiceAttributionCategory[];
  default_owners: InvoiceAttributionOwner[];
```

- [ ] **Step 3: Type-check**

```bash
cd D:/TaskTracker/frontend/task-tracker && npx tsc -b
```

Expected: errors only in files that use `InvoicePlan`/`InvoiceEntry` and don't yet provide the new fields. Note them — Task 10 onwards fixes them. If you want a clean compile after this task, also add the same fields with sensible defaults (`project_status: "Projected"`, empty arrays) to the constants/mocks the type-check flags.

- [ ] **Step 4: Commit**

```bash
git add frontend/task-tracker/src/types/api/invoice.ts frontend/task-tracker/src/types/invoice.ts
git commit -m "feat(invoices): types for attribution and reporting"
```

---

## Task 10: Update `useInvoices` hook to map new fields

**Files:**
- Modify: `frontend/task-tracker/src/hooks/useInvoices.ts`

- [ ] **Step 1: Modify the DTO→domain mappers**

In `dtoToInvoicePlan`, after the existing field assignments, before the closing `}`:

```typescript
project_status: dto.project_status,
default_categories: (dto.default_categories ?? []).map((c) => ({
  category_uid: c.category_uid,
  category_name: c.category_name ?? "",
  color: c.color ?? "",
  contribution_pct: Number(c.contribution_pct),
})),
default_owners: (dto.default_owners ?? []).map((o) => ({
  user_uid: o.user_uid,
  user_name: o.user_name ?? "",
  contribution_pct: Number(o.contribution_pct),
})),
```

In `dtoToInvoiceEntry`, similarly add:

```typescript
project_status: dto.project_status,
categories: (dto.categories ?? []).map((c) => ({
  category_uid: c.category_uid,
  category_name: c.category_name ?? "",
  color: c.color ?? "",
  contribution_pct: Number(c.contribution_pct),
})),
owners: (dto.owners ?? []).map((o) => ({
  user_uid: o.user_uid,
  user_name: o.user_name ?? "",
  contribution_pct: Number(o.contribution_pct),
})),
```

- [ ] **Step 2: Type-check**

```bash
cd D:/TaskTracker/frontend/task-tracker && npx tsc -b
```

Expected: errors reduced — only consumers (PlanModal etc.) that haven't been updated yet should fail.

- [ ] **Step 3: Commit**

```bash
git add frontend/task-tracker/src/hooks/useInvoices.ts
git commit -m "feat(invoices): hook maps attribution fields"
```

---

## Task 11: New `useInvoiceCategories` hook

**Files:**
- Create: `frontend/task-tracker/src/hooks/useInvoiceCategories.ts`

- [ ] **Step 1: Create the hook**

```typescript
import { useCallback, useEffect, useState } from "react";
import { apiGet, ws } from "@/lib/api";
import type { InvoiceCategory } from "@/types";
import type { InvoiceCategoryDto } from "@/types/api";

function dtoToCategory(dto: InvoiceCategoryDto): InvoiceCategory {
  return {
    id: dto.uid,
    name: dto.name,
    org_uid: dto.org,
    color: dto.color,
    is_active: dto.is_active,
    sort_order: dto.sort_order,
  };
}

export interface UseInvoiceCategoriesReturn {
  categories: InvoiceCategory[];
  loading: boolean;
  reload: () => Promise<void>;
}

export function useInvoiceCategories(): UseInvoiceCategoriesReturn {
  const [categories, setCategories] = useState<InvoiceCategory[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (): Promise<void> => {
    const dtos = await apiGet<InvoiceCategoryDto[]>("/invoice_categories/");
    setCategories(dtos.map(dtoToCategory));
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

    const unsub = ws.subscribe<InvoiceCategoryDto>("invoice-categories", (evt) => {
      if (evt.event === "INSERT" && evt.record) {
        const next = dtoToCategory(evt.record);
        setCategories((prev) =>
          prev.some((c) => c.id === next.id) ? prev : [...prev, next],
        );
      } else if (evt.event === "UPDATE" && evt.record) {
        const next = dtoToCategory(evt.record);
        setCategories((prev) => prev.map((c) => (c.id === next.id ? next : c)));
      } else if (evt.event === "DELETE" && evt.record) {
        const id = (evt.record as { uid?: string }).uid;
        if (id) setCategories((prev) => prev.filter((c) => c.id !== id));
      }
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [reload]);

  return { categories, loading, reload };
}
```

- [ ] **Step 2: Type-check**

```bash
cd D:/TaskTracker/frontend/task-tracker && npx tsc -b
```

Expected: no new errors introduced by this file.

- [ ] **Step 3: Commit**

```bash
git add frontend/task-tracker/src/hooks/useInvoiceCategories.ts
git commit -m "feat(invoices): useInvoiceCategories hook"
```

---

## Task 12: Reusable `AttributionChips` component (with sum=100 indicator) + tests

**Files:**
- Create: `frontend/task-tracker/src/components/invoice/AttributionChips.tsx`
- Create: `frontend/task-tracker/src/components/invoice/AttributionChips.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AttributionChips from "./AttributionChips";

describe("AttributionChips", () => {
  const options = [
    { id: "u1", label: "Audit" },
    { id: "u2", label: "Tax" },
  ];

  it("shows green check at 100%", () => {
    render(
      <AttributionChips
        options={options}
        value={[
          { id: "u1", label: "Audit", contribution_pct: 60 },
          { id: "u2", label: "Tax", contribution_pct: 40 },
        ]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(/✓.*100/)).toBeInTheDocument();
  });

  it("shows red warning when not 100%", () => {
    render(
      <AttributionChips
        options={options}
        value={[{ id: "u1", label: "Audit", contribution_pct: 50 }]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(/must equal 100/i)).toBeInTheDocument();
  });

  it("treats empty list as valid", () => {
    render(
      <AttributionChips options={options} value={[]} onChange={() => {}} />,
    );
    expect(screen.getByText(/no.*— entries will be unattributed/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
cd D:/TaskTracker/frontend/task-tracker && npx vitest run src/components/invoice/AttributionChips.test.tsx
```

Expected: cannot find module.

- [ ] **Step 3: Implement the component**

Create `frontend/task-tracker/src/components/invoice/AttributionChips.tsx`:

```typescript
import { useMemo, useState } from "react";

export interface AttributionChipOption {
  id: string;
  label: string;
  color?: string;
}

export interface AttributionChipValue {
  id: string;
  label: string;
  color?: string;
  contribution_pct: number;
}

export interface AttributionChipsProps {
  options: AttributionChipOption[];
  value: AttributionChipValue[];
  onChange: (next: AttributionChipValue[]) => void;
  /** Label shown when the list is empty (e.g. "No categories"). */
  emptyHint?: string;
  placeholder?: string;
}

export default function AttributionChips({
  options,
  value,
  onChange,
  emptyHint = "No items",
  placeholder = "Add…",
}: AttributionChipsProps) {
  const [search, setSearch] = useState("");
  const totalPct = useMemo(
    () => value.reduce((s, v) => s + (v.contribution_pct || 0), 0),
    [value],
  );
  const ok = value.length === 0 || Math.abs(totalPct - 100) < 0.005;

  const available = options.filter(
    (o) =>
      !value.some((v) => v.id === o.id) &&
      o.label.toLowerCase().includes(search.toLowerCase()),
  );

  const add = (opt: AttributionChipOption) => {
    const remaining = Math.max(0, 100 - totalPct);
    onChange([
      ...value,
      { id: opt.id, label: opt.label, color: opt.color, contribution_pct: remaining || 0 },
    ]);
    setSearch("");
  };

  const update = (id: string, pct: number) =>
    onChange(value.map((v) => (v.id === id ? { ...v, contribution_pct: pct } : v)));

  const remove = (id: string) => onChange(value.filter((v) => v.id !== id));

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
        {value.map((v) => (
          <span
            key={v.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: v.color || "#e0e7ff",
              color: "#1e293b",
              padding: "3px 6px 3px 10px",
              borderRadius: 999,
              fontSize: 12,
            }}
          >
            <b>{v.label}</b>
            <input
              type="number"
              value={v.contribution_pct}
              onChange={(e) => update(v.id, Number(e.target.value))}
              min={0}
              max={100}
              style={{
                width: 56,
                padding: "1px 4px",
                border: "1px solid #cbd5e1",
                borderRadius: 4,
                fontSize: 12,
                background: "#fff",
              }}
            />
            <span>%</span>
            <button
              onClick={() => remove(v.id)}
              type="button"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 14,
                color: "#64748b",
                padding: 0,
              }}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div style={{ position: "relative", marginBottom: 4 }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={placeholder}
          style={{
            width: "100%",
            padding: "5px 8px",
            border: "1.5px solid #e2e8f0",
            borderRadius: 6,
            fontSize: 12,
          }}
        />
        {search && available.length > 0 && (
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              right: 0,
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: 6,
              maxHeight: 160,
              overflowY: "auto",
              zIndex: 10,
              marginTop: 2,
            }}
          >
            {available.map((o) => (
              <div
                key={o.id}
                onClick={() => add(o)}
                style={{ padding: "5px 10px", cursor: "pointer", fontSize: 12 }}
              >
                {o.label}
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ fontSize: 11, color: ok ? "#16a34a" : "#dc2626" }}>
        {value.length === 0
          ? `${emptyHint} — entries will be unattributed`
          : ok
            ? `✓ ${totalPct.toFixed(2)}%`
            : `✗ ${totalPct.toFixed(2)}% — must equal 100%`}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests**

```bash
cd D:/TaskTracker/frontend/task-tracker && npx vitest run src/components/invoice/AttributionChips.test.tsx
```

Expected: 3/3 pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/components/invoice/AttributionChips.tsx frontend/task-tracker/src/components/invoice/AttributionChips.test.tsx
git commit -m "feat(invoices): AttributionChips reusable component"
```

---

## Task 13: Wire attribution into `PlanModal`

**Files:**
- Modify: `frontend/task-tracker/src/components/invoice/PlanModal.tsx`
- Modify: `frontend/task-tracker/src/pages/InvoicePage.tsx`

- [ ] **Step 1: Modify `PlanModal.tsx`** — add the new fields and chips

At the top of the file, add:

```typescript
import { useEffect } from "react";
import { apiGet } from "@/lib/api";
import { useInvoiceCategories } from "@/hooks/useInvoiceCategories";
import AttributionChips, { type AttributionChipValue } from "./AttributionChips";
import type { InvoiceProjectStatus } from "@/types";
```

Extend the `useState` initialiser (line 12):

```typescript
const [form, setForm] = useState({
  client_name: plan?.client_name ?? "",
  job_description: plan?.job_description ?? "",
  periodicity: plan?.periodicity ?? "Monthly",
  start_month: plan?.start_month ?? "",
  end_month: plan?.end_month ?? "",
  invoice_day: plan?.invoice_day ?? 1,
  base_amount:
    plan?.base_amount !== null && plan?.base_amount !== undefined
      ? String(plan.base_amount)
      : "",
  id: plan?.id,
  project_status: (plan?.project_status as InvoiceProjectStatus) ?? "Projected",
  default_categories: (plan?.default_categories ?? []).map((c) => ({
    id: c.category_uid,
    label: c.category_name,
    color: c.color,
    contribution_pct: c.contribution_pct,
  })) as AttributionChipValue[],
  default_owners: (plan?.default_owners ?? []).map((o) => ({
    id: o.user_uid,
    label: o.user_name,
    contribution_pct: o.contribution_pct,
  })) as AttributionChipValue[],
});
```

Add a hook to load owner candidates (right after the `useState`):

```typescript
const { categories } = useInvoiceCategories();
const [owners, setOwners] = useState<{ id: string; label: string }[]>([]);
useEffect(() => {
  (async () => {
    interface UserListItem { uid: string; full_name?: string; username?: string; is_active?: boolean }
    const users = await apiGet<UserListItem[]>("/users/");
    setOwners(
      users
        .filter((u) => u.is_active !== false)
        .map((u) => ({ id: u.uid, label: u.full_name || u.username || u.uid })),
    );
  })().catch(() => setOwners([]));
}, []);
```

In the rendered grid (just before the closing `</div>` of the `gridTemplateColumns: "1fr 1fr"` container), add:

```jsx
<div style={{ gridColumn: "1/-1" }}>
  <label style={lbl}>Project Status</label>
  <select
    style={inp}
    value={form.project_status}
    onChange={(e) => set("project_status", e.target.value as InvoiceProjectStatus)}
  >
    <option value="Projected">Projected</option>
    <option value="Confirmed">Confirmed</option>
  </select>
</div>
<div style={{ gridColumn: "1/-1" }}>
  <label style={lbl}>Categories</label>
  <AttributionChips
    options={categories.map((c) => ({ id: c.id, label: c.name, color: c.color }))}
    value={form.default_categories as AttributionChipValue[]}
    onChange={(next) => set("default_categories", next)}
    emptyHint="No categories"
    placeholder="Add a category…"
  />
</div>
<div style={{ gridColumn: "1/-1" }}>
  <label style={lbl}>Owners</label>
  <AttributionChips
    options={owners}
    value={form.default_owners as AttributionChipValue[]}
    onChange={(next) => set("default_owners", next)}
    emptyHint="No owners"
    placeholder="Add an owner…"
  />
</div>
```

In the `save()` function, add validation before the `await onSave(form)`:

```typescript
const sumOk = (items: AttributionChipValue[]) =>
  items.length === 0 || Math.abs(items.reduce((s, i) => s + (i.contribution_pct || 0), 0) - 100) < 0.005;
if (!sumOk(form.default_categories as AttributionChipValue[]))
  return alert("Categories must sum to 100% (or be empty).");
if (!sumOk(form.default_owners as AttributionChipValue[]))
  return alert("Owners must sum to 100% (or be empty).");
```

- [ ] **Step 2: Modify `InvoicePage.tsx`** — pass the new fields through `handleSavePlan`

Find `handleSavePlan` (line 91-155). Inside `base: InvoicePlanCreate`, add:

```typescript
project_status: (form as PlanForm & { project_status?: string }).project_status ?? "Projected",
default_categories: (form as PlanForm & { default_categories?: AttributionChipValue[] }).default_categories?.map((c) => ({
  category_uid: c.id,
  contribution_pct: c.contribution_pct.toFixed(2),
})) ?? [],
default_owners: (form as PlanForm & { default_owners?: AttributionChipValue[] }).default_owners?.map((o) => ({
  user_uid: o.id,
  contribution_pct: o.contribution_pct.toFixed(2),
})) ?? [],
```

Add the import at the top:

```typescript
import type { AttributionChipValue } from "@/components/invoice/AttributionChips";
```

- [ ] **Step 3: Type-check**

```bash
cd D:/TaskTracker/frontend/task-tracker && npx tsc -b
```

Expected: no errors related to plan modal or invoice page.

- [ ] **Step 4: Manual smoke (browser)**

Start dev server (`npm run dev`), open Invoices, click `+ Add Plan`. Confirm:
- Project Status dropdown appears with default `Projected`.
- Categories chip-input shows balance indicator.
- Owners chip-input shows balance indicator.
- Save with sum ≠ 100 is blocked with an alert.
- Save with empty lists succeeds.
- Save with valid attribution succeeds and persists (refresh, reopen the plan).

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/components/invoice/PlanModal.tsx frontend/task-tracker/src/pages/InvoicePage.tsx
git commit -m "feat(invoices): plan modal — project status + chips"
```

---

## Task 14: Schedule tab — filter bar + inline badges + attributed totals

**Files:**
- Modify: `frontend/task-tracker/src/components/invoice/ScheduleTab.tsx`

- [ ] **Step 1: Add the filter state and filter bar**

At the top of the component body, add:

```typescript
const [filterCategories, setFilterCategories] = useState<string[]>([]);
const [filterOwners, setFilterOwners] = useState<string[]>([]);
const [filterStatus, setFilterStatus] = useState<"All" | "Confirmed" | "Projected">("All");
```

Above the schedule grid `<table>`, add a filter bar:

```jsx
<div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
  <select
    value={filterStatus}
    onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
    style={{ padding: "4px 8px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 12 }}
  >
    <option value="All">All Statuses</option>
    <option value="Confirmed">Confirmed</option>
    <option value="Projected">Projected</option>
  </select>
  {/* Category multi-select: simple chip-row of all categories with click-to-toggle */}
  {/* ... use existing categories from useInvoiceCategories ... */}
</div>
```

Add the `useInvoiceCategories` import + hook call near the existing imports/hooks.

- [ ] **Step 2: Filter the rendered plans/entries**

Build derived arrays:

```typescript
const filteredPlans = useMemo(() => {
  return plans.filter((p) => {
    if (filterStatus !== "All" && p.project_status !== filterStatus) return false;
    if (filterCategories.length > 0 && !p.default_categories.some((c) => filterCategories.includes(c.category_uid))) return false;
    if (filterOwners.length > 0 && !p.default_owners.some((o) => filterOwners.includes(o.user_uid))) return false;
    return true;
  });
}, [plans, filterStatus, filterCategories, filterOwners]);
```

Replace the iteration of `plans` in the grid with `filteredPlans`.

- [ ] **Step 3: Inline category/owner badges in the plan row**

In the column that renders the job description, append a small chip strip below it:

```jsx
{plan.default_categories.length > 0 && (
  <div style={{ marginTop: 4, display: "flex", gap: 4, flexWrap: "wrap" }}>
    {plan.default_categories.slice(0, 2).map((c) => (
      <span key={c.category_uid} style={{ background: c.color || "#dbeafe", padding: "1px 6px", borderRadius: 999, fontSize: 10 }}>
        {c.category_name}
      </span>
    ))}
    {plan.default_categories.length > 2 && (
      <span style={{ fontSize: 10, color: "#64748b" }}>+{plan.default_categories.length - 2}</span>
    )}
  </div>
)}
{plan.default_owners.length > 0 && (
  <div style={{ marginTop: 2, display: "flex", gap: 4, flexWrap: "wrap" }}>
    {plan.default_owners.slice(0, 2).map((o) => (
      <span key={o.user_uid} style={{ background: "#fef3c7", padding: "1px 6px", borderRadius: 999, fontSize: 10 }}>
        {o.user_name}
      </span>
    ))}
    {plan.default_owners.length > 2 && (
      <span style={{ fontSize: 10, color: "#64748b" }}>+{plan.default_owners.length - 2}</span>
    )}
  </div>
)}
```

- [ ] **Step 4: Type-check + manual smoke**

```bash
cd D:/TaskTracker/frontend/task-tracker && npx tsc -b
```

Open Invoices > Schedule. Confirm filter dropdown filters rows, badges render, no console errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/components/invoice/ScheduleTab.tsx
git commit -m "feat(invoices): schedule tab filter bar + attribution badges"
```

---

## Task 15: Extend `AmountEditModal` with Attribution section

**Files:**
- Modify: `frontend/task-tracker/src/components/invoice/AmountEditModal.tsx`
- Modify: `frontend/task-tracker/src/pages/InvoicePage.tsx`

- [ ] **Step 1: Extend the modal with collapsible Attribution**

Add to imports:

```typescript
import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { useInvoiceCategories } from "@/hooks/useInvoiceCategories";
import AttributionChips, { type AttributionChipValue } from "./AttributionChips";
import type { InvoiceProjectStatus } from "@/types";
```

Extend `AmountEditModalProps` `onSave`:

```typescript
onSave: (payload: {
  amount: number;
  scope: string;
  month: string;
  project_status?: InvoiceProjectStatus;
  categories?: AttributionChipValue[];
  owners?: AttributionChipValue[];
}) => Promise<void>;
```

In the component, add state and section UI (inside the modal, after the existing scope block):

```typescript
const [projectStatus, setProjectStatus] = useState<InvoiceProjectStatus>(
  (entry?.project_status as InvoiceProjectStatus) ?? "Projected",
);
const [cats, setCats] = useState<AttributionChipValue[]>(
  (entry?.categories ?? []).map((c) => ({
    id: c.category_uid,
    label: c.category_name,
    color: c.color,
    contribution_pct: c.contribution_pct,
  })),
);
const [owns, setOwns] = useState<AttributionChipValue[]>(
  (entry?.owners ?? []).map((o) => ({
    id: o.user_uid,
    label: o.user_name,
    contribution_pct: o.contribution_pct,
  })),
);
const [showAttribution, setShowAttribution] = useState(false);
const { categories } = useInvoiceCategories();
const [owners, setOwners] = useState<{ id: string; label: string }[]>([]);
useEffect(() => {
  (async () => {
    interface UserListItem { uid: string; full_name?: string; username?: string; is_active?: boolean }
    const users = await apiGet<UserListItem[]>("/users/");
    setOwners(
      users.filter((u) => u.is_active !== false).map((u) => ({
        id: u.uid,
        label: u.full_name || u.username || u.uid,
      })),
    );
  })().catch(() => setOwners([]));
}, []);
```

Render section (just before the buttons row at the bottom):

```jsx
<div style={{ marginBottom: 16 }}>
  <button
    type="button"
    onClick={() => setShowAttribution((s) => !s)}
    style={{ background: "none", border: "none", cursor: "pointer", color: "#2563eb", fontWeight: 700, fontSize: 12, padding: 0 }}
  >
    {showAttribution ? "▾" : "▸"} Attribution
  </button>
  {showAttribution && (
    <div style={{ marginTop: 8 }}>
      <label style={{ fontSize: 12, fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>
        Project Status
      </label>
      <select
        value={projectStatus}
        onChange={(e) => setProjectStatus(e.target.value as InvoiceProjectStatus)}
        style={{ width: "100%", padding: "6px 8px", border: "1.5px solid #e2e8f0", borderRadius: 6, fontSize: 13, marginBottom: 10 }}
      >
        <option value="Projected">Projected</option>
        <option value="Confirmed">Confirmed</option>
      </select>
      <label style={{ fontSize: 12, fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>
        Categories
      </label>
      <AttributionChips
        options={categories.map((c) => ({ id: c.id, label: c.name, color: c.color }))}
        value={cats}
        onChange={setCats}
        emptyHint="No categories"
        placeholder="Add a category…"
      />
      <div style={{ height: 10 }} />
      <label style={{ fontSize: 12, fontWeight: 700, color: "#475569", display: "block", marginBottom: 4 }}>
        Owners
      </label>
      <AttributionChips
        options={owners}
        value={owns}
        onChange={setOwns}
        emptyHint="No owners"
        placeholder="Add an owner…"
      />
    </div>
  )}
</div>
```

Update `save`:

```typescript
const sumOk = (items: AttributionChipValue[]) =>
  items.length === 0 || Math.abs(items.reduce((s, i) => s + (i.contribution_pct || 0), 0) - 100) < 0.005;
if (!sumOk(cats)) return alert("Categories must sum to 100% (or be empty).");
if (!sumOk(owns)) return alert("Owners must sum to 100% (or be empty).");
setSaving(true);
await onSave({
  amount: Number(amount),
  scope,
  month,
  project_status: projectStatus,
  categories: cats,
  owners: owns,
});
setSaving(false);
```

- [ ] **Step 2: Update `handleAmountSave` in `InvoicePage.tsx`**

Replace the body of `handleAmountSave` so the PATCH includes attribution:

```typescript
const handleAmountSave = useCallback(
  async ({
    amount,
    scope,
    month,
    project_status,
    categories,
    owners,
  }: {
    amount: number;
    scope: string;
    month: string;
    project_status?: InvoiceProjectStatus;
    categories?: AttributionChipValue[];
    owners?: AttributionChipValue[];
  }): Promise<void> => {
    if (!amtModal) return;
    const plan = amtModal.plan;
    if (!plan) return;
    const amountStr = amount.toFixed(2);
    const targets = entries.filter(
      (e) =>
        e.plan_id === plan.id &&
        (scope === "onwards"
          ? e.status === "Pending" && e.invoice_month >= month
          : e.invoice_month === month),
    );
    const payload: Record<string, unknown> = { amount: amountStr };
    if (project_status) payload.project_status = project_status;
    if (categories) {
      payload.categories = categories.map((c) => ({
        category_uid: c.id,
        contribution_pct: c.contribution_pct.toFixed(2),
      }));
    }
    if (owners) {
      payload.owners = owners.map((o) => ({
        user_uid: o.id,
        contribution_pct: o.contribution_pct.toFixed(2),
      }));
    }
    try {
      await Promise.all(
        targets.map((e) => apiPatch(`/invoice_entries/${e.id}/`, payload)),
      );
      setAmtModal(null);
      await reload();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Update failed: ${msg}`);
    }
  },
  [amtModal, entries, reload],
);
```

Add imports:

```typescript
import type { InvoiceProjectStatus } from "@/types";
```

- [ ] **Step 3: Type-check + manual smoke**

```bash
cd D:/TaskTracker/frontend/task-tracker && npx tsc -b
```

Open Invoices > Schedule, click a cell. Confirm:
- Amount edit still works.
- "▸ Attribution" toggle reveals the section.
- Editing project_status / chips and saving persists.

- [ ] **Step 4: Commit**

```bash
git add frontend/task-tracker/src/components/invoice/AmountEditModal.tsx frontend/task-tracker/src/pages/InvoicePage.tsx
git commit -m "feat(invoices): cell modal — attribution section"
```

---

## Task 16: New `ReportTab` component + tab wiring

**Files:**
- Create: `frontend/task-tracker/src/components/invoice/ReportTab.tsx`
- Modify: `frontend/task-tracker/src/pages/InvoicePage.tsx`

- [ ] **Step 1: Create the component**

```typescript
import { useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/api";
import { useInvoiceCategories } from "@/hooks/useInvoiceCategories";
import { fmtMoney } from "@/utils/money";
import type { InvoiceReportGroupBy, InvoiceReportResponse } from "@/types/api";

interface ReportTabProps {
  fy: string;
}

export default function ReportTab({ fy }: ReportTabProps) {
  const { categories } = useInvoiceCategories();
  const [groupBy, setGroupBy] = useState<InvoiceReportGroupBy>("owner");
  const [filterCategories, setFilterCategories] = useState<string[]>([]);
  const [filterOwners, setFilterOwners] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<"" | "Confirmed" | "Projected">("");
  const [data, setData] = useState<InvoiceReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [owners, setOwners] = useState<{ id: string; label: string }[]>([]);

  useEffect(() => {
    (async () => {
      interface UserListItem { uid: string; full_name?: string; username?: string; is_active?: boolean }
      const users = await apiGet<UserListItem[]>("/users/");
      setOwners(
        users.filter((u) => u.is_active !== false).map((u) => ({
          id: u.uid,
          label: u.full_name || u.username || u.uid,
        })),
      );
    })().catch(() => setOwners([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const params = new URLSearchParams();
      params.set("fy", fy);
      params.set("group_by", groupBy);
      filterCategories.forEach((c) => params.append("category", c));
      filterOwners.forEach((o) => params.append("owner", o));
      if (filterStatus) params.set("project_status", filterStatus);
      try {
        const res = await apiGet<InvoiceReportResponse>(`/invoice_reports/?${params.toString()}`);
        if (!cancelled) setData(res);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fy, groupBy, filterCategories, filterOwners, filterStatus]);

  const months = useMemo(() => (data ? Object.keys(data.totals).filter((k) => k !== "total") : []), [data]);

  const downloadCsv = () => {
    if (!data) return;
    const header = ["Group", ...months, "Total"];
    const rows = data.rows.map((r) => [r.label, ...months.map((m) => r.monthly[m] ?? "0"), r.total]);
    rows.push(["TOTAL", ...months.map((m) => data.totals[m] ?? "0"), data.totals.total ?? "0"]);
    const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoice-report-${fy}-${groupBy}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggle = (list: string[], set: (v: string[]) => void, id: string) => {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <label style={{ fontSize: 12, fontWeight: 700 }}>
          Group by:
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as InvoiceReportGroupBy)}
            style={{ marginLeft: 6, padding: "4px 8px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 12 }}
          >
            <option value="owner">Owner</option>
            <option value="category">Category</option>
            <option value="month">Month</option>
            <option value="client">Client</option>
          </select>
        </label>
        <label style={{ fontSize: 12, fontWeight: 700 }}>
          Status:
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}
            style={{ marginLeft: 6, padding: "4px 8px", borderRadius: 6, border: "1.5px solid #e2e8f0", fontSize: 12 }}
          >
            <option value="">Both</option>
            <option value="Confirmed">Confirmed</option>
            <option value="Projected">Projected</option>
          </select>
        </label>
        <button
          onClick={downloadCsv}
          disabled={!data}
          style={{ padding: "4px 10px", border: "1.5px solid #2563eb", color: "#2563eb", borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 12 }}
        >
          ⬇ CSV
        </button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        <span style={{ fontSize: 11, color: "#64748b" }}>Categories:</span>
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => toggle(filterCategories, setFilterCategories, c.id)}
            style={{
              padding: "2px 8px",
              fontSize: 11,
              borderRadius: 999,
              border: "1px solid #cbd5e1",
              background: filterCategories.includes(c.id) ? "#dbeafe" : "#fff",
              cursor: "pointer",
            }}
          >
            {c.name}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        <span style={{ fontSize: 11, color: "#64748b" }}>Owners:</span>
        {owners.map((o) => (
          <button
            key={o.id}
            onClick={() => toggle(filterOwners, setFilterOwners, o.id)}
            style={{
              padding: "2px 8px",
              fontSize: 11,
              borderRadius: 999,
              border: "1px solid #cbd5e1",
              background: filterOwners.includes(o.id) ? "#fef3c7" : "#fff",
              cursor: "pointer",
            }}
          >
            {o.label}
          </button>
        ))}
      </div>

      {loading && <div style={{ padding: 16, textAlign: "center" }}>Loading…</div>}
      {!loading && data && data.rows.length === 0 && (
        <div style={{ padding: 16, textAlign: "center", color: "#64748b" }}>No matching entries. Try widening the filters.</div>
      )}
      {!loading && data && data.rows.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f1f5f9" }}>
                <th style={{ padding: 6, textAlign: "left", border: "1px solid #e2e8f0" }}>Group</th>
                {months.map((m) => (
                  <th key={m} style={{ padding: 6, textAlign: "right", border: "1px solid #e2e8f0" }}>{m.slice(5)}</th>
                ))}
                <th style={{ padding: 6, textAlign: "right", border: "1px solid #e2e8f0" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.key} style={{ background: r.key === "Unattributed" ? "#fff7ed" : "#fff" }}>
                  <td style={{ padding: 6, border: "1px solid #e2e8f0" }}>{r.label}</td>
                  {months.map((m) => (
                    <td key={m} style={{ padding: 6, textAlign: "right", border: "1px solid #e2e8f0" }}>
                      {fmtMoney(Number(r.monthly[m] || 0))}
                    </td>
                  ))}
                  <td style={{ padding: 6, textAlign: "right", border: "1px solid #e2e8f0", fontWeight: 700 }}>
                    {fmtMoney(Number(r.total))}
                  </td>
                </tr>
              ))}
              <tr style={{ background: "#f8fafc", fontWeight: 700 }}>
                <td style={{ padding: 6, border: "1px solid #e2e8f0" }}>TOTAL</td>
                {months.map((m) => (
                  <td key={m} style={{ padding: 6, textAlign: "right", border: "1px solid #e2e8f0" }}>
                    {fmtMoney(Number(data.totals[m] || 0))}
                  </td>
                ))}
                <td style={{ padding: 6, textAlign: "right", border: "1px solid #e2e8f0" }}>
                  {fmtMoney(Number(data.totals.total || 0))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire the new tab into `InvoicePage.tsx`**

Update `TabId`:

```typescript
type TabId = "schedule" | "summary" | "invoices" | "report";
```

Add to the imports:

```typescript
import ReportTab from "@/components/invoice/ReportTab";
```

Update the tab bar list:

```typescript
[
  ["schedule", "📋 Schedule"],
  ["summary", "📊 Summary"],
  ["invoices", "🧾 Invoices"],
  ["report", "📈 Report"],
] as const
```

Add a tab body after the `tab === "invoices"` block:

```jsx
{tab === "report" && <ReportTab fy={fy} />}
```

- [ ] **Step 3: Type-check + manual smoke**

```bash
cd D:/TaskTracker/frontend/task-tracker && npx tsc -b
```

Open Invoices > Report tab. Confirm:
- Default group_by = Owner, status = Both.
- Filter chips toggle between active/inactive.
- Table renders attributed values with monthly columns + Total.
- TOTAL row shows column totals.
- CSV download works.

- [ ] **Step 4: Commit**

```bash
git add frontend/task-tracker/src/components/invoice/ReportTab.tsx frontend/task-tracker/src/pages/InvoicePage.tsx
git commit -m "feat(invoices): report tab with pivot + CSV export"
```

---

## Task 17: Invoice Categories admin UI

**Files:**
- Create: `frontend/task-tracker/src/components/invoice/InvoiceCategoriesAdmin.tsx`
- Modify: `frontend/task-tracker/src/components/invoice/PlanModal.tsx`

- [ ] **Step 1: Create the admin modal**

```typescript
import { useState } from "react";
import { apiDelete, apiPatch, apiPost } from "@/lib/api";
import { useInvoiceCategories } from "@/hooks/useInvoiceCategories";
import type { InvoiceCategoryCreate } from "@/types/api";

interface Props {
  defaultOrgUid: string;
  onClose: () => void;
}

export default function InvoiceCategoriesAdmin({ defaultOrgUid, onClose }: Props) {
  const { categories, reload } = useInvoiceCategories();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#dbeafe");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const body: InvoiceCategoryCreate = { name: name.trim(), org: defaultOrgUid, color };
      await apiPost("/invoice_categories/", body);
      setName("");
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (id: string, is_active: boolean) => {
    await apiPatch(`/invoice_categories/${id}/`, { is_active });
    await reload();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this category?")) return;
    try {
      await apiDelete(`/invoice_categories/${id}/`);
      await reload();
    } catch (e) {
      alert(`Cannot delete — category may be in use. (${(e as Error).message})`);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: "100%", maxWidth: 480, maxHeight: "85vh", overflowY: "auto", boxShadow: "0 8px 32px rgba(0,0,0,.18)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>🏷️ Invoice Categories</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category name" style={{ flex: 1, padding: "5px 8px", border: "1.5px solid #e2e8f0", borderRadius: 6, fontSize: 13 }} />
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 40, padding: 0, border: "1.5px solid #e2e8f0", borderRadius: 6 }} />
          <button onClick={add} disabled={busy || !name.trim()} style={{ padding: "5px 14px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
            Add
          </button>
        </div>
        {categories.map((c) => (
          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderBottom: "1px solid #f1f5f9", opacity: c.is_active ? 1 : 0.5 }}>
            <span style={{ width: 14, height: 14, background: c.color || "#dbeafe", borderRadius: 3 }} />
            <span style={{ flex: 1, fontSize: 13 }}>{c.name}</span>
            <button onClick={() => toggleActive(c.id, !c.is_active)} style={{ fontSize: 11, padding: "2px 6px", border: "1px solid #cbd5e1", borderRadius: 4, background: "#fff", cursor: "pointer" }}>
              {c.is_active ? "Deactivate" : "Activate"}
            </button>
            <button onClick={() => remove(c.id)} style={{ fontSize: 11, padding: "2px 6px", border: "1px solid #fecaca", color: "#dc2626", borderRadius: 4, background: "#fff", cursor: "pointer" }}>
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add a "+ Manage categories" link in PlanModal**

In `PlanModal.tsx`, near the Categories chip-input label, add:

```jsx
<button
  type="button"
  onClick={() => setShowCatAdmin(true)}
  style={{ marginLeft: 6, fontSize: 11, color: "#2563eb", background: "none", border: "none", cursor: "pointer" }}
>
  + Manage categories
</button>
```

Add state at the top of the component:

```typescript
const [showCatAdmin, setShowCatAdmin] = useState(false);
```

Add `defaultOrgUid?: string` as a new prop to `PlanModalProps` (so the modal knows which org to scope categories to):

```typescript
interface PlanModalProps {
  plan?: Partial<InvoicePlan> | null;
  onSave: (form: unknown) => Promise<void>;
  onClose: () => void;
  defaultOrgUid?: string;
}
```

Pass it from `InvoicePage.tsx` (in the existing PlanModal render):

```jsx
<PlanModal
  plan={planModal}
  onSave={(form) => handleSavePlan(form as PlanForm)}
  onClose={() => setPlanModal(null)}
  defaultOrgUid={selectedOrg}
/>
```

The "+ Manage categories" button must be disabled when `defaultOrgUid` is empty (All Orgs view) — categories need an org to belong to:

```jsx
<button
  type="button"
  onClick={() => setShowCatAdmin(true)}
  disabled={!defaultOrgUid}
  title={defaultOrgUid ? "" : "Pick an org from the header first"}
  style={{ marginLeft: 6, fontSize: 11, color: defaultOrgUid ? "#2563eb" : "#94a3b8", background: "none", border: "none", cursor: defaultOrgUid ? "pointer" : "not-allowed" }}
>
  + Manage categories
</button>
```

Render at the bottom (before closing `</div>` of the modal card):

```jsx
{showCatAdmin && defaultOrgUid && (
  <InvoiceCategoriesAdmin
    defaultOrgUid={defaultOrgUid}
    onClose={() => setShowCatAdmin(false)}
  />
)}
```

- [ ] **Step 3: Type-check + manual smoke**

```bash
cd D:/TaskTracker/frontend/task-tracker && npx tsc -b
```

Open Invoices > + Add Plan > "+ Manage categories". Confirm:
- Modal opens.
- Add a new category — appears in the list.
- Toggle active/deactivate.
- Delete unused category — works. Delete in-use category — alert appears with backend error.

- [ ] **Step 4: Commit**

```bash
git add frontend/task-tracker/src/components/invoice/InvoiceCategoriesAdmin.tsx frontend/task-tracker/src/components/invoice/PlanModal.tsx frontend/task-tracker/src/pages/InvoicePage.tsx
git commit -m "feat(invoices): inline categories admin from plan modal"
```

---

## Task 18: Final integration smoke test + full test suite

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend test suite**

```bash
cd D:/TaskTracker && python -m pytest core/invoices/ -v
```

Expected: every test passes, no regressions in `GeneratePrunesOutOfRangePendingTests`.

- [ ] **Step 2: Run the frontend type-check + tests**

```bash
cd D:/TaskTracker/frontend/task-tracker && npx tsc -b && npx vitest run
```

Expected: clean build, AttributionChips tests pass.

- [ ] **Step 3: Manual end-to-end smoke**

Open the app fresh, log in as an admin, navigate to Invoices:

1. Create a new Invoice Category from the Plan modal's "+ Manage categories" link.
2. Create a new Plan with two categories (60/40), one owner (100%), Project Status = Confirmed. Save.
3. Schedule grid shows the plan with attribution badges, generated entries inherit defaults.
4. Click an Apr cell, expand Attribution, change project_status to Projected for "this month only", save.
5. Switch to Report tab, group_by = Owner. Confirm attributed values look right.
6. Toggle a Category filter chip — table updates.
7. Toggle Status filter to Confirmed — only Confirmed entries show.
8. Download CSV — opens with the table contents.

- [ ] **Step 4: Final commit + branch sanity**

```bash
git status
git log --oneline -20
```

If everything is clean, the feature is ready for review.

---

## Notes for the implementer

- **Order matters.** Backend tasks 1–8 must land before the frontend tasks; the frontend types depend on the DTO shape.
- **Existing data is preserved** by design: every migration uses additive `AddField` + `CreateModel`, never `RemoveField` or `AlterField` that would drop data. Existing entries get `project_status='Projected'` and empty attribution lists.
- **The reusable `AttributionChips` component** is the single source of truth for the chip UX — used in three places (PlanModal, AmountEditModal, also implicitly the same shape as the report's filter chips). Don't fork it.
- **Validation lives on the serializer**, not the model. Sum-100 enforcement at the API layer surfaces field-level errors to the UI cleanly.
- **`generate` is the only place** plan defaults are copied to entries. Editing plan defaults later does NOT retro-update existing entries — same model as `base_amount` today.
