# Invoice Report cell-count + drill-down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a small superscript "distinct client count" to every value cell on the Invoice Tracker → Report tab (Owner / Category / Month modes) and make every value cell clickable to open a modal showing a Client | Category | Month | Amount breakdown for that cell.

**Architecture:**
- Backend: extend `InvoiceReportView` to also return per-cell distinct-client counts; add a new `InvoiceReportCellView` endpoint that returns drill-down rows for one cell.
- Frontend: extend report types, render counts in the existing cells, replace cell text with a button that opens a new `ReportCellModal` component which fetches and displays the drill-down.

**Tech Stack:** Django REST framework, React + TypeScript (Vite), pytest-django for backend tests.

**Spec:** [docs/superpowers/specs/2026-05-04-invoice-report-cell-count-drilldown-design.md](../specs/2026-05-04-invoice-report-cell-count-drilldown-design.md)

---

## File Structure

**Backend:**
- Modify: `core/invoices/views.py` — augment `InvoiceReportView`, add `InvoiceReportCellView`.
- Modify: `core/invoices/urls.py` — wire the new endpoint.
- Modify: `core/invoices/tests.py` — extend `InvoiceReportsTests`, add `InvoiceReportCellTests`.

**Frontend:**
- Modify: `frontend/task-tracker/src/types/api/invoice.ts` — extend `InvoiceReportRow` / `InvoiceReportResponse`; add `InvoiceReportCellRow` and `InvoiceReportCellResponse`.
- Modify: `frontend/task-tracker/src/components/invoice/ReportTab.tsx` — render cell counts, make cells clickable, host the modal.
- Create: `frontend/task-tracker/src/components/invoice/ReportCellModal.tsx` — drill-down modal.

---

## Task 1: Backend test — `monthly_clients` and `total_clients` for owner mode

**Files:**
- Modify (test): `core/invoices/tests.py`

The existing `InvoiceReportsTests.setUp` creates one client `X`, one plan, one entry in `2026-04` with two owners (admin + U2 at 50/50) and two categories (Audit + Tax at 60/40). We extend `setUp` minimally — add a second client + plan + entry in `2026-05` to make the count interesting — and add focused tests.

- [ ] **Step 1: Add a second client + entry in `setUp` for richer counts**

In `core/invoices/tests.py`, in `InvoiceReportsTests.setUp`, after the existing `InvoiceEntryOwner.objects.create(... user=self.user2 ...)` line and before the `self.api = APIClient()` line, append:

```python
        # Second client / plan / entry in May, owned by admin only,
        # categorised entirely as Audit. Lets us test:
        #   - per-month distinct-client count differs by month
        #   - row-total count dedupes when same client appears twice
        #   - column-total count counts unique clients across rows
        self.client_master_b = Master.objects.create(name="Y", type="client", org=self.org)
        self.client_master_b.orgs.add(self.org)
        self.plan_b = InvoicePlan.objects.create(
            org=self.org,
            client=self.client_master_b,
            job_description="J2",
            periodicity="Monthly",
            start_month=_dt.date(2026, 5, 1),
            end_month=_dt.date(2026, 5, 1),
            invoice_day=1,
            base_amount=2000,
            project_status="Confirmed",
        )
        self.entry_b = InvoiceEntry.objects.create(
            plan=self.plan_b, invoice_month=_dt.date(2026, 5, 1), amount=2000
        )
        self.entry_b.project_status = "Confirmed"
        self.entry_b.save()
        InvoiceEntryCategory.objects.create(entry=self.entry_b, category=self.cat_a, contribution_pct=100)
        InvoiceEntryOwner.objects.create(entry=self.entry_b, user=self.admin, contribution_pct=100)
```

- [ ] **Step 2: Add `test_owner_mode_returns_per_cell_client_counts`**

Append to `InvoiceReportsTests`:

```python
    def test_owner_mode_returns_per_cell_client_counts(self):
        res = self.api.get("/api/invoice_reports/?fy=2026-27&group_by=owner")
        self.assertEqual(res.status_code, 200, res.data)
        rows = {r["label"]: r for r in res.data["rows"]}
        admin_row = rows["Rep_Admin"]
        u2_row = rows["U2"]
        # Admin owns entry (April, client X) and entry_b (May, client Y).
        self.assertEqual(admin_row["monthly_clients"]["2026-04"], 1)
        self.assertEqual(admin_row["monthly_clients"]["2026-05"], 1)
        self.assertEqual(admin_row["total_clients"], 2)
        # U2 owns only the April entry → one client, one month.
        self.assertEqual(u2_row["monthly_clients"]["2026-04"], 1)
        self.assertEqual(u2_row["monthly_clients"].get("2026-05", 0), 0)
        self.assertEqual(u2_row["total_clients"], 1)
```

- [ ] **Step 3: Run tests — expect FAIL**

Run: `python -m pytest core/invoices/tests.py::InvoiceReportsTests::test_owner_mode_returns_per_cell_client_counts -v`

Expected: FAIL — `KeyError: 'monthly_clients'` (the field is not yet returned).

- [ ] **Step 4: Commit the failing test**

```bash
git add core/invoices/tests.py
git commit -m "test(invoices): owner-mode report returns per-cell client counts"
```

---

## Task 2: Backend implementation — accumulate distinct-client counts in `InvoiceReportView`

**Files:**
- Modify: `core/invoices/views.py:432-533` (`InvoiceReportView.get`)

