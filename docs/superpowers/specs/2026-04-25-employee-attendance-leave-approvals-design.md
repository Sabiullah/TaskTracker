# Employee Attendance, Leave & Approvals + Monthly Matrix

## Problem

Today's attendance flow has three gaps:

1. **WFH is unverified.** Anyone can mark `work_location='WFH'` and it counts the same as Office. There is no manager visibility or approval step.
2. **Leave is row-only.** Leave is just an Attendance status; there is no application/approval workflow, no multi-day request, no "pending" state, no rejection reason.
3. **No monthly snapshot.** The `AttendanceReportTab` summarises by employee, but there is no Excel-style **employee × date** grid to scan a month at a glance.

Also, attendance/leave UI is split across two top-level tabs (`Attendance`, `Employee`) when it logically belongs in one place — under **Employee**.

## Goal

Add an end-to-end flow under the **Employee** tab covering:

- WFH entries that require manager approval (admin if requester is a manager; auto-approved if requester is admin).
- A simple Leave application + approval workflow (no leave types, no balance tracking).
- A monthly **Attendance Matrix** view (employees as rows, dates as columns) with single-letter status codes (`P / H / A / L / WFH / WP / HW / ? / HD`).
- Holiday handling: Sunday is a default holiday; admins can override a specific Sunday as a working day. Existing `Holiday` rows continue to take precedence.
- Realtime "Approvals (n)" badge using the existing `broadcast()` SSE channel — no email this round.
- Full **org-picker** support on every new surface (entries, lists, queues, matrix, report).

Visibility rules:

- **Employee** sees themselves only; no Approvals tab.
- **Manager** sees themselves + their direct subordinates (`User.subordinates`).
- **Admin** (and any user with `attendance_access`/`employee_access` per existing flags) sees everyone in the selected org.
- Org picker = `All` merges across every org the viewer has standing in.

## Out of scope

- Email or push notifications (in-app SSE badge + toast only).
- Leave types and balance tracking (Casual / Sick / Earned, accruals, carry-over). The schema leaves room for a future `type` column without migration churn, but this iteration is "Simple" per Q1.
- Mobile / selfie / GPS punch-in (existing "coming soon" banner stays).
- PNG export of the matrix (CSV included; PNG marked Phase-2).
- Changing the existing top-level org-picker mechanism.

## Data model

### Attendance — extend (no breaking change)

Three nullable fields used **only when `work_location='WFH'`**:

| Field | Type | Notes |
|---|---|---|
| `approval_state` | `CharField(null=True, choices=['Pending','Approved','Rejected'])` | Null for non-WFH rows (no approval needed). Defaults to `Pending` on create when location is WFH. |
| `approver` | FK → User, null | Set on approve / reject. |
| `approved_at` | DateTime, null | Set on approve / reject. |
| `rejection_reason` | TextField, blank | Required when rejecting; blank otherwise. |
| `leave_session` | `CharField(null=True, choices=['First Half','Second Half'])` | Set only on rows materialised from a half-day `LeaveRequest`. Lets the matrix render `L½`. Null for normal Attendance entries. |

Migration is non-destructive (all nullable). Existing WFH rows are back-filled to `approval_state='Approved'` so historical data continues to count toward totals.

Indexes added:

- `Attendance(approval_state, org)` — drives the approver queue query.

### LeaveRequest — new

```
uid              UUIDField, unique
org              FK → Org, nullable (matches existing pattern)
user             FK → User                       — who's requesting
from_date        DateField
to_date          DateField
from_session     CharField(choices=['Full','First Half','Second Half'], default='Full')
to_session       CharField(choices=['Full','First Half','Second Half'], default='Full')
reason           TextField
status           CharField(choices=['Pending','Approved','Rejected','Withdrawn'], default='Pending')
approver         FK → User, nullable
approved_at      DateTime, nullable           — set on Approve OR Reject
rejection_reason TextField, blank
total_days       DecimalField(max_digits=5, decimal_places=2)   — computed at save (full days + 0.5 × halves; holidays + Sundays excluded; admin Sunday overrides included)
created_by       FK → User, nullable
created_at       DateTime
updated_at       DateTime

Meta:
  ordering = ['-from_date', '-id']
  indexes:
    (status, org)
    (user, from_date, to_date)
```

