# Budget vs Actual (Phase 1) — design

Date: 2026-07-06

## Summary

Phase 1 of a "Budget vs Actual" module: manual monthly Budget and Actual
entry per client per financial year, with a report table showing Budget,
Actual, Variance, Variance %, and Status per month plus grand totals.

This is explicitly scoped down from the original request. Later phases
(not designed here) would add: KPI dashboard cards, charts (monthly
trend, client-wise performance), Excel/PDF/CSV export, a formal audit
trail, and a multi-stage approval workflow. Two things from the original
ask don't apply at all, per explicit clarification: there is no
"underlying transactions" drill-down and no auto-update from an approved-
transactions feed — both Budget and Actual are manually entered numbers,
not aggregated from another system.

## 1. Data model

One new model, `BudgetLineItem`, in a new Django app `core/budget`
(mirrors the `core/costing` app's structure):

| field | type | notes |
|---|---|---|
| `uid` | UUID | standard external id |
| `org` | FK `users.Org` | tenant scope |
| `client` | FK `masters.Master` (`type="client"`) | which client this line belongs to |
| `financial_year` | Integer | calendar year, e.g. `2026` (validated ~2000–2100) |
| `month` | Integer (1–12) | January–December |
| `line_type` | Choice: `"budget"` \| `"actual"` | which list this item belongs to |
| `description` | CharField | short label, e.g. "Retainer fee" |
| `amount` | Decimal | non-negative; validated at the API layer |
| `created_by`, timestamps | | standard audit fields |

A month's **Budget total** = sum of that month's `line_type="budget"`
items; **Actual total** = sum of `line_type="actual"` items computed
client-side from the fetched line items for the selected client + year
(no separate report endpoint — see section 3).

- Variance = Actual − Budget.
- Variance % = Variance / Budget × 100 (0 if Budget is 0).
- Status: **On Budget** if Actual is within ±5% of Budget, **Over
  Budget** if Actual > Budget × 1.05, **Under Budget** if
  Actual < Budget × 0.95.

Budget items and Actual items are two independent lists per month —
each has its own "Add" flow; a Budget item is never converted into or
paired with a specific Actual item.

## 2. Permissions & navigation

- Add `budget_access` to `ACCESS_FEATURES` in `users/models.py` —
  mirrors `costing_access` exactly: its own `_granted_by`/`_granted_at`
  audit pair on `OrgMembership`, granted per-user via the User Rights
  matrix.
- Add `MenuNode("budget", "Budget vs Actual", None)` to `MENU_CATALOG`
  in `users/menu_catalog.py`, placed directly after
  `MenuNode("costing", "Costing", None)`.
- New permission class `IsAdminOrBudgetAccess` in `core/permissions.py`,
  mirroring `IsAdminOrCostingAccess`: any authenticated org member can
  read (`SAFE_METHODS`); writes require admin or the `budget_access`
  grant.
- Nav wiring: `App.tsx` lazy-imports `BudgetVsActualPage`, adds
  `"budget"` to the `navVisible` code list right after `"costing"`;
  `NavMenu.tsx`'s `NAV_TABS_RAW` gets a `budget` entry right after the
  `costing` entry; `Header.tsx`'s `icons` map gets a new icon for
  `budget`.

## 3. Backend API

New Django app `core/budget`, structured like `core/costing`:

- **Model**: `BudgetLineItem` (section 1), own migration.
- **Serializer** `BudgetLineItemSerializer` — `org`/`client` as
  `SlugRelatedField(slug_field="uid", ...)`, `client_detail` nested via
  the existing `MasterMinSerializer`; `line_type`, `description`,
  `amount`, `financial_year`, `month` read-write; `uid`, timestamps,
  `created_by_uid` read-only.
- **Viewset** `BudgetLineItemViewSet` — `UidLookupMixin` + `ModelViewSet`,
  `permission_classes = [IsAuthenticated, IsAdminOrBudgetAccess]`,
  `get_queryset` uses `scoped()` and filters by required
  `?client=<uid>&financial_year=<int>` query params. `perform_create`
  uses `resolve_create_org`; every mutation broadcasts via
  `core.realtime.broadcast("budget-line-items", ...)`.
- **URLs**: router registers `"budget_line_items"` at
  `/api/budget_line_items/`.
- No separate report/aggregation endpoint — the frontend fetches the
  full line-item list for a client + year (typically at most a few
  hundred rows) and computes monthly sums, variance, and status
  client-side, the same way Costing computes its `total` preview
  client-side. This avoids a second endpoint to keep in sync with the
  raw data.

## 4. Frontend UI

New page `BudgetVsActualPage.tsx` (top-level view, same prop shape as
`CostingPage`: `{ profile, selectedOrg }`), plus the standard trio:
`types/api/budget.ts`, `lib/api/budget.ts`, `hooks/useBudget.ts`
(mirroring `useCosting`'s shape — `{entries, loading, saving,
createEntry, editEntry, removeEntry}` — keyed by `client +
financial_year` instead of just `client`).

**Layout:**
- Top filter bar: **Financial Year** selector (dropdown of recent years,
  e.g. current year ± 2) and **Client** dropdown (reusing
  `useMasters().clients`, same as Costing).
- Above the table, a slim summary strip: Total Budget, Total Actual,
  Remaining Budget (Total Budget − Total Actual), Total Variance, Budget
  Utilization % (Total Actual / Total Budget × 100) — plain text/number
  strip for Phase 1, not the full KPI-card dashboard from the original
  ask (deferred to a later phase).
- A **report table**, one row per month (Jan–Dec) plus a **Grand Total**
  row: columns Month, Budget, Actual, Variance, Variance %, Status
  (colored badge: red = Over Budget, amber = Under Budget, green = On
  Budget).
- Clicking a month row expands it in place (no modal) to show two
  side-by-side lists — **Budget items** and **Actual items** — each with
  its own "+ Add" button and per-item Edit/Delete. Add/Edit opens a
  small modal: description + amount, mirroring Costing's inline-modal
  pattern.

## 5. Validation & error handling

- `amount` must be non-negative; reject with 400 otherwise (matches
  Costing's `hr_day`/`days_working` validation).
- `financial_year` must be a plausible year (2000–2100) and `month`
  must be 1–12 — enforced via model validators / DRF field validation.
- Line items are scoped to the caller's org(s) via `scoped()` — a user
  cannot see/edit another org's rows (matches Costing).
- Deleting a `Master` client referenced by existing `BudgetLineItem`
  rows: FK is `SET_NULL` (matches the pattern used everywhere else —
  Costing, `ClientRoadmap`, etc.).

## 6. Testing

- Backend: model test for `line_type` choices, `BudgetLineItemViewSet`
  CRUD + org-scoping tests, permission test (403 without
  `budget_access`), a test confirming the required `client` +
  `financial_year` query params filter correctly.
- Frontend: `useBudget` hook test (load/create/edit/remove), a unit
  test for the monthly-sum/variance/status computation function (the
  one piece of real logic beyond straight CRUD), extending the existing
  test conventions used for Costing.

## Out of scope (deferred to later phases)

- KPI dashboard cards (Total Budget, Total Actual, Remaining Budget,
  Total Variance, Budget Utilization) as a dedicated visual dashboard —
  Phase 1 only has the plain summary strip.
- Charts (monthly Budget vs Actual trend, client-wise budget
  performance).
- Filtering by Project, Department, Category, or month range — Phase 1
  filters are Financial Year + Client only. "Project" doesn't exist as
  a concept anywhere in the app yet; "Department" is currently
  free-text on individual employees, not attached to a client or
  budget.
- Export to Excel, PDF, or CSV.
- A formal, generic audit trail for budget changes.
- A multi-stage approval workflow (draft → submit → approve) for
  budgets — Phase 1's `budget_access` permission gates create/edit
  only; there is no separate "approve" step.
- Drill-down from an Actual value to underlying transactions — there is
  no transaction source; Actual is manually entered, not aggregated.
- Auto-updating Actual values when new approved transactions post — not
  applicable, since there is no transaction feed in Phase 1.