- [ ] **Step 1: Track client-id sets alongside amounts**

In `core/invoices/views.py`, replace the body of `InvoiceReportView.get` from the `# rows[key] = ...` comment down to the `return Response(...)` block with:

```python
        # rows[key] = {"label": ..., "monthly": defaultdict(Decimal), "monthly_clients": defaultdict(set), ...}
        rows: dict[str, dict] = {}
        col_totals: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
        col_clients: dict[str, set] = defaultdict(set)
        grand_clients: set = set()

        UNATTRIB_KEY = "Unattributed"

        def _bump(key, label, month_str, value, client_id):
            if key not in rows:
                rows[key] = {
                    "key": key,
                    "label": label,
                    "monthly": defaultdict(lambda: Decimal("0")),
                    "monthly_clients": defaultdict(set),
                    "row_clients": set(),
                    "total": Decimal("0"),
                }
            rows[key]["monthly"][month_str] += value
            rows[key]["total"] += value
            col_totals[month_str] += value
            if client_id is not None:
                rows[key]["monthly_clients"][month_str].add(client_id)
                rows[key]["row_clients"].add(client_id)
                col_clients[month_str].add(client_id)
                grand_clients.add(client_id)

        for entry in qs:
            amt = entry.amount or Decimal("0")
            month_str = entry.invoice_month.strftime("%Y-%m")
            client_id = entry.plan.client_id
            if group_by == "category":
                cat_links = list(entry.category_links.all())
                if not cat_links:
                    _bump(UNATTRIB_KEY, "Unattributed", month_str, amt, client_id)
                else:
                    for cat_link in cat_links:
                        share = amt * cat_link.contribution_pct / Decimal("100")
                        _bump(str(cat_link.category.uid), cat_link.category.name, month_str, share, client_id)
            elif group_by == "owner":
                owner_links = list(entry.owner_links.all())
                if not owner_links:
                    _bump(UNATTRIB_KEY, "Unattributed", month_str, amt, client_id)
                else:
                    for owner_link in owner_links:
                        share = amt * owner_link.contribution_pct / Decimal("100")
                        label = owner_link.user.full_name or owner_link.user.username
                        _bump(str(owner_link.user.uid), label, month_str, share, client_id)
            elif group_by == "month":
                _bump(month_str, month_str, month_str, amt, client_id)
            elif group_by == "client":
                client = entry.plan.client
                key = str(client.uid) if client else "no-client"
                label = client.name if client else "(no client)"
                _bump(key, label, month_str, amt, client_id)

        # Serialise.
        out_rows = []
        for r in rows.values():
            row_payload = {
                "key": r["key"],
                "label": r["label"],
                "monthly": {m: str(r["monthly"].get(m, Decimal("0"))) for m in months},
                "total": str(r["total"]),
            }
            if group_by != "client":
                row_payload["monthly_clients"] = {
                    m: len(r["monthly_clients"].get(m, set())) for m in months
                }
                row_payload["total_clients"] = len(r["row_clients"])
            out_rows.append(row_payload)
        out_rows.sort(key=lambda r: (r["key"] == UNATTRIB_KEY, r["label"].lower()))

        totals_payload: dict = {
            **{m: str(col_totals.get(m, Decimal("0"))) for m in months},
            "total": str(sum(col_totals.values()) or Decimal("0")),
        }
        if group_by != "client":
            totals_payload["monthly_clients"] = {
                m: len(col_clients.get(m, set())) for m in months
            }
            totals_payload["total_clients"] = len(grand_clients)

        return Response(
            {
                "fy": fy,
                "group_by": group_by,
                "rows": out_rows,
                "totals": totals_payload,
            }
        )
```

- [ ] **Step 2: Run the test — expect PASS**

Run: `python -m pytest core/invoices/tests.py::InvoiceReportsTests::test_owner_mode_returns_per_cell_client_counts -v`

Expected: PASS.

- [ ] **Step 3: Run the full report tests to verify no regressions**

Run: `python -m pytest core/invoices/tests.py::InvoiceReportsTests -v`

Expected: all 5 existing + 1 new test PASS.

- [ ] **Step 4: Commit**

```bash
git add core/invoices/views.py
git commit -m "feat(invoices): report endpoint returns per-cell distinct-client counts"
```

---

## Task 3: Backend tests — counts for category, month, and client modes

**Files:**
- Modify (test): `core/invoices/tests.py`

- [ ] **Step 1: Add three more tests after `test_owner_mode_returns_per_cell_client_counts`**

```python
    def test_category_mode_counts_distinct_clients(self):
        res = self.api.get("/api/invoice_reports/?fy=2026-27&group_by=category")
        rows = {r["label"]: r for r in res.data["rows"]}
        # Audit row: April entry contributes (client X), May entry contributes (client Y) → 2 distinct.
        self.assertEqual(rows["Audit"]["monthly_clients"]["2026-04"], 1)
        self.assertEqual(rows["Audit"]["monthly_clients"]["2026-05"], 1)
        self.assertEqual(rows["Audit"]["total_clients"], 2)
        # Tax row: only April entry → 1 client.
        self.assertEqual(rows["Tax"]["total_clients"], 1)
        # Column totals.
        self.assertEqual(res.data["totals"]["monthly_clients"]["2026-04"], 1)  # only client X in April
        self.assertEqual(res.data["totals"]["monthly_clients"]["2026-05"], 1)  # only client Y in May
        self.assertEqual(res.data["totals"]["total_clients"], 2)               # both clients across FY

    def test_month_mode_counts_distinct_clients(self):
        res = self.api.get("/api/invoice_reports/?fy=2026-27&group_by=month")
        rows = {r["label"]: r for r in res.data["rows"]}
        self.assertEqual(rows["2026-04"]["monthly_clients"]["2026-04"], 1)
        self.assertEqual(rows["2026-05"]["monthly_clients"]["2026-05"], 1)

    def test_client_mode_omits_count_fields(self):
        res = self.api.get("/api/invoice_reports/?fy=2026-27&group_by=client")
        for row in res.data["rows"]:
            self.assertNotIn("monthly_clients", row)
            self.assertNotIn("total_clients", row)
        self.assertNotIn("monthly_clients", res.data["totals"])
        self.assertNotIn("total_clients", res.data["totals"])
```

