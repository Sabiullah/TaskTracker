# Conveyance Tab — Design Spec

**Date:** 2026-04-23
**Status:** Approved (brainstorming complete)
**Author:** Brainstorming session with user (Sabiullah)

---

## 1. Overview

Add a **Conveyance** module to TaskTracker so employees can log travel and expense items (bus tickets, hotel stays, taxis, etc.), mark them as claimable, attach proof documents, and have them approved by a Manager or Admin. Admins and Managers get three views: a full transaction list, an employee-wise monthly total, and a client-wise monthly total. Summary rows deep-link back into the filtered transaction list, with hover tooltips showing a quick breakdown.

The feature ships as a new Django app `core/conveyance` and a new React page `frontend/task-tracker/src/components/Conveyance/`. It follows every existing TaskTracker pattern (multi-tenant scoping, role-based visibility, hashed upload paths, auth-gated file downloads, realtime broadcasts, audit logging).

---

## 2. Decisions Made During Brainstorming

| # | Question | Decision |
|---|---|---|
| 1 | Approval flow? | **Yes**, each entry must be approved before it counts toward claim totals. |
| 2 | Who approves? | **Manager OR Admin**. States: `pending` → `approved` / `rejected`. Rejected entries are resubmitted as new entries (not edited over). |
| 3 | Meaning of `claimable` flag? | **Employee-set at create time**. `claimable=False` entries are logged for record-keeping only and excluded from monthly totals; still visible in transaction list. |
| 4a | Client required? | **Required** — every entry ties to a `Master` of `type='client'`. |
| 4b | Attachments? | **Single file** per entry (not multiple). |
| 5 | Monthly summary format? | **Both modes** — default single-month view with a toggle to a trailing pivot (N months × rows). |
| 6a | Currency? | **INR only** (₹, 2 decimals). |
| 6b | Attachment required? | **Always optional** — employees may submit claims without proof (reviewers use judgement). |
| 6c | Edit/delete rules? | **Employee: only while `pending`**. Once approved/rejected, locked. **Admin: always** (for corrections). |
| 6d | Realtime broadcast? | **Yes** — matches existing TaskTracker pattern. |

**Implementation approach chosen:** Approach 2 — single unified `summary/` endpoint with `group_by` and `mode` params, instead of three dedicated summary endpoints or client-side aggregation.

---

## 3. Architecture & Data Model

### 3.1 New Django app

Path: `core/conveyance/` — follows the canonical layout (`models.py`, `serializers.py`, `views.py`, `urls.py`, `admin.py`, `apps.py`, `tests.py`, `__init__.py`).

Registrations:
- `config/settings.py`: `INSTALLED_APPS += ["core.conveyance"]`.
- `config/urls.py`: `path("api/", include("core.conveyance.urls"))`.

### 3.2 `ConveyanceEntry` model

Extends `core.base.TimeStampedModel`.

| Field | Type | Notes |
|---|---|---|
| `uid` | `UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)` | Standard external identifier. |
| `org` | `FK(users.Org, on_delete=CASCADE, related_name="conveyance_entries")` | Tenant scope; auto-set from `request.user.org` on create. |
| `employee` | `FK(settings.AUTH_USER_MODEL, on_delete=PROTECT, related_name="conveyance_entries")` | Whose expense. Defaults to `request.user` on create (Admin may override). |
| `date` | `DateField(db_index=True)` | Expense date; drives monthly bucketing. |
| `client` | `FK("masters.Master", on_delete=PROTECT, related_name="conveyance_entries", limit_choices_to={"type": "client"})` | Required. |
| `reason` | `TextField(max_length=2000)` | Free text; min 3 chars. |
| `amount` | `DecimalField(max_digits=12, decimal_places=2)` | INR. Validated 0 < amount ≤ 9,999,999,999.99. |
| `claimable` | `BooleanField(default=True)` | Employee-set. |
| `attachment` | `FileField(upload_to=conveyance_upload_to, null=True, blank=True)` | Single file; hashed path. |
| `status` | `CharField(max_length=10, choices=[("pending","Pending"),("approved","Approved"),("rejected","Rejected")], default="pending", db_index=True)` | Approval state. |
| `reviewed_by` | `FK(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=SET_NULL, related_name="conveyance_reviews")` | Set on approve/reject. |
| `reviewed_at` | `DateTimeField(null=True, blank=True)` | Set on approve/reject. |
| `review_note` | `CharField(max_length=500, blank=True)` | Optional; required for rejection. |
| `created_by` | `FK(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=SET_NULL, related_name="conveyance_created")` | Audit field (typically equals `employee`; differs for Admin-on-behalf). |

