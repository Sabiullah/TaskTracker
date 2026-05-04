# Invoice Report — per-cell client count + drill-down

## Problem

The Invoice Tracker → Report tab currently shows a pivot of money totals
(rows = group, columns = month) but gives no sense of *how many distinct
projects* contributed to each cell. To answer "how many clients did Akilan
bill in April?" the user has to switch tabs and filter manually.

## Goals

1. Show, inside every value cell, a small superscript count of **distinct
   clients** that contributed to that cell.
2. Make every value cell clickable. Clicking opens a modal with a
   **Client | Category | Month | Amount** breakdown of the entries that
   produced the cell amount.

## Non-goals

- No change when `Group by = Client` — the per-cell client count is
  always 1 in that mode and adds noise.
- No change to CSV export — it stays amounts-only as today.
- No change to the Schedule, Summary, or Invoices tabs.

## Scope

Applies to `Group by ∈ {Owner, Category, Month}`.

Cells affected: every numeric cell, including the Total column, the TOTAL
row, and the grand-total cell.

## UX

### Cell rendering

Each non-zero amount cell renders as:

```
₹4,36,750 ⁵
```

- Amount unchanged.
- Superscript number = distinct client count for the cell.
- Zero-amount cells render `—` with no count (or `₹0` plus no count —
  follow whatever the existing component does today).
- Cell becomes a `<button>` styled as a link: same colour as today, with
  underline on hover and `cursor: pointer`. Keyboard-focusable, opens
  the modal on Enter / Space.

### Drill-down modal

Triggered by clicking any value cell (including totals).

**Header:**
- Title contextual to which cell was clicked. Examples:
  - Inner cell: *"Akilan — April 2026"*
  - Row total: *"Akilan — FY 2026-27 total"*
  - Column total: *"All owners — April 2026"*
  - Grand total: *"All owners — FY 2026-27 total"*
- Subline: filters in effect (status / categories / owners) so the user
  knows the modal honours the same filters as the grid.

**Body:** flat table with columns:

| Client | Category | Month | Amount |
|--------|----------|-------|--------|

- Sorted by Client (asc) → Category (asc) → Month (asc).
- Each row's amount = `entry.amount × owner_share × category_share`
  (proportional shares applied where the current `group_by` and the row
  attribution call for them — see Amount semantics below).
- Sum of `Amount` column equals the clicked cell's amount.
- Edge cases:
  - Entry with no client → label `(no client)`.
  - Entry with no category attribution → category column shows
    `(uncategorized)`.
  - Owner mode, entry with no owner attribution → only appears when
    drilling the **Unattributed** row.