- [ ] **Step 2: Run tests — expect PASS**

Run: `python -m pytest core/invoices/tests.py::InvoiceReportsTests -v`

Expected: all PASS (the implementation in Task 2 already covers these).

- [ ] **Step 3: Commit**

```bash
git add core/invoices/tests.py
git commit -m "test(invoices): client counts in category/month modes; client mode omits"
```

---

## Task 4: Backend test — new `InvoiceReportCellView` endpoint (owner mode happy path)

**Files:**
- Modify (test): `core/invoices/tests.py`

- [ ] **Step 1: Add a new test class for the cell endpoint**

Append to `core/invoices/tests.py` after the `InvoiceReportsTests` class:

```python
class InvoiceReportCellTests(TestCase):
    """Drill-down endpoint that backs the click-to-expand modal on the
    Invoice Tracker → Report tab."""

    def setUp(self):
        from core.invoices.models import (
            InvoiceCategory,
            InvoiceEntryCategory,
            InvoiceEntryOwner,
        )

        self.org, self.admin = _make_org_admin("cell_admin")
        self.user2 = User.objects.create_user(username="cell_u2", password="pw", full_name="U2")
        OrgMembership.objects.create(user=self.user2, org=self.org, role="member")

        self.client_x = Master.objects.create(name="Client X", type="client", org=self.org)
        self.client_x.orgs.add(self.org)
        self.client_y = Master.objects.create(name="Client Y", type="client", org=self.org)
        self.client_y.orgs.add(self.org)

        self.cat_a = InvoiceCategory.objects.create(org=self.org, name="Audit")
        self.cat_b = InvoiceCategory.objects.create(org=self.org, name="Tax")

        # Plan 1 — Client X, April + May, owners admin/U2 50/50, cats Audit/Tax 60/40.
        plan_x = InvoicePlan.objects.create(
            org=self.org, client=self.client_x, job_description="J",
            periodicity="Monthly",
            start_month=_dt.date(2026, 4, 1), end_month=_dt.date(2026, 5, 1),
            invoice_day=1, base_amount=1000, project_status="Confirmed",
        )
        for month_date in (_dt.date(2026, 4, 1), _dt.date(2026, 5, 1)):
            e = InvoiceEntry.objects.create(plan=plan_x, invoice_month=month_date, amount=1000)
            e.project_status = "Confirmed"
            e.save()
            InvoiceEntryCategory.objects.create(entry=e, category=self.cat_a, contribution_pct=60)
            InvoiceEntryCategory.objects.create(entry=e, category=self.cat_b, contribution_pct=40)
            InvoiceEntryOwner.objects.create(entry=e, user=self.admin, contribution_pct=50)
            InvoiceEntryOwner.objects.create(entry=e, user=self.user2, contribution_pct=50)

        # Plan 2 — Client Y, April only, owner admin 100%, cat Audit 100%.
        plan_y = InvoicePlan.objects.create(
            org=self.org, client=self.client_y, job_description="J",
            periodicity="Monthly",
            start_month=_dt.date(2026, 4, 1), end_month=_dt.date(2026, 4, 1),
            invoice_day=1, base_amount=2000, project_status="Confirmed",
        )
        e2 = InvoiceEntry.objects.create(plan=plan_y, invoice_month=_dt.date(2026, 4, 1), amount=2000)
        e2.project_status = "Confirmed"
        e2.save()
        InvoiceEntryCategory.objects.create(entry=e2, category=self.cat_a, contribution_pct=100)
        InvoiceEntryOwner.objects.create(entry=e2, user=self.admin, contribution_pct=100)

        self.api = APIClient()
        _auth(self.api, self.admin)

    def test_owner_inner_cell_returns_per_category_per_client_rows(self):
        # Drill on (admin, 2026-04). Admin owns entry_x_apr (50%) and entry_y_apr (100%).
        res = self.api.get(
            "/api/invoice_reports/cell/"
            f"?fy=2026-27&group_by=owner&row_key={self.admin.uid}&month=2026-04"
        )
        self.assertEqual(res.status_code, 200, res.data)
        body = res.data
        # entry_x_apr × admin 50% × Audit 60% = 300
        # entry_x_apr × admin 50% × Tax 40%   = 200
        # entry_y_apr × admin 100% × Audit 100% = 2000
        rows = body["rows"]
        self.assertEqual(len(rows), 3)
        # Sort: client asc, category asc, month asc
        self.assertEqual(rows[0]["client"], "Client X")
        self.assertEqual(rows[0]["category"], "Audit")
        self.assertEqual(rows[0]["month"], "2026-04")
        self.assertEqual(float(rows[0]["amount"]), 300.0)
        self.assertEqual(rows[1]["client"], "Client X")
        self.assertEqual(rows[1]["category"], "Tax")
        self.assertEqual(float(rows[1]["amount"]), 200.0)
        self.assertEqual(rows[2]["client"], "Client Y")
        self.assertEqual(float(rows[2]["amount"]), 2000.0)
        self.assertEqual(float(body["total_amount"]), 2500.0)
        self.assertEqual(body["client_count"], 2)
```

