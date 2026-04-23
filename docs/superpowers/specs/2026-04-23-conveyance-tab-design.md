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
| 4b | Attachments? | **Multiple files** per entry (0..N). Example: a single meal-expense claim may attach separate bills for breakfast, lunch, and dinner. |
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
| `org` | `FK(users.Org, null=True, blank=True, on_delete=SET_NULL, related_name="conveyance_entries")` | Tenant scope; resolved via `resolve_create_org(request)`. Matches the codebase convention used by WorkLog, InvoicePlan, Attendance. |
| `employee` | `FK(settings.AUTH_USER_MODEL, on_delete=CASCADE, related_name="conveyance_entries")` | Whose expense. Defaults to `request.user` on create (Admin may override). Matches WorkLog convention. |
| `date` | `DateField(db_index=True)` | Expense date; drives monthly bucketing. |
| `client` | `FK("masters.Master", on_delete=PROTECT, related_name="conveyance_entries", limit_choices_to={"type": "client"})` | Required. |
| `reason` | `TextField(max_length=2000)` | Free text; min 3 chars. |
| `amount` | `DecimalField(max_digits=12, decimal_places=2)` | INR. Validated 0 < amount ≤ 9,999,999,999.99. |
| `claimable` | `BooleanField(default=True)` | Employee-set. |
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

### 3.3 `ConveyanceAttachment` model (child of entry)

Extends `core.base.TimeStampedModel`. One row per uploaded file; zero or more per entry.

| Field | Type | Notes |
|---|---|---|
| `uid` | `UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)` | External identifier used in download URLs. |
| `entry` | `FK(ConveyanceEntry, on_delete=CASCADE, related_name="attachments")` | Parent entry; deleting the entry cascades. |
| `file` | `FileField(upload_to=conveyance_attachment_upload_to)` | Required (a row with no file makes no sense). |
| `label` | `CharField(max_length=100, blank=True)` | Optional short tag — e.g. "Breakfast", "Lunch", "Hotel bill". |
| `uploaded_by` | `FK(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=SET_NULL, related_name="conveyance_attachment_uploads")` | Audit field. |

Inherited: `created_at`, `updated_at`.

**`Meta`:**

```python
class Meta:
    ordering = ["created_at"]
    verbose_name = "conveyance attachment"
    verbose_name_plural = "conveyance attachments"
    indexes = [models.Index(fields=["entry"])]
```

**`__str__`:** `f"{self.entry.uid} · {self.label or self.file.name.rsplit('/', 1)[-1]}"`.

### 3.4 Upload helper

Add to `core/filestore/validators.py`:

```python
def conveyance_attachment_upload_to(instance, filename):
    return _hashed_upload_path("conveyance", filename)
```

Matches `invoice_upload_to` pattern — routes uploads to `conveyance/YYYY/MM/<uuid>.<ext>`. Upload size / MIME rules are applied by the existing `validate_upload` in the serializer (20 MB cap, MIME allow-list) **per file**. There is no per-entry aggregate cap — each attachment is validated independently.

### 3.5 Role-based visibility

TaskTracker is multi-org: a user belongs to one or more orgs and carries a per-org role (`admin`, `manager`, `employee`) on `OrgMembership`. Use the shared helper `core.org_utils.visibility_q(user, "employee")` in `ConveyanceEntryViewSet.get_queryset()`:

- In orgs where the user is **admin** → every entry in that org is visible.
- In orgs where the user is **manager** → every entry in that org is visible (no subordinate narrowing; matches the pattern used in Tasks, WorkLog, WorkPlan, Leads, Attendance, PACE, Growth).
- In orgs where the user is **employee** → only their own entries are visible.
- Entries in any org the user does not belong to → hidden.

### 3.6 Approval authority

- Allowed reviewers: user must be admin or manager in the **entry's org** (`request.user.is_manager_in(entry.org_id)`), not just admin-or-manager in any org.
- **No self-review**: if `entry.employee_id == request.user.id` → 403, even if the caller is the org admin.
- Employees (non-manager, non-admin in that org) → 403.
- Cross-tenant → 404 (queryset-hidden).

---

## 4. API Surface

Router (`core/conveyance/urls.py`) registers two viewsets:
- `ConveyanceEntryViewSet` at `conveyance_entries`
- `ConveyanceAttachmentViewSet` at `conveyance_attachments` (retrieve / create / delete / download only; no list — attachments are surfaced through their parent entry).

All routes sit under `/api/`.

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