Inherited from `TimeStampedModel`: `created_at`, `updated_at`.

**`Meta`:**

```python
class Meta:
    ordering = ["-date", "-created_at"]
    verbose_name = "conveyance entry"
    verbose_name_plural = "conveyance entries"
    indexes = [
        models.Index(fields=["org", "date"]),
        models.Index(fields=["org", "employee", "date"]),
        models.Index(fields=["org", "client", "date"]),
        models.Index(fields=["org", "status"]),
    ]
```

**`__str__`:** `f"{self.employee} · {self.date} · ₹{self.amount}"`.

### 3.3 Upload helper

Add to `core/filestore/validators.py`:

```python
def conveyance_upload_to(instance, filename):
    return _hashed_upload_path("conveyance", filename)
```

Matches `invoice_upload_to` pattern — routes uploads to `conveyance/YYYY/MM/<uuid>.<ext>`. Upload size / MIME rules are applied by the existing `validate_upload` in the serializer.

### 3.4 Role-based visibility

In `ConveyanceEntryViewSet.get_queryset()`, after `qs.filter(org=user.org)`:

- `admin` → no further filter.
- `manager` → `qs.filter(employee_id__in=[user.id, *user.subordinates.values_list("id", flat=True)])`.
- `employee` → `qs.filter(employee=user)`.

### 3.5 Approval authority

- Allowed reviewers: role `admin` or `manager` in the same org.
- Managers can only review their subordinates' entries.
- **No self-review**: if `entry.employee_id == request.user.id` → 403, even for admins.

---

## 4. API Surface

Router (`core/conveyance/urls.py`) registers `ConveyanceEntryViewSet` at `conveyance_entries`. All routes sit under `/api/`.

### 4.1 List / Create — `GET|POST /api/conveyance_entries/`

**List query params** (all optional):

| Param | Type | Notes |
|---|---|---|
| `employee_uid` | UUID | Restrict to one employee (subject to role visibility). |
| `client_uid` | UUID | Restrict to one client. |
| `status` | `pending`\|`approved`\|`rejected` | |
| `claimable` | `true`\|`false` | |
| `month` | `YYYY-MM` | Convenience for single-month list. |
| `from`, `to` | `YYYY-MM-DD` | Date range. |
| `search` | string | Case-insensitive `reason__icontains`. |
| `page`, `page_size` | int | `StandardPagination`. |

**POST body (employee):**

```json
{
  "date": "2026-04-18",
  "client": "<client_uid>",
  "reason": "Client site visit - taxi",
  "amount": "1450.00",
  "claimable": true,
  "attachment": <multipart file, optional>
}
```

**POST body (admin on behalf):** include `"employee_uid": "<uid>"`.

**Create rules:**
- `org` forced to `request.user.org` via `OrgScopedMixin`.
- `employee` defaults to `request.user`. Only Admin may pass `employee_uid`; target must be in caller's org.
- `status` is read-only and always starts at `pending`.
- `created_by` set to `request.user` in `perform_create`.

### 4.2 Retrieve / Update / Delete — `GET|PATCH|DELETE /api/conveyance_entries/<uid>/`

- Visibility: governed by `get_queryset`; non-visible entries return 404.
- Update/Delete:
  - Non-admin: allowed only when `status == "pending"` AND owner. Otherwise 403 (or 404 if not visible).
  - Admin: allowed in any state.
- `status`, `reviewed_by`, `reviewed_at`, `review_note` are read-only in this serializer — they mutate only via the action endpoints.
- Replacing `attachment` deletes the previous file from disk in `perform_update`.
- `DELETE` removes the file from disk.

### 4.3 Approve — `POST /api/conveyance_entries/<uid>/approve/`

Permission: `IsAdminOrManager` + (if manager) `employee` must be a subordinate + `request.user.id != entry.employee_id`.

**Body:** `{ "review_note": "optional" }`.

**Effect:** `status="approved"`, `reviewed_by=request.user`, `reviewed_at=timezone.now()`, `review_note=body.review_note or ""`.