- [ ] **Step 2: Run — expect FAIL**

Run: `python -m pytest core/invoices/tests.py::InvoiceReportCellTests::test_owner_inner_cell_returns_per_category_per_client_rows -v`

Expected: FAIL — endpoint not registered (404).

- [ ] **Step 3: Commit the failing test**

```bash
git add core/invoices/tests.py
git commit -m "test(invoices): drill-down cell endpoint — owner inner-cell happy path"
```

---

## Task 5: Backend implementation — `InvoiceReportCellView`

**Files:**
- Modify: `core/invoices/views.py` — add new view class after `InvoiceReportView`.
- Modify: `core/invoices/urls.py` — register URL.

- [ ] **Step 1: Add the view class**

In `core/invoices/views.py`, after the closing of `InvoiceReportView` (end of file is fine), append:

```python
class InvoiceReportCellView(APIView):
    """Drill-down for one cell on the Invoice Report grid. Returns one
    row per (client, category_link, invoice_month) of every entry that
    contributes to the cell, with proportional shares applied so the sum
    of returned ``amount`` equals the cell's amount in the main report.
    """

    permission_classes = [permissions.IsAuthenticated]

    TOTAL = "__total__"
    UNCATEGORIZED = "(uncategorized)"
    NO_CLIENT = "(no client)"

    def get(self, request):
        fy = request.query_params.get("fy")
        group_by = request.query_params.get("group_by")
        row_key = request.query_params.get("row_key")
        month = request.query_params.get("month")
        if not fy or group_by not in {"owner", "category", "month"} or not row_key or not month:
            return Response(
                {"error": "fy, group_by (owner|category|month), row_key, month are required"},
                status=400,
            )

        months = _fy_months(fy)
        user = cast(User, request.user)

        qs = InvoiceEntry.objects.filter(plan__org_id__in=user.org_ids())
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

        # Restrict by month unless drilling Total column / grand total.
        if month != self.TOTAL:
            qs = qs.filter(invoice_month=f"{month}-01")

        qs = qs.select_related("plan", "plan__client").prefetch_related(
            "category_links__category", "owner_links__user"
        )

        # Restrict by row identity per group_by, unless drilling TOTAL row / grand total.
        # row_key is a uid string for owner/category, or a "YYYY-MM" string for month mode.
        # Some rows in main report use sentinel "Unattributed" for entries with no
        # owner/category links — we surface them when row_key == "Unattributed".
        UNATTRIB = "Unattributed"
        if row_key != self.TOTAL:
            if group_by == "owner":
                if row_key == UNATTRIB:
                    qs = qs.filter(owner_links__isnull=True)
                else:
                    qs = qs.filter(owner_links__user__uid=row_key)
            elif group_by == "category":
                if row_key == UNATTRIB:
                    qs = qs.filter(category_links__isnull=True)
                else:
                    qs = qs.filter(category_links__category__uid=row_key)
            elif group_by == "month":
                qs = qs.filter(invoice_month=f"{row_key}-01")

        out_rows = []
        client_ids: set = set()
        total = Decimal("0")

        # The single category we're focused on, when drilling category mode.
        focus_cat_uid = row_key if (group_by == "category" and row_key not in (self.TOTAL, UNATTRIB)) else None
        # The single owner we're focused on, when drilling owner mode.
        focus_owner_uid = row_key if (group_by == "owner" and row_key not in (self.TOTAL, UNATTRIB)) else None

        for entry in qs.distinct():
            amt = entry.amount or Decimal("0")
            month_str = entry.invoice_month.strftime("%Y-%m")
            client_label = entry.plan.client.name if entry.plan.client_id else self.NO_CLIENT
            if entry.plan.client_id is not None:
                client_ids.add(entry.plan.client_id)

            # Compute owner multiplier for owner mode (1.0 otherwise).
            owner_mult = Decimal("1")
            if group_by == "owner":
                if focus_owner_uid is None:
                    # Total column drill or Unattributed drill → pick the single
                    # owner-share that pertains. For TOTAL we sum over every owner;
                    # for Unattributed there are no owner links, so multiplier is 1.
                    pass  # handled by per-owner_link iteration below
                else:
                    # Find this entry's owner_link for the focus owner.
                    for ol in entry.owner_links.all():
                        if str(ol.user.uid) == focus_owner_uid:
                            owner_mult = ol.contribution_pct / Decimal("100")
                            break

            cat_links = list(entry.category_links.all())

            def _emit(category_label, cat_share):
                row_amt = (amt * owner_mult * cat_share).quantize(Decimal("0.01"))
                out_rows.append({
                    "client": client_label,
                    "category": category_label,
                    "month": month_str,
                    "amount": str(row_amt),
                })
                nonlocal total
                total += row_amt

            if group_by == "owner" and focus_owner_uid is None and row_key == self.TOTAL:
                # Total column drill in owner mode: emit one row per owner_link × category_link.
                if not entry.owner_links.exists():
                    if not cat_links:
                        _emit(self.UNCATEGORIZED, Decimal("1"))
                    else:
                        for cl in cat_links:
                            _emit(cl.category.name, cl.contribution_pct / Decimal("100"))
                else:
                    for ol in entry.owner_links.all():
                        owner_mult_local = ol.contribution_pct / Decimal("100")
                        if not cat_links:
                            row_amt = (amt * owner_mult_local).quantize(Decimal("0.01"))
                            out_rows.append({
                                "client": client_label,
                                "category": self.UNCATEGORIZED,
                                "month": month_str,
                                "amount": str(row_amt),
                            })
                            total += row_amt
                        else:
                            for cl in cat_links:
                                row_amt = (amt * owner_mult_local * cl.contribution_pct / Decimal("100")).quantize(Decimal("0.01"))
                                out_rows.append({
                                    "client": client_label,
                                    "category": cl.category.name,
                                    "month": month_str,
                                    "amount": str(row_amt),
                                })
                                total += row_amt
                continue

            # Standard branches (owner-focused, category mode, month mode).
            if focus_cat_uid is not None:
                # Category mode focused on one category — only emit that category's share.
                for cl in cat_links:
                    if str(cl.category.uid) == focus_cat_uid:
                        _emit(cl.category.name, cl.contribution_pct / Decimal("100"))
                        break
            else:
                if not cat_links:
                    _emit(self.UNCATEGORIZED, Decimal("1"))
                else:
                    for cl in cat_links:
                        _emit(cl.category.name, cl.contribution_pct / Decimal("100"))

        out_rows.sort(key=lambda r: (r["client"], r["category"], r["month"]))

        return Response({
            "rows": out_rows,
            "total_amount": str(total),
            "client_count": len(client_ids),
        })
```

