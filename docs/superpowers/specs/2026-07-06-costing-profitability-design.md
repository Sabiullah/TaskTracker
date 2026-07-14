# Costing — Seat Cost & Profitability — design

Date: 2026-07-06

## Summary

Extend Costing into a tabbed section: the existing Costing table stays as
the first tab, unchanged. Three new admin-only tabs are added: **Seat
Cost** (an org-wide monthly office-overhead default), **Employee Seat
Cost** (per-employee overrides), and **Profitability** — a per-employee
comparison of client-billed value (from Costing) against what that
employee costs the org (salary + seat cost), surfacing who is
profitable, break-even, or a loss.

## 1. Data model

Two new models in `core/costing`, alongside the existing `CostingEntry`:

**`SeatCostSetting`** — one org-wide default:

| field | type | notes |
|---|---|---|
| `org` | OneToOne FK `users.Org` | one setting per org |
| `monthly_amount` | Decimal, non-negative | the default seat cost applied org-wide |

**`EmployeeSeatCost`** — per-employee override:

| field | type | notes |
|---|---|---|
| `employee` | OneToOne FK `employees.Employee` | one override per employee; must belong to the caller's own org |
| `monthly_amount` | Decimal, non-negative | overrides the org default for this employee |

**Profitability is computed, not stored.** For each employee (scoped to
the caller's org) with at least one Costing entry or a seat-cost
override:

- `client_value` = sum of `CostingEntry.total` where `employee` is this
  employee, across every client/designation row they're assigned to.
  Each entry's `total` (`hr_day × days_working`) is treated as a monthly
  recurring value — Costing entries have no date field, so this is an
  ongoing/current-state comparison, not tied to a specific month.
- `seat_cost` = `EmployeeSeatCost.monthly_amount` if an override exists
  for this employee, else the org's `SeatCostSetting.monthly_amount`,
  else `0`.
- `salary` = the employee's current salary — the latest `EmployeeSalary`
  row by `effective_from` with no `effective_to` set. If none exists,
  `salary = 0` and the row is flagged "No salary on file" rather than
  silently treated as free labor.
- `cost` = `salary + seat_cost`.
- `profit` = `client_value − cost`. `margin %` = `profit / cost × 100`
  (0 if `cost` is 0).
- `status`: **Profitable** if `client_value > cost × 1.05`, **Loss** if
  `client_value < cost × 0.95`, else **Break-even** (±5% tolerance — the
  same banding shape as Budget vs Actual's On/Over/Under Budget split).

## 2. Permissions & navigation

- No new grantable permission. Seat Cost config and the Profitability
  report are **admin-only**, gated by the existing `IsAdminInAny`
  permission class / `is_admin_in_any()` check — this is sensitive
  salary data, not something to expose via a per-user grant.
- `CostingPage.tsx` gains an internal tab bar (only rendered for admins
  — non-admin users with `costing_access` see exactly today's single
  table, no tab bar at all):
  1. **Costing** — the existing table, completely unchanged.
  2. **Seat Cost** — org-wide default (single amount + Save).
  3. **Employee Seat Cost** — per-employee override list.
  4. **Profitability** — the comparison report.
- The top-level nav tab stays labeled "Costing" (no nav-level change) —
  this is purely an internal tab bar within the existing page.

## 3. Backend API

New additions to `core/costing`, following the exact patterns already
established by `CostingEntry`:

- **`SeatCostSettingSerializer`/`SeatCostSettingViewSet`** —
  `GET/POST/PATCH` at `/api/seat_cost_settings/`, list scoped to the
  caller's org via `scoped()`. Since it's one row per org, the frontend
  does fetch-or-create: PATCH the existing row if the scoped list
  returns one, POST a new one if it returns empty.
  `permission_classes = [IsAuthenticated, IsAdminInAny]`.
- **`EmployeeSeatCostSerializer`/`EmployeeSeatCostViewSet`** — standard
  CRUD at `/api/employee_seat_costs/`, `employee` as
  `SlugRelatedField(slug_field="uid")` validated to belong to the
  caller's own org (mirroring `CostingEntrySerializer.validate_employee`
  / `EmployeeSerializer.validate_designation`'s cross-org guard exactly
  — same instance-vs-create-time org resolution). Scoped to employees in
  the caller's org(s). `IsAdminInAny`-gated.
- **No new "profitability" endpoint.** Matching the Costing/Budget
  pattern: the frontend fetches `CostingEntry` (existing, already
  returns `employee`/`total`), employees + salaries (existing
  `useEmployees()`), `SeatCostSetting`, and `EmployeeSeatCost`, then
  computes the comparison client-side in a pure aggregation utility.
- Both new models broadcast via `core.realtime.broadcast()` on
  create/update/delete, matching every other app.

## 4. Frontend UI

- `CostingPage.tsx` grows an internal tab bar, admin-only. The
  "Costing" tab's content is the existing table, moved under a tab
  without behavioral change.
- **Seat Cost tab**: one form — a single "Monthly Seat Cost" amount
  input + Save, pre-filled from the org's `SeatCostSetting` if present;
  saving creates it on first use, else updates it.
- **Employee Seat Cost tab**: a table (Employee, Seat Cost, Actions)
  listing only employees with an explicit override, using the
  established Add/Edit/Delete modal pattern (employee dropdown + amount
  — no description field, unlike Costing/Budget line items).
- **Profitability tab**: a table, one row per employee with at least one
  Costing entry (`total > 0`) or a seat-cost override — columns:
  Employee, Client Value, Salary, Seat Cost, Total Cost, Profit, Margin
  %, Status (colored badge — Profitable/Break-even/Loss — same visual
  language as Budget vs Actual's status badges). A grand-total row at
  the bottom.
- New hooks `useSeatCostSetting`, `useEmployeeSeatCosts` (mirroring
  `useCosting`'s shape), and a new pure utility
  `computeProfitability(costingEntries, employees, seatCostSetting,
  employeeOverrides)` returning `{rows, grandTotal}`, mirroring
  `computeMonthlySummary`/`computeGrandTotal` from Budget vs Actual.

## 5. Validation & error handling

- `monthly_amount` on both new models must be non-negative; reject with
  400 otherwise.
- `SeatCostSetting` is OneToOne per org at the DB level; the frontend's
  fetch-or-create flow avoids ever attempting a duplicate create in
  normal use.
- `EmployeeSeatCost.employee` must belong to the caller's own org,
  validated on both create and update (mirrors the existing
  `Employee.designation`/`CostingEntry.employee` cross-org guard
  pattern).
- Profitability computation degrades gracefully: no salary record →
  `salary = 0`, row flagged "No salary on file"; no seat cost anywhere
  (no override, no org default) → `seat_cost = 0`.

## 6. Testing

- Backend: model tests for both new models (non-negative validation,
  `SeatCostSetting` OneToOne uniqueness), API CRUD + org-scoping +
  admin-only-permission tests, cross-org `EmployeeSeatCost.employee`
  rejection test (mirroring the existing designation/employee cross-org
  tests).
- Frontend: `useSeatCostSetting`/`useEmployeeSeatCosts` hook tests, a
  unit test suite for `computeProfitability` covering the
  profit/break-even/loss banding and the missing-salary/missing-seat-cost
  edge cases.

## Out of scope

- No historical/monthly tracking of profitability over time — this is a
  current-state snapshot, matching Costing's own lack of a date
  dimension.
- No editing of Costing entries or salaries from within the
  Profitability tab — it is read-only aggregation; changes happen via
  the existing Costing table / Employee Salary tab.
- No export (Excel/PDF/CSV) of the Profitability report.
