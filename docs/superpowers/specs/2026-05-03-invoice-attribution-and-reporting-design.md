# Invoice Schedule — Attribution & Reporting

**Date:** 2026-05-03
**Module:** `core/invoices/` + `frontend/task-tracker/src/components/invoice/`
**Status:** Draft

## Summary

Add Project Status, Invoice Categories, and Owners (with contribution %) to the Invoice Schedule, and surface a new Report tab that aggregates attributed value by category / owner / status across the financial year.

## Goals

- Capture **Project Status** (`Confirmed` / `Projected`) per plan and per entry so leadership can separate committed revenue from pipeline.
- Capture **Categories** and **Owners** (multiple, each with a contribution %) per plan and per entry so attributed value can be rolled up by service line and by employee.
- Provide a filterable, exportable **Report tab** in the Invoice module that pivots attributed value by Owner / Category / Month / Client.
- Preserve all existing entries, files, and amounts. Migration is purely additive.

## Non-Goals

- Bulk-edit of attribution across many entries at once (only the existing per-cell *this month / onwards / all pending* scope toggle).
- Per-month override of attribution at plan level (defaults are flat; per-entry editing is the escape hatch).
- Cross-org attribution (categories and owners are scoped to the plan's org).
- Any change to upload / approve / reject flows.

## Data Model

All changes in `core/invoices/models.py`.

### New: `InvoiceCategory`

Org-scoped master table for invoice categories, owned by the Invoice module (separate from `core.masters.Master` so its lifecycle is independent).

| Field          | Type                                                 |
| -------------- | ---------------------------------------------------- |
| `id`           | implicit PK                                          |
| `uid`          | UUID, unique, indexed                                |
| `name`         | CharField(255)                                       |
| `org`          | FK → `users.Org`, on_delete=PROTECT                  |
| `color`        | CharField(20), blank, default `""`                   |
| `is_active`    | BooleanField, default `True`, indexed                |
| `sort_order`   | IntegerField, default `0`                            |
| `created_by`   | FK → AUTH_USER_MODEL, null/blank, on_delete=SET_NULL |
| `created_at` / `updated_at` | from `TimeStampedModel`                |

Constraints: `unique_together = ("org", "name")`. Ordering: `("sort_order", "name")`.

### Modified: `InvoicePlan`

Adds:

```python
PROJECT_STATUS_CHOICES = [("Confirmed", "Confirmed"), ("Projected", "Projected")]
project_status = models.CharField(max_length=20, choices=PROJECT_STATUS_CHOICES, default="Projected", db_index=True)
default_categories = models.ManyToManyField(InvoiceCategory, through="InvoicePlanCategory", related_name="default_for_plans")
default_owners = models.ManyToManyField(settings.AUTH_USER_MODEL, through="InvoicePlanOwner", related_name="default_for_invoice_plans")
```

### Modified: `InvoiceEntry`

Adds:

```python
project_status = models.CharField(max_length=20, choices=PROJECT_STATUS_CHOICES, default="Projected", db_index=True)
categories = models.ManyToManyField(InvoiceCategory, through="InvoiceEntryCategory", related_name="entries")
owners = models.ManyToManyField(settings.AUTH_USER_MODEL, through="InvoiceEntryOwner", related_name="invoice_entries")
```

### New: through tables

Four through tables follow the same shape:

```python
class InvoicePlanCategory(models.Model):
    plan = models.ForeignKey(InvoicePlan, on_delete=models.CASCADE, related_name="category_links")
    category = models.ForeignKey(InvoiceCategory, on_delete=models.PROTECT)
    contribution_pct = models.DecimalField(max_digits=5, decimal_places=2, validators=[MinValueValidator(0), MaxValueValidator(100)])

    class Meta:
        unique_together = ("plan", "category")
```

`InvoicePlanOwner`, `InvoiceEntryCategory`, `InvoiceEntryOwner` follow the same pattern (FK to user/category, FK to plan/entry, `contribution_pct`, unique pair).

`on_delete=PROTECT` on the category and user FKs in the through tables — historical attribution must not silently zero out if a category or user is removed. Deactivate, don't delete.

### Validation

Implemented in serializers (DRF `validate()`) — easier to surface field-level errors than `Model.clean()` for M2M data. Backed by a server-side check in the through-table save flow as a defence-in-depth.

For each of the four lists (plan default categories, plan default owners, entry categories, entry owners):

1. Empty list is allowed → entry counts as **Unattributed** for that dimension in reports.
2. If non-empty, `Σ contribution_pct == 100.00` (decimal equality, not float).
3. Each category / user appears at most once.
4. Each `contribution_pct` is in `[0.01, 100.00]` (no zero-share rows).

## Generation Flow

`InvoiceEntryViewSet.generate` (in `core/invoices/views.py`) currently creates entries with `amount = plan.base_amount` and `status = "Pending"`. After this spec:

1. Existing prune logic (delete `Pending` entries outside plan range) — **unchanged**.
2. For each newly-created `InvoiceEntry`, in the same transaction:
   - Set `project_status = plan.project_status`.
   - Copy `plan.category_links` rows → `InvoiceEntryCategory` rows on the new entry (same category, same %).
   - Copy `plan.owner_links` rows → `InvoiceEntryOwner` rows on the new entry.
3. Existing entries are **not** retro-updated when plan defaults change. Same model as `base_amount` today.

## API

### New endpoints

`GET / POST / PATCH / DELETE /api/invoice_categories/`
- Standard `ModelViewSet`, lookup by `uid`.
- Org-scoped via `scoped()` helper.
- Write operations gated by `IsAdmin` (consistent with other Masters CRUD).
- Broadcasts on `invoice-categories` channel for realtime sync.

`GET /api/invoice_reports/`

Query params:
- `fy` — financial year string, e.g. `2026-27` (required).
- `category` — repeatable, category UID (multi-select).
- `owner` — repeatable, user UID (multi-select).
- `project_status` — `Confirmed` / `Projected` / omit = both.
- `group_by` — `owner` / `category` / `month` / `client` (required).

Response:
```json
{
  "fy": "2026-27",
  "group_by": "owner",
  "rows": [
    {
      "key": "<uid-or-Unattributed>",
      "label": "Sabiullah N",
      "monthly": { "2026-04": 12000.00, "2026-05": 12000.00, ... },
      "total": 144000.00
    }
  ],
  "totals": { "2026-04": ..., "total": ... }
}
```

Server-side aggregation; the browser does not loop over hundreds of entries.

### Modified endpoints

`GET /api/invoice_entries/` — adds `?project_status=Confirmed|Projected` query param. The existing `?status=` param keeps its current meaning (`Pending` / `Uploaded` / `Approved` / `Rejected`). Names are intentionally distinct.

### Serializer changes

- `InvoicePlanSerializer`: new write fields `project_status`, `default_categories` (list of `{category_uid, contribution_pct}`), `default_owners` (list of `{user_uid, contribution_pct}`); read-side mirrors with nested category/user details for the modal. `validate()` enforces the rules in §Validation above.
- `InvoiceEntrySerializer`: same shape for `project_status`, `categories`, `owners`.
- `InvoiceCategorySerializer`: standard fields, `MasterMinSerializer`-shaped output for embedding in the entry/plan responses.

## Reporting Math

For a single entry, attributed value to dimension value `D`:

```
attributed(entry, D) = entry.amount × (entry.contribution_pct_for[D] / 100)
```

Pivot aggregation in the `invoice_reports` endpoint:

1. Filter entries by FY months, `project_status` (if set), and `category` / `owner` UIDs (if set).
2. For each matching entry, expand into one row per (entry × group-by-dimension value), each carrying its attributed share.
3. Sum by `(group_by_value, month)`.

### Reconciliation guarantee

Sum of attributed values across all rows (including the `Unattributed` row) for any single dimension equals the sum of `entry.amount` over the same filter. This holds because contribution %s sum to exactly 100 per entry (or the entry is in `Unattributed` and contributes 100% there).

### Filter semantics

- **AND across dimensions:** if both `category` and `owner` filters are set, an entry must have at least one matching category **and** at least one matching owner to appear.
- **OR within a dimension:** multiple selected categories means "any of these".
- The attributed value uses the entry's full % map — selecting `Audit` in the filter doesn't drop the 40% share that went to `Tax` on the same entry. The `Audit` row still shows its 60% share.

### Edge cases

- `entry.amount IS NULL` → contributes 0 to all dimensions (existing entries can have null amount until first edit).
- `entry.status = Rejected` → still appears unless filtered out (rejection is about the document, not the projection).
- Entry with no categories → contributes 100% of `amount` to a synthetic `Unattributed` row when grouping by category. Same for owners.

## UX

### Plan modal (`PlanModal.tsx`)

Add four inputs to the existing form:

- **Project Status** — dropdown: `Confirmed` / `Projected`. Default `Projected`.
- **Categories** — chip-input. Type-ahead from `/api/invoice_categories/` (org-scoped). Each chip displays `Name : 60%`. Inline balance indicator: green `✓ 100%` at exactly 100, red `✗ 85% — must equal 100%` otherwise. Empty list shows muted `No categories — entries will be Unattributed`.
- **Owners** — same chip-input, sourced from the existing `/api/users/` endpoint with a client-side filter to active users who are members of the plan's selected org. No new backend endpoint needed.

Save blocked unless both lists are either empty or sum to 100. Help text under the section: *"Defaults — applied to new entries when generated. Per-entry overrides available from the schedule grid."*

### Schedule tab (`ScheduleTab.tsx`)

Filter bar above the grid:

- **Categories** multi-select (chip-style)
- **Owners** multi-select
- **Project Status** segmented control: `All` / `Confirmed` / `Projected` (default `All`)

Filters reduce visible rows. The cell totals (header strip, FY total) reflect attributed values for the active filter — not raw amounts — so filtering by `Owner = X` shows X's share, not the full invoice value.

Inline badges in each plan row:
- "Cat" badges: small chips next to the job description showing categories. >2 items collapse to `Audit, Tax +1`.
- "Owner" badges: same treatment with user initials.

### Cell-edit modal (extend `AmountEditModal.tsx`)

Add a collapsible **Attribution** section to the existing modal:

- **Project Status** dropdown
- **Categories** chip-input (same widget as PlanModal)
- **Owners** chip-input
- The existing scope toggle (`this month` / `onwards` / `all pending`) applies to attribution edits as well.

Single click on a cell still surfaces everything (amount + attribution) in one modal — no second click needed.

### New "Report" sub-tab

4th tab in the Invoice module, between `Invoices` and (if present) the end of the bar.

- **Top filters:** FY (existing global), Category (multi), Owner (multi), Status (`Both` default / `Confirmed` / `Projected`), Group-by (`Owner` / `Category` / `Month` / `Client`).
- **Body:** pivot table from the `invoice_reports` endpoint:
  - Rows = chosen group-by dimension (with `Unattributed` row when applicable).
  - Columns = months of the FY + `Total`.
  - Footer = column totals.
- **Export:** "Download CSV" button — assembles client-side from the response payload (no separate endpoint).
- **Empty state:** when no entries match, show a friendly message + suggestion to widen filters.

### New "Invoice Categories" admin section

Either:
- A new sub-section in the existing Masters page, or
- A small modal accessed from the Plan modal's Categories chip-input ("+ Add new category…")

Recommendation: both. Inline add for speed, full CRUD in Masters for cleanup.

## Migration & Rollout

Migration files in `core/invoices/migrations/` (sequential after the existing `0003_sync_invoice_numbers.py`):

1. `0004_invoicecategory.py` — create `InvoiceCategory` table.
2. `0005_project_status.py` — add `project_status` column to `InvoicePlan` and `InvoiceEntry`. NOT NULL with default `"Projected"`. The default fills in for all existing rows; no separate data migration needed.
3. `0006_attribution_through_tables.py` — create `InvoicePlanCategory`, `InvoicePlanOwner`, `InvoiceEntryCategory`, `InvoiceEntryOwner`.

### Preservation guarantees

- Migration is purely additive. No `DELETE`, `DROP COLUMN`, or `ALTER` that rewrites existing rows.
- Existing `InvoiceEntry` rows are untouched. They get `project_status='Projected'` by default and an empty categories/owners list. `amount`, `status`, `invoice_number`, `file`, `uploaded_by`, `approved_by`, `rejection_reason` — all preserved.
- Existing uploaded files (`InvoiceEntry.file`) are not touched. The `generate` action's prune step is unchanged.
- Existing `InvoicePlan` rows get `project_status='Projected'` and empty default categories/owners.

### Backwards compatibility

- API clients that don't send the new fields keep working — fields are optional on write.
- `?status=` query param on `InvoiceEntry` keeps its meaning. New `?project_status=` is additive.
- `generate` response shape unchanged at the top level; new fields appear inside `entries[]`.

### Permissions

- Invoice Categories CRUD: `IsAdmin` (matches Masters CRUD).
- Setting / editing categories & owners on plans/entries: `IsAdmin` (same gate as `generate` / `approve` / `reject`).
- Reading the Report tab: any authenticated user in the org.

## Tests

`core/invoices/tests.py` additions:

- **Model:** contribution % must sum to 100 (or be empty); duplicate category/user rejected; deletion of category/user is blocked while in use (PROTECT).
- **Generation:** `generate` copies plan defaults to new entries (project_status, categories, owners with %s). Existing entries are not retro-updated when plan defaults change.
- **Report API:**
  - Sums match `Σ entry.amount` for an "all" filter (reconciliation).
  - `Unattributed` bucket appears when entries have empty category/owner lists.
  - AND-across / OR-within filter semantics.
  - `project_status` filter behaves correctly with `Both` / `Confirmed` / `Projected`.
- **Frontend (vitest):** chip-input balance indicator turns green at 100, red elsewhere; Save button disabled when invalid.

## Open Questions

None at design time — all five clarifying questions answered upstream. Re-open if anything surfaces during implementation.