- [ ] **Step 2: Wire URL**

Edit `core/invoices/urls.py`:

```python
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    InvoiceCategoryViewSet,
    InvoiceEntryViewSet,
    InvoicePlanViewSet,
    InvoiceReportCellView,
    InvoiceReportView,
)

router = DefaultRouter()
router.register("invoice_plans", InvoicePlanViewSet, basename="invoiceplan")
router.register("invoice_entries", InvoiceEntryViewSet, basename="invoiceentry")
router.register("invoice_categories", InvoiceCategoryViewSet, basename="invoicecategory")

urlpatterns = [
    path("", include(router.urls)),
    path("invoice_reports/", InvoiceReportView.as_view(), name="invoice-reports"),
    path("invoice_reports/cell/", InvoiceReportCellView.as_view(), name="invoice-report-cell"),
]
```

- [ ] **Step 3: Run the new test**

Run: `python -m pytest core/invoices/tests.py::InvoiceReportCellTests::test_owner_inner_cell_returns_per_category_per_client_rows -v`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add core/invoices/views.py core/invoices/urls.py
git commit -m "feat(invoices): drill-down cell endpoint for report tab"
```

---

## Task 6: Backend tests — category mode + month mode + totals + filters

**Files:**
- Modify (test): `core/invoices/tests.py`

- [ ] **Step 1: Append four more tests to `InvoiceReportCellTests`**

```python
    def test_category_inner_cell_returns_only_focus_category_share(self):
        # Drill on (Audit, 2026-04). Both entries contribute Audit share.
        res = self.api.get(
            "/api/invoice_reports/cell/"
            f"?fy=2026-27&group_by=category&row_key={self.cat_a.uid}&month=2026-04"
        )
        self.assertEqual(res.status_code, 200, res.data)
        body = res.data
        # entry_x_apr × Audit 60% = 600 (client X)
        # entry_y_apr × Audit 100% = 2000 (client Y)
        labels = [(r["client"], r["category"], float(r["amount"])) for r in body["rows"]]
        self.assertIn(("Client X", "Audit", 600.0), labels)
        self.assertIn(("Client Y", "Audit", 2000.0), labels)
        # No Tax rows in this drill.
        self.assertFalse(any(r["category"] == "Tax" for r in body["rows"]))
        self.assertEqual(float(body["total_amount"]), 2600.0)
        self.assertEqual(body["client_count"], 2)

    def test_month_inner_cell_lists_all_categories(self):
        # Drill on (2026-04, 2026-04). All April entries × all category links.
        res = self.api.get(
            "/api/invoice_reports/cell/"
            "?fy=2026-27&group_by=month&row_key=2026-04&month=2026-04"
        )
        body = res.data
        # entry_x_apr: Audit 60% = 600, Tax 40% = 400 (client X)
        # entry_y_apr: Audit 100% = 2000 (client Y)
        amounts = sorted(float(r["amount"]) for r in body["rows"])
        self.assertEqual(amounts, [400.0, 600.0, 2000.0])
        self.assertEqual(float(body["total_amount"]), 3000.0)
        self.assertEqual(body["client_count"], 2)

    def test_total_column_drill_aggregates_across_months(self):
        # Drill on (admin, Total). Row Total for owner mode across full FY.
        res = self.api.get(
            "/api/invoice_reports/cell/"
            f"?fy=2026-27&group_by=owner&row_key={self.admin.uid}&month=__total__"
        )
        body = res.data
        # Admin's slice: April (X 50%×60%=300 Audit, X 50%×40%=200 Tax, Y 100%×100%=2000 Audit)
        #               May   (X 50%×60%=300 Audit, X 50%×40%=200 Tax)
        # Total = 3000.
        self.assertEqual(float(body["total_amount"]), 3000.0)
        # Months column should now have multiple distinct values.
        months_in_response = {r["month"] for r in body["rows"]}
        self.assertEqual(months_in_response, {"2026-04", "2026-05"})

    def test_filter_by_project_status_propagates_to_cell(self):
        # All entries are Confirmed → ?project_status=Projected returns nothing.
        res = self.api.get(
            "/api/invoice_reports/cell/"
            f"?fy=2026-27&group_by=owner&row_key={self.admin.uid}&month=2026-04&project_status=Projected"
        )
        self.assertEqual(res.status_code, 200, res.data)
        self.assertEqual(res.data["rows"], [])
        self.assertEqual(float(res.data["total_amount"]), 0.0)
        self.assertEqual(res.data["client_count"], 0)