- The **Month** column is hidden when the drill-down covers a single
  month (i.e. the user clicked an inner cell or a column-total cell).
  It is shown when the drill-down spans multiple months (Total column,
  TOTAL row's grand-total cell).

**Footer:**
- Total amount.
- Total distinct clients.

**Dismiss:** Esc, overlay click, or `X` button.

### Amount semantics in drill-down

For each entry that contributes to the clicked cell, the modal lists one
row per `(category, month)` combination — i.e. one row per
`InvoiceEntryCategory` link of that entry, in that month. Amount of that
row is computed as:

- `Group by = Owner`: one drill-down row per
  `(client, category_link, month)` of every contributing entry, with
  amount =
  `entry.amount × owner_link.contribution_pct/100 × category_link.contribution_pct/100`.
  When the entry has no category links, a single row with
  `category = (uncategorized)` and amount =
  `entry.amount × owner_link.contribution_pct/100`.
- `Group by = Category`: drill-down is restricted to the clicked
  category. One row per `(client, month)`, with amount =
  `entry.amount × category_link.contribution_pct/100` for that one
  category link. The `Category` column shows the same category name on
  every row (redundant but kept for shape consistency).
- `Group by = Month`: one drill-down row per `(client, category_link)`
  of every entry whose `invoice_month` falls in scope. Amount =
  `entry.amount × category_link.contribution_pct/100`. When no category
  links, one row with `(uncategorized)` and amount = `entry.amount`.

The total of the displayed `Amount` column always equals the clicked
cell's amount, by construction.

If an entry has no category links, it surfaces as a single row with
`Category = (uncategorized)` and amount = the appropriate share with no
category multiplier.

### Count semantics

- Inner cell `(row, month)`: number of distinct `client_id`s on entries
  that contribute to that cell.
- Row total: distinct `client_id`s for that row across the FY (NOT the
  sum of monthly counts — same client in two months counts once).
- Column total (TOTAL row, single month): distinct `client_id`s across
  all rows in that month.
- Grand total: distinct `client_id`s across the whole grid.

Entries with no client are excluded from the count (they still contribute
amount, but `(no client)` is not a client).

## Architecture

### Backend

**File:** `core/invoices/views.py`

#### 1. Augment `InvoiceReportView` response

Per-row shape gains:

```json
{
  "key": "...",
  "label": "...",
  "monthly": {"2026-04": "1000", ...},
  "monthly_clients": {"2026-04": 5, ...},
  "total": "12345",
  "total_clients": 17
}
```

Top-level `totals` shape gains:

```json
{
  "totals": {
    "2026-04": "1000", ..., "total": "12345",
    "monthly_clients": {"2026-04": 9, ...},
    "total_clients": 30
  }
}
```

Implementation:
- During the existing accumulation loop, also track sets of
  `client_id` per `(row_key, month)`, per row, per month, and a single
  set for the grand total.
- After the loop, convert sets → counts.
- `Group by = Client`: skip count fields entirely (no behaviour change,
  no count shown on the front-end either).

#### 2. New endpoint `InvoiceReportCellView`

`GET /invoice_reports/cell/`

Query params:
- `fy` (required) — same format as `/invoice_reports/`.
- `group_by` (required) — `owner | category | month`.
- `row_key` (required) — uid of the row, or sentinel `__total__` for
  the TOTAL row / grand-total drill.
- `month` (required) — `YYYY-MM` or sentinel `__total__` for the
  Total column / grand-total drill.
- `category` / `owner` / `project_status` — same filter semantics as the
  main report endpoint.

Behaviour:
- Filter the entry queryset using the same scoping + filter logic as
  `InvoiceReportView`.
- Restrict by `month` (skip when `__total__`).
- Restrict to the row identified by `row_key` (skip when `__total__`):
  - `group_by = owner` → entries owned by that user.
  - `group_by = category` → entries with that category link.
  - `group_by = month` → entries whose `invoice_month` matches `row_key`.
- For each surviving entry, enumerate its category links; emit one
  output row per `(client, category, invoice_month)` with the amount
  computed per the rules above.
- Sort by client name, then category name, then month.

Response:

```json
{
  "rows": [
    {"client": "Acme", "category": "Accounting", "month": "2026-04", "amount": "5000"},
    ...
  ],
  "total_amount": "12345",
  "client_count": 4
}
```

URL wiring: `core/invoices/urls.py` adds the new view; route name
`invoice_report_cell`.

### Frontend

**Files:**
- `frontend/task-tracker/src/components/invoice/ReportTab.tsx` — augment
  rendering, hook up cell click, fetch new fields.
- `frontend/task-tracker/src/components/invoice/ReportCellModal.tsx`
  (new) — modal component.
- `frontend/task-tracker/src/types/api/invoice.ts` — extend
  `InvoiceReportRow` / `InvoiceReportResponse`; add new
  `InvoiceReportCellResponse` type.

**Type changes (`invoice.ts`):**

```ts
export interface InvoiceReportRow {
  readonly key: string;
  readonly label: string;
  readonly monthly: Readonly<Record<string, string>>;
  readonly monthly_clients?: Readonly<Record<string, number>>;
  readonly total: string;
  readonly total_clients?: number;
}

export interface InvoiceReportResponse {
  readonly fy: string;
  readonly group_by: InvoiceReportGroupBy;
  readonly rows: readonly InvoiceReportRow[];
  readonly totals: Readonly<Record<string, string>> & {
    readonly monthly_clients?: Readonly<Record<string, number>>;
    readonly total_clients?: number;
  };
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

Counts are optional in the type so Client mode (which omits them) still
type-checks.

**`ReportTab.tsx` changes:**
- New cell-render helper renders amount + superscript count if
  `groupBy !== "client"`.
- Cells become `<button>` elements (styled to look like the current
  `<td>` content). Click handler captures the cell's coordinates
  (`row_key`, `month`) and opens the modal.
- New state `cellModal: { rowKey, month, title } | null`.
- TOTAL row & Total column cells use sentinel `__total__` for whichever
  axis is the total.

**`ReportCellModal.tsx`:**
- Props: `fy`, `groupBy`, `rowKey`, `month`, `title`, filter params,
  `onClose`.
- Fetches `/invoice_reports/cell/?...` on mount.
- Renders a fixed-overlay modal with the table described above.
- Uses existing app modal patterns (look at `PlanModal` or the
  cell-modal in Schedule tab for the visual baseline).

### Tests

**`core/invoices/tests.py`** — extend with:

1. `InvoiceReportView` returns correct `monthly_clients` /
   `total_clients` per row and totals — including the dedup case where
   the same client appears in multiple months / multiple categories /
   multiple owners.
2. `Group by = client` response excludes count fields.
3. `InvoiceReportCellView` happy paths for owner / category / month
   modes with both inner-cell and total-row / total-col / grand-total
   drilldowns.
4. `InvoiceReportCellView` honours `category`, `owner`, `project_status`
   filters identically to the main report.
5. Sum of `amount` across drill-down rows equals the corresponding cell
   amount in the main report.
6. Edge cases: entry with no client → `(no client)`; entry with no
   category links → `(uncategorized)`; owner-mode unattributed-row
   drill includes entries with no owner links.

## Migration

None — purely additive. Existing fields preserved; new fields are
optional in TS types so Client mode (which doesn't return them) still
fits. No DB schema changes.

## Open questions

None outstanding — both ambiguities (CSV inclusion, total-column
granularity) confirmed by the user before this spec was written.