**POST — `multipart/form-data` (employee):**

| Field | Type | Notes |
|---|---|---|
| `date` | `YYYY-MM-DD` | Required. |
| `client` | UUID | Required. |
| `reason` | string | Required. |
| `amount` | decimal | Required. |
| `claimable` | `true`\|`false` | Defaults `true`. |
| `attachments` | file × N | Optional, repeated field. Multiple files can be posted in one multipart request (e.g. breakfast + lunch + dinner bills). |
| `attachment_labels` | string × N | Optional, repeated. Position-aligned with `attachments` — `attachment_labels[i]` is the label for `attachments[i]`. If fewer labels than files, the remainder get empty labels. Ignored if no `attachments`. |

**POST (admin on behalf):** include `employee_uid` field.

**JSON-shape example (for docs only — real submissions are multipart):**

```json
{
  "date": "2026-04-18",
  "client": "<client_uid>",
  "reason": "Client site visit meals",
  "amount": "1450.00",
  "claimable": true,
  "attachments": ["<file: breakfast.jpg>", "<file: lunch.pdf>", "<file: dinner.jpg>"],
  "attachment_labels": ["Breakfast", "Lunch", "Dinner"]
}
```

**Create rules:**
- `org` is resolved via `core.org_utils.resolve_create_org(request)` — if the caller belongs to exactly one org, that org is used; if multi-org, an explicit `org_uid` (or `org_id` / `org`) field is required in the POST body.
- `employee` defaults to `request.user`. Only a caller who is **admin in the target org** may pass `employee_uid`, and the referenced user must also be a member of that org (else 400). Non-admins passing `employee_uid` → 403.
- `status` is read-only and always starts at `pending`.
- `created_by` set to `request.user` in `perform_create`.
- Attachments are created atomically with the entry: the whole POST succeeds or the whole thing rolls back (wrap `perform_create` in `transaction.atomic()` — if any single file fails `validate_upload`, the entry is not created and no files are written).
- Each attachment row gets `uploaded_by = request.user`.

**GET list response** includes each entry's `attachments: [{uid, label, file_url, filename, uploaded_at, uploaded_by_detail}, ...]` as a read-only nested array. `file_url` points to the per-attachment download endpoint (§4.7).

### 4.2 Retrieve / Update / Delete — `GET|PATCH|DELETE /api/conveyance_entries/<uid>/`

- Visibility: governed by `get_queryset`; non-visible entries return 404.
- Update/Delete:
  - Non-admin: allowed only when `status == "pending"` AND owner. Otherwise 403 (or 404 if not visible).
  - Admin: allowed in any state.
- `status`, `reviewed_by`, `reviewed_at`, `review_note` are read-only in this serializer — they mutate only via the action endpoints.
- `attachments` is **read-only** on `PATCH /conveyance_entries/<uid>/` — you cannot add or remove attachments via the entry serializer. Use §4.5 / §4.6 endpoints for that. A PATCH that includes an `attachments` field is accepted (other fields update) but the attachments payload is silently ignored, matching DRF's standard handling of read-only fields.
- `DELETE` on the entry cascades to `ConveyanceAttachment` rows and removes every associated file from disk (via a pre-delete handler on the attachment or an explicit loop in `perform_destroy`).

### 4.3 Approve — `POST /api/conveyance_entries/<uid>/approve/`

Permission: `IsAuthenticated` at the viewset level, with per-org check inside the action — `request.user.is_manager_in(entry.org_id)` must be true, and `request.user.id != entry.employee_id`.

**Body:** `{ "review_note": "optional" }`.

**Effect:** `status="approved"`, `reviewed_by=request.user`, `reviewed_at=timezone.now()`, `review_note=body.review_note or ""`.

**Errors:**
- Already `approved` or `rejected` → **409** `{"detail": "Entry is already <status>"}`.
- Self-review → **403** `{"detail": "Cannot review your own entry"}`.
- Caller is not manager/admin in the entry's org → **403** `{"detail": "Manager or admin role required in the entry's organisation"}`.
- Cross-tenant (entry not visible via `get_queryset`) → **404**.

Emits audit log (`action="conveyance.approve"`, target uid) and realtime broadcast.

### 4.4 Reject — `POST /api/conveyance_entries/<uid>/reject/`

Same permission rules as approve. `review_note` is **required** and must be ≥ 3 chars after strip; otherwise **400**.

**Effect:** `status="rejected"`, `reviewed_by`, `reviewed_at`, `review_note` set.