**Errors:**
- Already `approved` or `rejected` → **409** `{"detail": "Entry is already <status>"}`.
- Self-review → **403** `{"detail": "Cannot review your own entry"}`.
- Manager reviewing non-subordinate → **403**.
- Cross-tenant → **404**.

Emits audit log (`action="conveyance.approve"`, target uid) and realtime broadcast.

### 4.4 Reject — `POST /api/conveyance_entries/<uid>/reject/`

Same permission rules as approve. `review_note` is **required** and must be ≥ 3 chars after strip; otherwise **400**.

**Effect:** `status="rejected"`, `reviewed_by`, `reviewed_at`, `review_note` set.

Emits audit log (`action="conveyance.reject"`) and realtime broadcast.

### 4.5 Download attachment — `GET /api/conveyance_entries/<uid>/download/`

`IsAuthenticated` + inherits viewset's org-scoped `get_queryset`. Default `Content-Disposition: inline`; `?download=1` forces `attachment`. 404 if no attachment.

### 4.6 Summary — `GET /api/conveyance_entries/summary/`

**Permission:** `IsAdminOrManager`. Employees → 403.

**Required:** `group_by=employee` or `group_by=client`.

**Modes (mutually exclusive):**

| Mode | Extra params |
|---|---|
| `mode=single` (default) | `month=YYYY-MM` (defaults to current month). |
| `mode=trailing` | `months=N` (1..12, clamped silently; default 6), `end=YYYY-MM` (default current month). |

**Base filters applied to all modes:** org scope, role visibility, `status="approved"`, `claimable=True`.

**Single-month response:**

```json
{
  "mode": "single",
  "month": "2026-04",
  "group_by": "employee",
  "rows": [
    {
      "key_uid": "<uid>",
      "key_label": "Ravi Kumar",
      "total": "12450.00",
      "entry_count": 7,
      "top_entries": [
        { "uid": "...", "date": "2026-04-18", "reason": "Client site visit - taxi", "amount": "3200.00" }
      ]
    }
  ],
  "grand_total": "84200.00"
}
```

`top_entries` is capped at 3, ordered by `amount DESC`, and powers the UI tooltip.

**Trailing response:**

```json
{
  "mode": "trailing",
  "months": ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04"],
  "group_by": "client",
  "rows": [
    {
      "key_uid": "<uid>",
      "key_label": "Acme Corp",
      "monthly": { "2025-11": "0.00", "2025-12": "4500.00", "2026-01": "0.00", "2026-02": "2200.00", "2026-03": "8100.00", "2026-04": "1450.00" },
      "total": "16250.00"
    }
  ],
  "column_totals": { "2025-11": "0.00", "2025-12": "4500.00", "2026-01": "0.00", "2026-02": "2200.00", "2026-03": "8100.00", "2026-04": "1450.00" },
  "grand_total": "16250.00"
}
```

Trailing mode does **not** include `top_entries` (keeps the initial render cheap); the UI calls `mode=single` on hover to populate tooltips on demand.

**Implementation:** one aggregation query using `.values(key_field, TruncMonth("date")).annotate(Sum("amount"), Count("id"))`, pivoted in Python for trailing mode. For `top_entries` in single mode, a second query selects per-group top 3 by amount (Postgres: window function with `ROW_NUMBER() OVER (PARTITION BY key_field ORDER BY amount DESC)`; SQLite dev: per-key subquery loop, acceptable at dev data sizes).

---

## 5. Frontend Layout

New top-level sidebar entry **Conveyance** (visible to all roles). Route: `/conveyance`. Page file: `frontend/task-tracker/src/components/Conveyance/ConveyancePage.tsx`.

### 5.1 Tab bar

1. **Transactions** — all roles.
2. **Employee Totals** — admin + manager only.
3. **Client Totals** — admin + manager only.

Tab state synced to URL (`?tab=transactions|employeeTotals|clientTotals`) so hyperlinks can deep-link.

### 5.2 Transactions tab

**Filter bar** (collapsible): Employee (admin/manager), Client, Month picker, Status (Pending/Approved/Rejected/All), Claimable (Yes/No/All), free-text search. Filter state ↔ URL query sync.

**Table columns:** Date · Employee · Client · Reason (truncated with full-text tooltip) · Amount (₹ right-aligned, `Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" })`) · Claimable chip · Status chip (amber/green/red) · Attachment paperclip (opens `/download/` URL; `null` → dash) · Actions.

