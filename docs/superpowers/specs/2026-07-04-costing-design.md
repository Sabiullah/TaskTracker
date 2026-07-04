# Costing feature — design

Date: 2026-07-04

## Summary

Add a per-client "Costing" sheet: a new top-level nav item where a user picks
a client and maintains a table of rows (Designation, Hr/Day, Days Working,
Total). Requires a new master list for Designations, which is also added as a
field on Employee.

## 1. Data model

**Designation becomes a master list, not free text.**
Extend `masters.Master.TYPE_CHOICES` with `("designation", "Designation")` and
update its `CheckConstraint` (`master_type_valid`) to allow it. Reuses the
existing `Master` model/table — no new table for designations themselves.

**Employee gains a designation.**
`core/employees/models.py::Employee` gets a new field:

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

**New Costing entries.**
New Django app `core/costing` with model `CostingEntry`:

| field | type | notes |
|---|---|---|
| `uid` | UUID | standard uid pattern |
| `org` | FK `users.Org` | tenant scope |
| `client` | FK `masters.Master` (`type="client"`) | which client this row belongs to |
| `designation` | FK `masters.Master` (`type="designation"`) | |
| `hr_day` | Decimal | manual input — "no. of hours" |
| `days_working` | Decimal | manual input |
| `total` | Decimal | **auto-computed** = `hr_day + days_working`; persisted on save, not directly editable via the API/UI |
| `created_by` | FK user | |
| timestamps | | `TimeStampedModel` |

`total` is recomputed server-side in the serializer/model `save()` whenever
`hr_day`/`days_working` change, so it can't drift even if a client sends a
stale value. The frontend also computes it live for instant feedback while
typing, before the save round-trip confirms it.

## 2. Permissions & navigation

- Add `costing_access` to `ACCESS_FEATURES` in `users/models.py` — mirrors
  `invoice_access` etc., with its own `_granted_by`/`_granted_at` audit pair
  on `OrgMembership`, and appears in the User Rights matrix for per-user
  grants.
- Add `MenuNode("costing", "Costing", None)` to `MENU_CATALOG` in
  `users/menu_catalog.py` — a **top-level** nav item (same tier as
  Invoices/Attendance/Leads), not nested under Masters. Ungranted users
  simply don't see it in the top nav, same as other gated top-level items.
- Add `MenuNode("masters.designations", "Designations", "masters")` — a new
  tab under the existing Masters section, gated by the existing
  `masters_access` (no new permission needed here).

## 3. Costing page UI

- Client dropdown at the top, populated from `Master` (`type="client"`,
  scoped to the user's org). Selecting a client loads/filters that client's
  costing rows (`GET /api/costing_entries/?client=<uid>`).
- Table columns: Designation (dropdown from `Master` `type="designation"`),
  Hr/Day (number input), Days Working (number input), Total (read-only,
  computed live), Actions (Edit / Delete).
- "Add" button reveals an inline row/form (Designation dropdown + Hr/Day +
  Days Working inputs, Total shown live) for creating a new entry against
  the selected client.
- Edit switches an existing row into the same inline form, pre-filled.
- Delete removes the row after a confirm prompt.

Follows the existing `InvoicePage`-style CRUD pattern: hook `useCosting`
(`hooks/useCosting.ts`), api client `lib/api/costing.ts`, types in
`types/api/costing.ts`.

## 4. Employee + Designations master UI

- Masters page gets a new "Designations" tab, same list/add/edit/delete UX as
  the existing Clients/Categories tabs (plain name entries, org-scoped).
- Employee create/edit form gets a new "Designation" dropdown field, sourced
  from the same master list, saved to `Employee.designation`.

## 5. Validation & error handling

- `hr_day` and `days_working` must be non-negative numbers; reject with 400
  otherwise.
- Costing rows are scoped to the caller's org(s) via the same `scoped()`
  helper used by Invoices — a user cannot see/edit another org's rows.
- Deleting a `Master` designation/client referenced by existing
  Employees/CostingEntries: FK is `SET_NULL`, so references go blank rather
  than blocking the delete (matches existing pattern, e.g.
  `ClientRoadmap.client`).

## 6. Testing

- Backend: model constraint test (designation type valid on `Master`),
  `CostingEntryViewSet` CRUD + org-scoping tests, permission test (403
  without `costing_access`), `total` auto-computation test on create/update.
- Frontend: `useCosting` hook test, live-total-computation test
  (`hr_day + days_working`), extend existing `client.test.ts` pattern for the
  new endpoints.

## Out of scope

- No currency/rate concept — Total is a plain sum of two numeric inputs, not
  a monetary calculation.
- No bulk import/export for Costing rows.
- No historical/versioned costing entries (no effective-date ranges, unlike
  `EmployeeSalary`).