```

- [ ] **Step 2: Run all `InvoiceReportCellTests`**

Run: `python -m pytest core/invoices/tests.py::InvoiceReportCellTests -v`

Expected: all 5 tests PASS.

- [ ] **Step 3: Run full invoices test suite for regressions**

Run: `python -m pytest core/invoices/tests.py -v`

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add core/invoices/tests.py
git commit -m "test(invoices): cell endpoint covers category/month modes, totals, filters"
```

---

## Task 7: Frontend types — extend report types and add cell types

**Files:**
- Modify: `frontend/task-tracker/src/types/api/invoice.ts:178-198`

- [ ] **Step 1: Replace the existing report-type block**

In `frontend/task-tracker/src/types/api/invoice.ts`, replace lines 178–198 (the `InvoiceReportRow`, `InvoiceReportResponse`, `InvoiceReportRequest` block) with:

```typescript
export interface InvoiceReportRow {
  readonly key: string;
  readonly label: string;
  readonly monthly: Readonly<Record<string, string>>;
  readonly monthly_clients?: Readonly<Record<string, number>>;
  readonly total: string;
  readonly total_clients?: number;
}

export interface InvoiceReportTotals {
  readonly [month: string]: string | Readonly<Record<string, number>> | number | undefined;
  readonly total?: string;
  readonly monthly_clients?: Readonly<Record<string, number>>;
  readonly total_clients?: number;
}

export interface InvoiceReportResponse {
  readonly fy: string;
  readonly group_by: InvoiceReportGroupBy;
  readonly rows: readonly InvoiceReportRow[];
  readonly totals: InvoiceReportTotals;
}

export interface InvoiceReportRequest {
  readonly fy: string;
  readonly group_by: InvoiceReportGroupBy;
  readonly category?: readonly Uid[];
  readonly owner?: readonly Uid[];
  readonly project_status?: InvoiceProjectStatus;
}

export interface InvoiceReportCellRow {
  readonly client: string;
  readonly category: string;
  readonly month: string;
  readonly amount: string;
}

export interface InvoiceReportCellResponse {
  readonly rows: readonly InvoiceReportCellRow[];
  readonly total_amount: string;
  readonly client_count: number;
}
```

- [ ] **Step 2: Verify type-check passes**

Run: `cd frontend/task-tracker && npm run type-check 2>&1 | tail -20`