**Action visibility:**
- Own + Pending → Edit, Delete.
- Pending + (admin or manager-of-employee) → Approve, Reject.
- Admin → Edit, Delete in any state.
- Otherwise → row is read-only.

**Add / Edit dialog:** Date (default today; future dates blocked client-side too), Client (searchable dropdown of `Master.type=client`), Reason (textarea), Amount (numeric ₹), Claimable toggle (default On), Attachment (single file, client-side 20 MB cap).

**Reject dialog:** modal with required `review_note` field (≥ 3 chars).

### 5.3 Employee Totals & Client Totals tabs

Shared shape — only the grouping key differs.

**Controls:**
- Mode toggle: **Single month** ↔ **Trailing** (default Single).
- Single: Month picker (default current).
- Trailing: Months input (1..12, default 6) + End month picker (default current).

**Single-month table:** one row per employee/client with Entry count + Total (₹).
- Each row is a link to Transactions tab with `?employee=<uid>&month=YYYY-MM&status=approved&claimable=yes` (or `?client=<uid>&...`).
- Hover tooltip on Total cell shows `top_entries` (date · truncated reason · amount) plus "…and N more" when `entry_count > 3`.
- Sticky **Grand total** footer row.

**Trailing pivot table:** columns = months (oldest → `end`), rows = employee/client, each cell = amount.
- Every amount cell is a link → Transactions tab filtered to that employee/client + that specific month.
- Hover tooltip fetches on-demand by calling `summary/?mode=single&month=YYYY-MM&group_by=…&<filter on that key>` once and caching per (key, month).
- Sticky row of **column totals** plus a **Grand total** cell.

**Empty state:** "No approved claimable conveyance entries in this period" with a link to the Transactions tab.

### 5.4 Supporting files

- `frontend/task-tracker/src/types/conveyance.ts` — `ConveyanceEntry`, `ConveyanceSummaryRow`, `ConveyanceSummaryResponse` (discriminated by `mode`).
- `frontend/task-tracker/src/utils/conveyanceApi.ts` — typed wrappers around `apiGet`/`apiPost`.
- `frontend/task-tracker/src/components/Conveyance/` — `ConveyancePage.tsx`, `ConveyanceTransactions.tsx`, `ConveyanceSummary.tsx`, `ConveyanceFormDialog.tsx`, `ConveyanceRejectDialog.tsx`, plus `__tests__/`.

### 5.5 Realtime

Subscribe to `"conveyance"` in `ConveyancePage`. Events: `INSERT`, `UPDATE`, `DELETE`. On receipt, reconcile the Transactions table; flag the two Totals tabs as **stale** with a "Refresh" banner (do not auto-refetch the heavier summary query).

---

## 6. Error Handling & Validation

### 6.1 Serializer-level

- `amount`: > 0 and ≤ 9,999,999,999.99.
- `date`: not in the future (`date > today` → 400). No lower bound.
- `reason`: stripped, min 3 chars.
- `client`: must be a `Master` with `type="client"` in caller's org.
- `employee_uid` on create: only Admin may set; target must be in caller's org.
- `attachment`: `validate_upload` (MIME allow-list, 20 MB cap).
- `status`, `reviewed_by`, `reviewed_at`, `review_note` are read-only here.

### 6.2 Viewset-level

- Non-admin edit/delete of non-pending entry → 403 `{"detail": "Only pending entries can be modified"}`.
- Non-owner edit/delete attempt → 404 (queryset-hidden).
- Attachment replaced → old file deleted from disk.
- Entry deleted → file deleted from disk.

### 6.3 Approve/Reject edge cases

- Already decided → 409 `{"detail": "Entry is already <approved|rejected>"}`.
- Self-review → 403.
- Manager reviewing non-subordinate → 403.
- Cross-tenant → 404.
- Reject missing/short `review_note` → 400.

### 6.4 Summary edge cases

- Missing `group_by` → 400.
- `mode=single` without `month` → defaults to current month (not 400).
- `mode=trailing`: `months` clamped to 1..12; `end` defaults to current month.
- Invalid date format → 400 with a clear message.
- Empty result → `{ ..., "rows": [], "grand_total": "0.00" }` (not 404).

### 6.5 Multi-tenant safety