**Materialisation rule:** On transition to `Approved`, a post-save signal creates one `Attendance` row per included date (`status='Leave'`, `work_location='Office'`, `login_time/logout_time` null, `created_by=approver`, `org=leave.org`).

Half-day endpoints (where the from-session or to-session is `First Half` / `Second Half`):

- The materialised `Attendance` row carries `status='Leave'` and a new `leave_session` field (`'First Half'` / `'Second Half'`) so the matrix can compute `L½` for that date.
- If the employee separately punched in for the **other** half (an existing `Attendance` row with `status='Half Day'` and matching login/logout times), the materialised Leave row is **not** created for that date — instead the existing Half-Day row's `remarks` is appended with a leave note. The matrix then renders that single row as `L½ + H` stacked.

On `Withdrawn` / `Rejected` of a previously-approved request, the materialised rows are deleted (FK cascade is not used — the signal handles deletion explicitly so an admin un-rejecting later can re-materialise without orphaning history). The remarks-appended Half-Day rows are kept; only the suffix is stripped.

**Conflict rule:** If any date in the range already has an Attendance row that is **not** a Half Day matching the unrequested half (i.e., a Present / WFH / Absent row that contradicts the leave), `Approve` returns `400 conflict-on-date` with the offending date(s). The approver (or an admin) must clear the conflict first.

### WorkingDayOverride — new

```
uid          UUIDField, unique
org          FK → Org
date         DateField
is_working   BooleanField    — true: a Sunday treated as working day; reserved for false (mark a Mon-Sat as a holiday) — not used yet
note         TextField, blank
created_by   FK → User, nullable
created_at   DateTime

Meta:
  unique_together = ('org', 'date')
```

Holiday-resolution order for the matrix (per cell):

1. Explicit `Holiday` row for that date and org → **HD**
2. `WorkingDayOverride(is_working=True)` for that date and org → treat as workday
3. `weekday() == Sunday` → **HD**
4. Otherwise → workday

## Approval flow & permissions