(If `type-check` script doesn't exist, use `npx tsc --noEmit`.)

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/task-tracker/src/types/api/invoice.ts
git commit -m "feat(invoices): types for report client counts + cell drill-down"
```

---

## Task 8: Frontend — `ReportCellModal` component

**Files:**
- Create: `frontend/task-tracker/src/components/invoice/ReportCellModal.tsx`

- [ ] **Step 1: Create the file**

Create `frontend/task-tracker/src/components/invoice/ReportCellModal.tsx` with:

```tsx
import { useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/api";
import { fmtMoney } from "@/utils/money";
import type {
  InvoiceReportCellResponse,
  InvoiceReportGroupBy,
} from "@/types/api";

export interface ReportCellModalProps {
  fy: string;
  groupBy: Exclude<InvoiceReportGroupBy, "client">;
  rowKey: string;
  month: string;
  title: string;
  filterCategories: readonly string[];
  filterOwners: readonly string[];
  filterStatus: "" | "Confirmed" | "Projected";
  onClose: () => void;
}

export default function ReportCellModal({
  fy,
  groupBy,
  rowKey,
  month,
  title,
  filterCategories,
  filterOwners,
  filterStatus,
  onClose,
}: ReportCellModalProps) {
  const [data, setData] = useState<InvoiceReportCellResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams();
      params.set("fy", fy);
      params.set("group_by", groupBy);
      params.set("row_key", rowKey);
      params.set("month", month);
      filterCategories.forEach((c) => params.append("category", c));
      filterOwners.forEach((o) => params.append("owner", o));
      if (filterStatus) params.set("project_status", filterStatus);
      try {
        const res = await apiGet<InvoiceReportCellResponse>(
          `/invoice_reports/cell/?${params.toString()}`,
        );
        if (!cancelled) {
          setData(res);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fy, groupBy, rowKey, month, filterCategories, filterOwners, filterStatus]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Hide the Month column when every row shares the same month (single-month drill).
  const showMonthCol = useMemo(() => {
    if (!data) return false;
    const months = new Set(data.rows.map((r) => r.month));
    return months.size > 1;
  }, [data]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.45)",
        zIndex: 1050,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 12,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="dm-modal-card"
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: 24,
          width: "100%",
          maxWidth: 720,
          maxHeight: "85vh",
          overflowY: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,.18)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 800 }}>{title}</div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: 20,
              cursor: "pointer",
              color: "#64748b",
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {loading && (
          <div style={{ padding: 24, textAlign: "center", color: "#64748b" }}>Loading…</div>
        )}
        {error && (
          <div style={{ padding: 16, color: "#b91c1c", background: "#fef2f2", borderRadius: 8 }}>
            Failed to load: {error}
          </div>
        )}
        {!loading && !error && data && data.rows.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: "#64748b" }}>
            No matching entries.
          </div>
        )}
        {!loading && !error && data && data.rows.length > 0 && (
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f1f5f9" }}>
                <th style={{ padding: 6, textAlign: "left", border: "1px solid #e2e8f0" }}>Client</th>
                <th style={{ padding: 6, textAlign: "left", border: "1px solid #e2e8f0" }}>Category</th>
                {showMonthCol && (
                  <th style={{ padding: 6, textAlign: "left", border: "1px solid #e2e8f0" }}>Month</th>
                )}
                <th style={{ padding: 6, textAlign: "right", border: "1px solid #e2e8f0" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ padding: 6, border: "1px solid #e2e8f0" }}>{r.client}</td>
                  <td style={{ padding: 6, border: "1px solid #e2e8f0" }}>{r.category}</td>
                  {showMonthCol && (
                    <td style={{ padding: 6, border: "1px solid #e2e8f0" }}>{r.month.slice(5)}</td>
                  )}
                  <td style={{ padding: 6, textAlign: "right", border: "1px solid #e2e8f0" }}>
                    {fmtMoney(Number(r.amount))}
                  </td>
                </tr>
              ))}
              <tr style={{ background: "#f8fafc", fontWeight: 700 }}>
                <td colSpan={showMonthCol ? 3 : 2} style={{ padding: 6, border: "1px solid #e2e8f0" }}>
                  Total — {data.client_count} client{data.client_count === 1 ? "" : "s"}
                </td>
                <td style={{ padding: 6, textAlign: "right", border: "1px solid #e2e8f0" }}>
                  {fmtMoney(Number(data.total_amount))}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend/task-tracker && npx tsc --noEmit 2>&1 | tail -20`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/task-tracker/src/components/invoice/ReportCellModal.tsx
git commit -m "feat(invoices): ReportCellModal — drill-down breakdown table"
```

---

## Task 9: Frontend — render counts in `ReportTab` and wire the modal

**Files:**
- Modify: `frontend/task-tracker/src/components/invoice/ReportTab.tsx`

- [ ] **Step 1: Replace the entire file with the updated version**

Replace `frontend/task-tracker/src/components/invoice/ReportTab.tsx` with:

```tsx
import { useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/api";
import { useInvoiceCategories } from "@/hooks/useInvoiceCategories";
import { fmtMoney } from "@/utils/money";
import type { InvoiceReportGroupBy, InvoiceReportResponse } from "@/types/api";
import ReportCellModal from "./ReportCellModal";

interface ReportTabProps {
  fy: string;
}

interface CellModalState {
  rowKey: string;
  month: string;
  title: string;
}

const TOTAL = "__total__";

export default function ReportTab({ fy }: ReportTabProps) {
  const { categories } = useInvoiceCategories();
  const [groupBy, setGroupBy] = useState<InvoiceReportGroupBy>("owner");
  const [filterCategories, setFilterCategories] = useState<string[]>([]);
  const [filterOwners, setFilterOwners] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<"" | "Confirmed" | "Projected">("");
  const [data, setData] = useState<InvoiceReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [owners, setOwners] = useState<{ id: string; label: string }[]>([]);
  const [cellModal, setCellModal] = useState<CellModalState | null>(null);

  useEffect(() => {
    (async () => {
      interface ProfileItem { uid: string; full_name?: string; username?: string; is_active?: boolean }
      const profiles = await apiGet<ProfileItem[]>("/profiles/");
      setOwners(
        profiles.filter((p) => p.is_active !== false).map((p) => ({
          id: p.uid,
          label: p.full_name || p.username || p.uid,
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

  const months = useMemo(() => {
    if (!data) return [];
    return Object.keys(data.totals).filter(
      (k) => k !== "total" && k !== "monthly_clients" && k !== "total_clients",
    );
  }, [data]);

  const showCounts = groupBy !== "client";

  const downloadCsv = () => {
    if (!data) return;
    const header = ["Group", ...months, "Total"];
    const rows = data.rows.map((r) => [r.label, ...months.map((m) => r.monthly[m] ?? "0"), r.total]);
    rows.push([
      "TOTAL",
      ...months.map((m) => (data.totals[m] as string) ?? "0"),
      (data.totals.total as string) ?? "0",
    ]);
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

  const openCell = (rowKey: string, rowLabel: string, month: string) => {
    if (!showCounts) return;
    const monthLabel = month === TOTAL ? `FY ${fy} total` : month;
    const rowLbl = rowKey === TOTAL ? "All groups" : rowLabel;
    setCellModal({ rowKey, month, title: `${rowLbl} — ${monthLabel}` });
  };

  const renderCell = (
    amount: number,
    count: number | undefined,
    rowKey: string,
    rowLabel: string,
    month: string,
    style: React.CSSProperties,
  ) => {
    const display = (
      <>
        {fmtMoney(amount)}
        {showCounts && count !== undefined && count > 0 && (
          <sup style={{ marginLeft: 3, fontSize: 9, color: "#2563eb", fontWeight: 700 }}>
            {count}
          </sup>
        )}
      </>
    );
    if (!showCounts || amount === 0) {
      return <td style={style}>{display}</td>;
    }
    return (
      <td style={{ ...style, padding: 0 }}>
        <button
          type="button"
          onClick={() => openCell(rowKey, rowLabel, month)}
          style={{
            width: "100%",
            height: "100%",
            padding: 6,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "#2563eb",
            textDecoration: "underline",
            textDecorationStyle: "dotted",
            textAlign: "right",
            font: "inherit",
          }}
        >
          {display}
        </button>
      </td>
    );
  };

  const totalsMonthlyClients = (data?.totals?.monthly_clients ?? {}) as Record<string, number>;
  const totalsTotalClients = (data?.totals?.total_clients as number | undefined) ?? undefined;

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
                  {months.map((m) =>
                    renderCell(
                      Number(r.monthly[m] || 0),
                      r.monthly_clients?.[m],
                      r.key,
                      r.label,
                      m,
                      { padding: 6, textAlign: "right", border: "1px solid #e2e8f0" },
                    ),
                  )}
                  {renderCell(
                    Number(r.total),
                    r.total_clients,
                    r.key,
                    r.label,
                    TOTAL,
                    { padding: 6, textAlign: "right", border: "1px solid #e2e8f0", fontWeight: 700 },
                  )}
                </tr>
              ))}
              <tr style={{ background: "#f8fafc", fontWeight: 700 }}>
                <td style={{ padding: 6, border: "1px solid #e2e8f0" }}>TOTAL</td>
                {months.map((m) =>
                  renderCell(
                    Number((data.totals[m] as string) || 0),
                    totalsMonthlyClients[m],
                    TOTAL,
                    "All groups",
                    m,
                    { padding: 6, textAlign: "right", border: "1px solid #e2e8f0" },
                  ),
                )}
                {renderCell(
                  Number((data.totals.total as string) || 0),
                  totalsTotalClients,
                  TOTAL,
                  "All groups",
                  TOTAL,
                  { padding: 6, textAlign: "right", border: "1px solid #e2e8f0" },
                )}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {cellModal && showCounts && (
        <ReportCellModal
          fy={fy}
          groupBy={groupBy as Exclude<InvoiceReportGroupBy, "client">}
          rowKey={cellModal.rowKey}
          month={cellModal.month}
          title={cellModal.title}
          filterCategories={filterCategories}
          filterOwners={filterOwners}
          filterStatus={filterStatus}
          onClose={() => setCellModal(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend/task-tracker && npx tsc --noEmit 2>&1 | tail -20`

Expected: no errors.

- [ ] **Step 3: Run frontend lint**

Run: `cd frontend/task-tracker && npm run lint 2>&1 | tail -30`

Expected: no errors related to the changed files. Fix any that appear.

- [ ] **Step 4: Commit**

```bash
git add frontend/task-tracker/src/components/invoice/ReportTab.tsx
git commit -m "feat(invoices): superscript client count + click-to-drill on report cells"
```

---

## Task 10: Manual smoke test

- [ ] **Step 1: Start the dev environment**

Backend: `python manage.py runserver`
Frontend: `cd frontend/task-tracker && npm run dev`

- [ ] **Step 2: Smoke checks**

Open the app → Invoice Tracker → Report tab. Verify:

1. **Owner mode (default):** every value cell shows a tiny blue superscript count. Cells are underlined-on-hover and clickable.
2. **Click an inner cell** (e.g. Akilan × 04): modal opens with title "Akilan — 2026-04", body shows Client | Category | Amount rows (no Month column). Sum of amounts == cell amount.
3. **Click a Total column cell** (e.g. Akilan × Total): modal opens with title "Akilan — FY YYYY-YY total"; the table includes a Month column.
4. **Click TOTAL row × specific month**: modal opens with title "All groups — 2026-04"; Month column hidden.
5. **Click grand-total cell**: title "All groups — FY YYYY-YY total"; Month column shown.
6. **Switch group_by → Category**: counts and clicks behave the same.
7. **Switch group_by → Month**: same.
8. **Switch group_by → Client**: counts disappear; cells are not clickable. (Existing behaviour preserved.)
9. **CSV export**: download a CSV; confirm the file has only Amount columns (no count column) — same shape as before.
10. **Esc / overlay / X** all close the modal.

- [ ] **Step 3: Final full backend test run**

Run: `python -m pytest core/invoices/tests.py -v`

Expected: all tests PASS.

- [ ] **Step 4: Push the branch**

```bash
git push origin Invoice_count
```

---

## Summary of commits this plan produces

1. `test(invoices): owner-mode report returns per-cell client counts`
2. `feat(invoices): report endpoint returns per-cell distinct-client counts`
3. `test(invoices): client counts in category/month modes; client mode omits`
4. `test(invoices): drill-down cell endpoint — owner inner-cell happy path`
5. `feat(invoices): drill-down cell endpoint for report tab`
6. `test(invoices): cell endpoint covers category/month modes, totals, filters`
7. `feat(invoices): types for report client counts + cell drill-down`
8. `feat(invoices): ReportCellModal — drill-down breakdown table`
9. `feat(invoices): superscript client count + click-to-drill on report cells`