- `ConveyanceEntrySerializer` inherits `OrgScopedMixin`.
- `get_queryset` filters by `org=request.user.org` **first**, then role visibility.
- Cross-tenant reads, approvals, downloads, and self-reviews all resolve via `get_queryset` or permissions and return 404/403 consistently with the rest of TaskTracker.

### 6.6 Audit & realtime

- `approve` → `AuditLog` with `action="conveyance.approve"`, `actor=request.user`, `target=entry.uid`.
- `reject` → `action="conveyance.reject"`.
- Create / edit / delete do **not** audit-log (matches existing apps).
- `broadcast("conveyance", "INSERT"|"UPDATE"|"DELETE", serialized_entry)` on all mutations.

---

## 7. Testing Plan

### 7.1 Backend (`core/conveyance/tests.py`, `APITestCase`)

**`ConveyanceEntryCRUDTests`:**
- `test_employee_can_create_own_entry`
- `test_admin_can_create_on_behalf`
- `test_non_admin_cannot_set_employee_uid` → 403
- `test_admin_cannot_create_for_user_in_other_org` → 400
- `test_future_date_rejected` → 400
- `test_negative_amount_rejected` → 400
- `test_client_required` → 400
- `test_client_must_be_type_client` → 400
- `test_client_must_be_same_org` → 400
- `test_employee_sees_only_own`
- `test_manager_sees_self_plus_subordinates`
- `test_admin_sees_all_in_org_but_not_other_org`
- `test_pending_edit_by_owner`
- `test_non_pending_edit_by_owner_blocked` → 403
- `test_admin_can_edit_any_state`
- `test_pending_delete_by_owner`, `test_non_pending_delete_blocked`, `test_admin_delete_any_state`
- `test_attachment_upload_and_download_auth_gated`
- `test_attachment_replaced_deletes_old_file`
- `test_entry_delete_removes_file`

**`ConveyanceApproveRejectTests`:**
- `test_manager_approves_subordinate_entry`
- `test_admin_approves_any_entry`
- `test_employee_cannot_approve` → 403
- `test_cannot_review_own_entry` → 403 (even admin)
- `test_manager_cannot_approve_non_subordinate` → 403
- `test_cross_tenant_approve_blocked` → 404
- `test_reject_requires_note` → 400
- `test_already_decided_returns_409`
- `test_approve_emits_audit_log`
- `test_approve_emits_realtime_broadcast` (patch `core.realtime.broadcast`)

**`ConveyanceSummaryTests`:**
- `test_requires_group_by` → 400
- `test_employee_forbidden_from_summary` → 403
- `test_single_mode_default_month_is_current`
- `test_single_mode_excludes_non_claimable`
- `test_single_mode_excludes_pending_and_rejected`
- `test_single_mode_group_by_employee_totals` (sums, counts, top_entries length and ordering)
- `test_single_mode_group_by_client_totals`
- `test_trailing_mode_builds_month_columns`
- `test_trailing_mode_months_clamped` (99 → 12; 0 → 1)
- `test_trailing_mode_zero_fills_missing_months`
- `test_summary_respects_role_visibility` (manager)
- `test_summary_respects_org_scope`
- `test_grand_total_matches_row_sum`

### 7.2 Frontend (Vitest)

- `conveyanceApi.test.ts` — request-builder correctness (filter → query string; summary endpoints for each mode).
- `ConveyanceFilters.test.tsx` — URL ↔ state round-trip.
- `ConveyanceSummaryTable.test.tsx` — tooltip renders `top_entries`; hyperlink hrefs; trailing zero-fill cells are still links.
- `ConveyanceFormDialog.test.tsx` — client-side validation (future date, negative amount, missing client); happy-path POST body shape.
- Realtime integration — mock WebSocket, verify Transactions table reconciles on `INSERT`/`UPDATE`/`DELETE` and summary tabs flag as stale.

### 7.3 Out of scope

- Visual regression / screenshot tests.
- Django migration rollback tests.
- Load testing (revisit if a tenant exceeds ~5k entries/month).

---

## 8. Migration Safety

Single migration `core/conveyance/migrations/0001_initial.py`. Table creation only — no data backfill. Safe to apply against existing databases.

---

## 9. Open Questions

None. All brainstorming questions resolved.

---

## 10. Next Step

Invoke `superpowers:writing-plans` to produce a step-by-step implementation plan from this spec.