| Requester | Approver pool |
|---|---|
| Employee | All users in `requester.managers.all()`. If empty → all admins in `requester.default_org` (or all admins of the request's org if it differs). |
| Manager | All admins in the same org as the request. |
| Admin | **Auto-approved** on submit (Q5). Approver = the requester themselves. |

Self-approve is blocked even if the requester appears in their own approver pool (defensive — would only trigger via misconfiguration).

### Approver actions

- **Approve** — sets state to `Approved`, records approver + timestamp. For LeaveRequest, fires materialisation signal.
- **Reject** — requires `rejection_reason`; row stays in history but excluded from totals.
- **Edit-after-approval** — blocked for the requester. Approvers and admins can edit the date / location / reason; revoking a Leave deletes the materialised Attendance rows.
- **Withdraw** — only the requester, only while `Pending`.

### Endpoints

```
POST   /api/leave-requests/                  create (Pending; auto-Approved if requester is admin)
GET    /api/leave-requests/                  list (?status= ?user_uid= ?month= ?org_uid=)
PATCH  /api/leave-requests/{uid}/            edit (only Pending; only requester or admin)
POST   /api/leave-requests/{uid}/approve/    approver only
POST   /api/leave-requests/{uid}/reject/     approver only — body: {reason}
POST   /api/leave-requests/{uid}/withdraw/   requester only

POST   /api/attendance/{uid}/approve_wfh/    approver only
POST   /api/attendance/{uid}/reject_wfh/     approver only — body: {reason}

GET    /api/attendance/matrix/?month=YYYY-MM[&user_uid=…][&org_uid=…]
                                              compact matrix payload (see §Matrix view → Performance)
GET    /api/attendance/approvals_pending/    {wfh_count, leave_count, items_preview}

GET    /api/working-day-overrides/           list (?year=)
POST   /api/working-day-overrides/           admin only
DELETE /api/working-day-overrides/{uid}/     admin only
```

Each endpoint reuses `core/org_utils.visibility_q` and `resolve_create_org` for the org filter and creation flow.

## UI — Employee tab restructure

Top-level tab layout becomes:

```
Employee
 ├─ Personal       (existing)
 ├─ Salary         (existing)
 ├─ Documents      (existing)
 ├─ Attendance     ← NEW: Punch + Log/Matrix/Report toggle
 ├─ Leave          ← NEW: My Requests + Apply Leave
 └─ Approvals (n)  ← NEW: only if user is manager/admin in any org
```

The previous top-level **Attendance** tab is removed; `/attendance` redirects to `Employee → Attendance`. The `OrgMembership.attendance_access` flag now gates the three new sub-tabs (not a top-level entry).

### Attendance sub-tab

Header keeps existing `Punch In/Out`, `Export CSV`, and `+ Add Record` buttons. Below: a view-mode toggle:

```
[ 📋 Log ]   [ 📊 Matrix ]   [ 📈 Report ]
```

- **Log** — existing `AttendanceLogTab` verbatim.
- **Matrix** — see §Matrix view.
- **Report** — existing `AttendanceReportTab` verbatim.

Default tab on first visit: **Log** for employees, **Matrix** for managers/admins.

### Matrix view

Layout:

- Frozen left column: Employee name (+ small org-badge stack when picker = All).
- Frozen header: date number on top, weekday letter below. Sundays + Holidays render as full-column tinted (light gray for Sun, light amber for explicit Holiday).
- Frozen right column group: per-employee totals — `P · H · L · WFH · HW · ? · WP`.
- Body cell: 28×28 px, single-letter code, color-coded per legend below.
- Hover a cell → tooltip: `12 Apr 2026 · 09:30–17:23 · WFH · Approved by Sabiullah`.
- Click a cell → side drawer to edit that day's row (subject to permissions).
- Click a header date → admin-only "Mark this date" menu: `Add Holiday` / `Treat as Working Day` (writes a `WorkingDayOverride`).

Status codes (rendered as a collapsible legend):

Cells are derived from the rows on a given date in this priority order — **first match wins**:

1. `?` if there's a row with `login_time` set and `logout_time` null (regardless of location)
2. `HD` if the date is a holiday per the resolution order in §Data model (with `HW` substitution if the admin toggle is on AND a punch-in row exists)
3. `WP` if there's a `work_location='WFH'` row with `approval_state='Pending'`
4. `WFH` if there's a `work_location='WFH'` row with `approval_state='Approved'` AND hours ≥ 4
5. `L½ + H` (stacked) if there's a half-day-leave + half-day-work composite for the date
6. `L` if an approved `LeaveRequest` covers the date as full-day
7. `L½` if an approved `LeaveRequest` covers the date as half-day AND no work was logged for the other half
8. `P` if any non-WFH row with hours ≥ 8.5 OR `status='Present'` (admin override)
9. `H` if any non-WFH row with 4h ≤ hours < 8.5h
10. `A` otherwise (working day with no row and no approved leave)

| Code | Meaning |
|---|---|
| **P** | Present (Office or other non-WFH location, ≥ 8.5h or admin-marked) |
| **H** | Half day (4h ≤ hours < 8.5h, any location with approval state satisfied) |
| **A** | Absent — no row, no leave, working day |
| **L** | Approved leave (full day) |
| **L½** | Approved half-day leave (paired with H or alone) |
| **WFH** | WFH, approved, hours ≥ 4 |
| **WP** | WFH pending approval |
| **HW** | Holiday worked (admin toggle only; otherwise HD wins) |
| **?** | Open punch — login set, no logout |
| **HD** | Holiday (Sunday or explicit Holiday, no working-day override) |

Filters bar above the matrix:

- Month picker (default = current month).
- Employee multi-select (default checked: all subordinates for managers, all employees for admins).
- Status checkboxes (toggle which codes count toward "needs attention" highlight).
- Org picker (inherits the global one but allows narrowing).
- Export button: **CSV**. (PNG cut from this iteration.)

Performance:

- Backend `/attendance/matrix/` endpoint returns one compact JSON for the month:
  ```
  {
    employees: [{uid, full_name, org_uids: [...]}, …],
    dates:     [{date, weekday, is_holiday, is_override, holiday_name?}, …],
    cells:     {[user_uid]: {[date]: {code, hours?, login?, logout?, location?, approval?, leave_uid?, holiday_name?}}}
  }
  ```
- One DB query per source (Attendance, LeaveRequest, Holiday, WorkingDayOverride) for the month.
- Frontend renders virtualized rows when employee count > 40 (render-on-scroll; no new dependency).

### Leave sub-tab

```
[ My Requests ]   [ + Apply Leave ]              Filters: status / month / org

# | Type? | From            | To             | Days | Reason  | Status   | Approver | Decided | Actions
1 | —     | 28 Apr (Full)   | 30 Apr (1st)   | 2.5  | Wedding | Pending  | Sabiullah| —       | [Withdraw]
2 | —     | 02 Apr          | 02 Apr         | 1.0  | Sick    | Approved | Sabiullah| 02 Apr  | [View]
```

`Type?` column is rendered greyed for forward-compatibility with a future Typed leave model — no value shown today.

**Apply Leave** modal: From date + From-session, To date + To-session, Reason (textarea). A live preview shows `total_days` (full days + 0.5 × halves; holidays + Sundays inside the range are skipped per Q6(b)). Submit creates a Pending request (or Approved if the requester is admin).

Backdated leave is permitted within the same per-org `attendance_backdate_days` AppSetting that already gates Attendance (Q6(d)). Admins are always allowed.

### Approvals sub-tab

Visible only if the user is a manager or admin in any org. Two stacked tables:

```
─── WFH approvals (3) ─────────────────────────────────────
# | Employee | Date    | Login | Logout | Remarks | Submitted   | Actions
1 | Vetrivel | 25 Apr  | 09:00 | —      | …       | 25 Apr 09:01| [Approve] [Reject]
…

─── Leave approvals (2) ───────────────────────────────────
# | Employee | From → To              | Days | Reason  | Submitted   | Actions
1 | Sulthan  | 28 Apr → 30 Apr (1st)  | 2.5  | Wedding | 24 Apr 16:20| [Approve] [Reject]
…
```

Approve = single click. Reject opens a modal asking for reason. Bulk-select checkboxes for "Approve selected" (manager convenience).

## Realtime & notifications

Channels (extending the existing `broadcast()` pattern):

| Channel | Event | Payload | Notes |
|---|---|---|---|
| `attendance` | `INSERT/UPDATE/DELETE` | full row | already exists; unchanged |
| `attendance.approval` | `PENDING` | `{uid, requester_uid, approver_uids[], org_uid, kind:'WFH'}` | clients self-filter to ones they're an approver for |
| `attendance.approval` | `DECIDED` | `{uid, requester_uid, decision, org_uid}` | requester + approver |
| `leave` | `INSERT/UPDATE/DELETE` | full leave-request row | requester + approver pool |
| `leave.approval` | `PENDING/DECIDED` | mirror of above | same filtering |

The existing SSE plumbing already filters by org membership; new payloads add `approver_uids[]` so clients can self-filter without a per-channel subscription.

Frontend badge logic (single derived count):

```
n = pendingWFH.filter(canApprove).length + pendingLeave.filter(canApprove).length
```

`useApprovalsBadge()` hook:

- On mount, fetches `/api/attendance/approvals_pending/`.
- Subscribes to `attendance.approval` and `leave.approval` channels and increments/decrements optimistically.
- Refreshes from server every 60s as a safety net.

Toast on requester's screen when a decision lands:

```
✓ Sabiullah approved your WFH on 25 Apr
✗ Sabiullah rejected your leave (28–30 Apr): "team release week"
```

6-second auto-dismiss, dismissable manually. If the header has a notification bell, last 20 toasts persist in its dropdown; if not, toasts only.

**No email** in this iteration.

## Org filter behavior

### Picker = a specific org (e.g. `4D`)

| Surface | Behavior |
|---|---|
| Attendance Log | Only `attendance.org_id = 4D`. Existing — unchanged. |
| Attendance Matrix | Rows = users with an `OrgMembership(org=4D)`. Cells derived only from 4D data. Org-badge column hidden. |
| Attendance Report | Existing report scoped to 4D. Unchanged. |
| Leave list | `leave.org_id = 4D`. Apply-Leave modal pre-fills org = 4D and locks the field. |
| Approvals queue | Pending requests in 4D only — even if the viewer is admin in YBV too. |
| Working-Day Override admin | Lists 4D overrides only; create form locks org. |
| Holiday list (existing) | Already org-scoped — unchanged. |

### Picker = `All`

| Surface | Behavior |
|---|---|
| Attendance Log | Merged across every org the viewer has standing in. Each row tagged with its org-name pill (already exists). |
| Attendance Matrix | Rows = every user the viewer can see across orgs. Each row gets a small org-badge stack under the name. A user in two orgs appears **once** — cells merged across orgs (rare; conflicts shown in tooltip). |
| Attendance Report | Adds an "Org" grouping column. |
| Leave list | Merged. Apply-Leave modal **requires** explicit org selection. |
| Approvals queue | Merged across every org where the viewer is an approver. Each card tagged with org pill. |
| Working-Day Override admin | Read-only merged list; creation requires picking a specific org. |

### Defaults on create

Mirrors the existing Conveyance pattern:

- Picker = specific org → that org used implicitly.
- Picker = All AND user is in exactly one org → that one used implicitly.
- Picker = All AND user is in multiple orgs → form requires org selection (validation error otherwise).

### Subordinate visibility crosses orgs but obeys the picker

`User.subordinates` isn't org-scoped today. Behavior:

- When picker = 4D and one of the viewer's subordinates isn't in 4D, they're excluded from the matrix and the approvals queue.
- When picker = All, they're included.

This avoids leaking a YBV employee's row when someone is browsing 4D.

## Implementation phasing

| # | Phase | What lands | Verifiable in browser? |
|---|---|---|---|
| **1** | Backend foundations | Migrations: Attendance approval fields, `LeaveRequest`, `WorkingDayOverride`. Endpoints from §Endpoints. Permissions wired. Unit tests on rules. | API only — verify via DRF browsable API at `/api/leave-requests/`. |
| **2** | Approvals UX | Employee → Approvals sub-tab (WFH + Leave queues) with Approve / Reject / bulk-select + realtime badge. **First UI you can click.** | Yes — full clickable workflow end-to-end. |
| **3** | Leave UX | Employee → Leave sub-tab (My Requests + Apply Leave modal). | Yes — apply, see it move to Pending → Approved. |
| **4** | Matrix view | Employee → Attendance sub-tab gets Log / Matrix / Report toggle. Matrix from §Matrix view with all status codes, tooltips, frozen columns, filters. Backend `/attendance/matrix/` endpoint. | Yes — the headline view. |
| **5** | Polish & restructure | Sunday-override admin UI under Holidays. Top-level Attendance tab removed + redirect. CSV export of matrix. | Yes — final navigation. |

At each phase boundary I commit locally with a clear message but **do not push** until the user explicitly authorises (per session direction on 2026-04-25; see `feedback_auto_push.md` exception).

Verification uses live DB data first; sample seed rows added only when a screen needs more variety to exercise all status codes.

## Open items resolved during build (not blocking design)

- Whether the header has a notification bell for the toast dropdown (§Realtime). If not, skip the dropdown — keep just the toast.
- Exact virtualization threshold for matrix rows. Measure with the real employee count first.

## Risks

- **Materialisation drift** — If a `LeaveRequest` is approved, then later the leave dates are edited (admin) without going through the signal, the materialised Attendance rows could go stale. Mitigation: all edits to `LeaveRequest.status` AND `from_date/to_date/from_session/to_session` go through a single `apply_state_transition()` method on the model that owns deletion + re-materialisation. The serializer never updates these fields directly.
- **Sunday-override blast radius** — A `WorkingDayOverride(is_working=True)` for a past Sunday could retroactively flip people from `HD` to `A`. Mitigation: the matrix flags overrides created in the past with a small badge in the column header, and the override admin form warns before saving a past date.
- **Matrix payload size** — A 60-employee × 31-day matrix = 1860 cells. Each cell is small (~120 bytes). Total ~220 KB JSON, well within budget. If org count grows to 200+ employees the endpoint will start to feel heavy; address via lazy-load per virtualization window only if it actually becomes a problem.