Emits audit log (`action="conveyance.reject"`) and realtime broadcast.

### 4.5 Add attachment to existing entry — `POST /api/conveyance_attachments/`

**Body (multipart):** `entry_uid` (UUID), `file` (single file), `label` (string, optional).

**Permissions:**
- The parent entry must be visible to the caller via `ConveyanceEntryViewSet.get_queryset()` visibility rules (else 404).
- Add is allowed only when:
  - the parent entry is `pending` AND the caller is the owner (`entry.employee == request.user`), OR
  - the caller is **admin in the entry's org** (`request.user.is_admin_in(entry.org_id)`), who can add attachments in any state for corrections.
- Otherwise 403.

**Response:** 201 with the new attachment `{uid, label, file_url, filename, uploaded_at, uploaded_by_detail}`.

Emits a `broadcast("conveyance-entries", "UPDATE", <full parent entry>)` so other clients reconcile the parent row's `attachments` array.

### 4.6 Delete a single attachment — `DELETE /api/conveyance_attachments/<uid>/`

**Permissions:** same rule as add — parent entry must be visible, and deletion allowed when parent is `pending` + owner, OR caller is admin in the entry's org (any state).

**Effect:** removes the row and deletes the file from disk. Emits a `broadcast("conveyance-entries", "UPDATE", <parent entry>)`.

### 4.7 Download a single attachment — `GET /api/conveyance_attachments/<uid>/download/`

`IsAuthenticated` + attachment must have a visible parent entry (§3.5 visibility). Default `Content-Disposition: inline`; `?download=1` forces `attachment`. Filename preserved from the original upload name for the `Content-Disposition` header.

### 4.8 Summary — `GET /api/conveyance_entries/summary/`

**Permission:** `IsAuthenticated` + caller must be manager or admin in at least one org (`IsAdminOrManagerInAny`). Plain employees → 403. Only rows from orgs where the caller holds manager/admin role contribute; rows from orgs where the caller is a plain employee are excluded from the aggregate (this is handled by a dedicated filter inside the action, not `visibility_q` — summary intentionally never leaks aggregate claim totals to plain employees).

**Required:** `group_by=employee` or `group_by=client`.

**Modes (mutually exclusive):**

| Mode | Extra params |
|---|---|
| `mode=single` (default) | `month=YYYY-MM` (defaults to current month). |
| `mode=trailing` | `months=N` (1..12, clamped silently; default 6), `end=YYYY-MM` (default current month). |

**Base filters applied to all modes:** `org_id__in=<orgs where caller is admin or manager>`, `status="approved"`, `claimable=True`.

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

**Table columns:** Date · Employee · Client · Reason (truncated with full-text tooltip) · Amount (₹ right-aligned, `Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" })`) · Claimable chip · Status chip (amber/green/red) · Attachments (paperclip with count badge, e.g. 📎 3; empty → dash) · Actions.

The Attachments cell, when count > 0, expands on click into a small popover listing each attachment by `label` (falls back to filename) with a download icon per row. When count = 1, clicking the paperclip opens the download URL directly (no popover).

**Action visibility:**
- Own + Pending → Edit, Delete.
- Pending + (admin or manager-of-employee) → Approve, Reject.
- Admin → Edit, Delete in any state.
- Otherwise → row is read-only.

**Add / Edit dialog:** Date (default today; future dates blocked client-side too), Client (searchable dropdown of `Master.type=client`), Reason (textarea), Amount (numeric ₹), Claimable toggle (default On), Attachments section (see below).

**Attachments section (inside the form dialog):**

- **Create mode:** `<input type="file" multiple>` — user can select multiple files in one go. Selected files appear in a list beneath the input; each row shows filename, size, and a free-text **Label** input (e.g. "Breakfast"). A per-row remove button drops a file before submit. Client-side per-file 20 MB cap; disallowed MIME types flagged inline. On submit, all files + their labels go in the single multipart POST to `/api/conveyance_entries/`.
- **Edit mode (entry is pending):** the dialog shows two lists — **Existing attachments** (each with label, download link, and a delete button that fires `DELETE /api/conveyance_attachments/<uid>/`) and **Add more** (same multi-file input as create mode; on submit, each new file POSTs to `/api/conveyance_attachments/` with the entry's uid and the typed label). Attachments are saved immediately on their respective actions — they are **not** batched with the entry's PATCH. This matches the backend contract in §4.2.
- **Edit mode (entry is non-pending, admin only):** same as pending edit mode — admins can add/remove attachments on approved/rejected entries for corrections (consistent with backend rules in §4.5 / §4.6).

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

- `frontend/task-tracker/src/types/conveyance.ts` — `ConveyanceEntry`, `ConveyanceAttachment`, `ConveyanceSummaryRow`, `ConveyanceSummaryResponse` (discriminated by `mode`).
- `frontend/task-tracker/src/utils/conveyanceApi.ts` — typed wrappers around `apiGet`/`apiPost`, including `addAttachment` and `deleteAttachment` helpers.
- `frontend/task-tracker/src/components/Conveyance/` — `ConveyancePage.tsx`, `ConveyanceTransactions.tsx`, `ConveyanceSummary.tsx`, `ConveyanceFormDialog.tsx`, `ConveyanceAttachmentList.tsx`, `ConveyanceRejectDialog.tsx`, plus `__tests__/`.

### 5.5 Realtime

Subscribe to `"conveyance-entries"` in `ConveyancePage`. Events: `INSERT`, `UPDATE`, `DELETE`. On receipt, reconcile the Transactions table; flag the two Totals tabs as **stale** with a "Refresh" banner (do not auto-refetch the heavier summary query).

---

## 6. Error Handling & Validation

### 6.1 Serializer-level (entry)

- `amount`: > 0 and ≤ 9,999,999,999.99.
- `date`: not in the future (`date > today` → 400). No lower bound.
- `reason`: stripped, min 3 chars.
- `client`: must be a `Master` with `type="client"` in caller's org.
- `employee_uid` on create: only Admin may set; target must be in caller's org.
- `attachments[i]`: each file passes `validate_upload` (MIME allow-list, 20 MB cap per file). If any file fails, the whole create transaction rolls back with a 400 containing a per-file error map.
- `attachment_labels[i]`: optional; length ≤ 100 chars; stripped.
- `status`, `reviewed_by`, `reviewed_at`, `review_note`, `attachments` are read-only fields on the entry serializer for update operations.

### 6.2 Serializer-level (attachment)

- `entry_uid` required on add — must resolve to a visible entry in caller's org.
- `file` required on add — passes `validate_upload`.
- `label`: optional, ≤ 100 chars, stripped.

### 6.3 Viewset-level

- Non-admin edit/delete of non-pending entry → 403 `{"detail": "Only pending entries can be modified"}`.
- Non-owner edit/delete attempt → 404 (queryset-hidden).
- Adding/removing attachments to a non-pending entry → 403 for non-admin; admin allowed.
- Adding/removing attachments on a non-visible entry → 404.
- Single-attachment delete → file removed from disk.
- Entry delete → every attachment row deleted and every file removed from disk (cascade + explicit file cleanup).

### 6.4 Approve/Reject edge cases

- Already decided → 409 `{"detail": "Entry is already <approved|rejected>"}`.
- Self-review → 403.
- Caller is not manager/admin in the entry's org → 403.
- Cross-tenant (entry not visible via queryset) → 404.
- Reject missing/short `review_note` → 400.

### 6.5 Summary edge cases

- Missing `group_by` → 400.
- `mode=single` without `month` → defaults to current month (not 400).
- `mode=trailing`: `months` clamped to 1..12; `end` defaults to current month.
- Invalid date format → 400 with a clear message.
- Empty result → `{ ..., "rows": [], "grand_total": "0.00" }` (not 404).

### 6.6 Multi-tenant safety

- `get_queryset` uses `visibility_q(user, "employee")` — filters to orgs the caller belongs to AND applies per-org role rules.
- Create org resolved via `resolve_create_org(request)`.
- Approve/reject and attachment add/delete check per-org roles via `user.is_manager_in(entry.org_id)` / `user.is_admin_in(entry.org_id)`.
- Cross-tenant reads, approvals, downloads, and self-reviews all resolve via `get_queryset` or permissions and return 404/403 consistently with the rest of TaskTracker.

### 6.7 Audit & realtime

- `approve` → audit via `core.audit.models.log(request.user, "conveyance.approve", resource_type="conveyance_entry", resource_id=entry.uid, changes={"status": "approved"}, request=request)`.
- `reject` → `action="conveyance.reject"`, `changes={"status": "rejected", "reason": review_note}`.
- Create / edit / delete (entry and attachment) do **not** audit-log (matches existing apps).
- `broadcast("conveyance-entries", "INSERT"|"UPDATE"|"DELETE", serialized_entry)` on every entry mutation (channel name dashed-plural to match `"invoice-entries"`, `"work-logs"` convention). Attachment add/remove broadcasts `UPDATE` with the full parent entry (attachments nested), so subscribers don't need a second channel.

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
- `test_manager_sees_all_in_own_org`
- `test_admin_sees_all_in_own_org_not_other_org`
- `test_user_is_employee_in_one_org_manager_in_another` — compound visibility: caller is employee in org A (sees only own A-rows) and manager in org B (sees every B-row)
- `test_pending_edit_by_owner`
- `test_non_pending_edit_by_owner_blocked` → 403
- `test_admin_can_edit_any_state`
- `test_pending_delete_by_owner`, `test_non_pending_delete_blocked`, `test_admin_delete_any_state`
- `test_entry_delete_cascades_attachments_and_files`

**`ConveyanceAttachmentTests`:**
- `test_create_entry_with_multiple_attachments_in_one_multipart` — 3 files + 3 labels → entry has 3 `ConveyanceAttachment` rows in creation order, labels preserved.
- `test_create_entry_with_fewer_labels_than_files` — 3 files + 1 label → first attachment gets the label, rest get empty labels.
- `test_create_entry_with_no_attachments` — entry created successfully; `attachments=[]`.
- `test_create_entry_rolls_back_if_any_file_invalid` — one of 3 files exceeds 20 MB → 400, zero entries + zero attachments persisted, no files written to disk.
- `test_add_attachment_to_pending_entry_by_owner` → 201.
- `test_add_attachment_to_pending_entry_by_admin` → 201 (even if admin is not the owner).
- `test_add_attachment_to_approved_entry_by_owner_blocked` → 403.
- `test_add_attachment_to_approved_entry_by_admin_allowed` → 201.
- `test_add_attachment_to_invisible_entry_returns_404` — employee A tries to add to employee B's entry.
- `test_delete_attachment_removes_row_and_file`.
- `test_delete_attachment_on_non_pending_entry_blocked_for_owner` → 403; allowed for admin.
- `test_download_attachment_auth_gated` — anonymous → 401/403; cross-tenant → 404.
- `test_add_attachment_emits_broadcast` — patch `core.realtime.broadcast`, assert called with `"conveyance-entries"`, `"UPDATE"`, and the parent entry's full serialized form (including the new attachment in `attachments`).
- `test_delete_attachment_emits_broadcast`.

**`ConveyanceApproveRejectTests`:**
- `test_manager_in_org_approves_any_entry_in_that_org`
- `test_admin_in_org_approves_any_entry_in_that_org`
- `test_employee_in_org_cannot_approve` → 403
- `test_manager_in_other_org_cannot_approve` → 404 (not visible via queryset — per-org role must match the entry's org)
- `test_cannot_review_own_entry` → 403 (even if caller is org admin)
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
- `test_summary_excludes_orgs_where_caller_is_plain_employee`
- `test_summary_respects_org_scope` (no bleed across orgs caller does not belong to)
- `test_grand_total_matches_row_sum`

### 7.2 Frontend (Vitest)

- `conveyanceApi.test.ts` — request-builder correctness (filter → query string; summary endpoints for each mode).
- `ConveyanceFilters.test.tsx` — URL ↔ state round-trip.
- `ConveyanceSummaryTable.test.tsx` — tooltip renders `top_entries`; hyperlink hrefs; trailing zero-fill cells are still links.
- `ConveyanceFormDialog.test.tsx` — client-side validation (future date, negative amount, missing client); happy-path POST body shape with multiple files + labels; oversized file flagged before submit.
- `ConveyanceAttachmentList.test.tsx` — popover lists each attachment by label (fallback to filename); single-attachment cell bypasses popover and goes straight to download; delete button only rendered when parent is pending (or caller is admin).
- Realtime integration — mock WebSocket, verify Transactions table reconciles on `INSERT`/`UPDATE`/`DELETE` and summary tabs flag as stale.

### 7.3 Out of scope

- Visual regression / screenshot tests.
- Django migration rollback tests.
- Load testing (revisit if a tenant exceeds ~5k entries/month).

---

## 8. Migration Safety

Single migration `core/conveyance/migrations/0001_initial.py` creates both `ConveyanceEntry` and `ConveyanceAttachment` tables plus indexes. Table creation only — no data backfill. Safe to apply against existing databases.

---

## 9. Open Questions

None. All brainstorming questions resolved.

---

## 10. Next Step

Invoke `superpowers:writing-plans` to produce a step-by-step implementation plan from this spec.
