# TaskTracker API Usage Guide

A Django REST Framework API consumed by the React frontend and external clients.

**Base URL:** `http://localhost:8000/api/`

---

## Authentication

All endpoints (except login) require a JWT `Authorization` header:

```
Authorization: Bearer <access_token>
```

Tokens are obtained via the login endpoint.

| Token | Lifetime |
|---|---|
| Access token | 8 hours |
| Refresh token | 7 days |

---

## Role-Based Access

| Role | Access level |
|---|---|
| `admin` | Full access within the caller's tenant (`request.user.org`) |
| `manager` | Own data + direct subordinates' data, scoped to the caller's tenant |
| `employee` | Own data only (or assigned records), scoped to the caller's tenant |

Every list endpoint is tenant-scoped — an admin of Org A cannot see Org B's records. This also applies to admin-only actions such as user CRUD, `tasks/delete_all`, `masters/delete_all`, and `/api/orgs/` listing.

---

## Common Conventions

### REST actions

All core resources follow standard DRF router conventions:

| Method | URL | Action |
|---|---|---|
| `GET` | `/api/<resource>/` | List |
| `POST` | `/api/<resource>/` | Create |
| `GET` | `/api/<resource>/<id>/` | Retrieve |
| `PATCH` | `/api/<resource>/<id>/` | Partial update |
| `PUT` | `/api/<resource>/<id>/` | Full update |
| `DELETE` | `/api/<resource>/<id>/` | Delete |

### FK write vs read

When **writing** (POST/PATCH), FK fields accept a `uid` string:
```json
{ "client": "550e8400-e29b-41d4-a716-446655440000" }
```

When **reading** (GET), FK fields are returned as expanded `_detail` objects:
```json
{ "client_detail": { "id": 1, "uid": "550e8400-...", "name": "Focus", "type": "client", "color": "" } }
```

### Auto-set fields

These fields are **set by the server** — do not send them in requests:

| Field | Set to |
|---|---|
| `created_by` | The authenticated user who made the request |
| `user` (WorkLog) | The authenticated user who made the request |
| `sender` (ChatMessage) | The authenticated user who made the request |
| `org` | The authenticated user's org on create (never overridable) |
| `updated_by` (AppSetting) | The authenticated user who made the request |
| `uid` | Auto-generated UUID |
| `created_at`, `updated_at` | Auto-managed timestamps |

If a serializer exposes a writable `org` field, the server still rejects any UID that doesn't match `request.user.org` (via `OrgScopedMixin`) — you cannot plant a row in another tenant by passing a different `org` UID.

---

## Error Responses

All errors follow a consistent shape:

```json
{ "error": "Human readable message" }
```

Standard HTTP status codes:

| Code | Meaning |
|---|---|
| `400` | Bad request / validation error |
| `401` | Missing or invalid token |
| `403` | Insufficient permissions |
| `404` | Resource not found |
| `207` | Partial success (bulk operations) |

---

## Auth Endpoints

### POST `/api/auth/login/`

Login with email or username.

**Auth required:** No

**Request:**
```json
{
  "username": "admin@example.com",
  "password": "Admin123"
}
```

**Response:**
```json
{
  "access": "<jwt_access_token>",
  "refresh": "<jwt_refresh_token>",
  "user": {
    "id": 1,
    "uid": "550e8400-e29b-41d4-a716-446655440000",
    "username": "admin",
    "email": "admin@example.com",
    "full_name": "Admin",
    "role": "admin",
    "avatar_color": "#1e293b",
    "org": "550e8400-...",
    "org_detail": { "id": 1, "uid": "550e8400-...", "name": "Acme Inc" },
    "is_active": true,
    "manager_id": null,
    "manager_ids": [],
    "invoice_access": false,
    "notice_access": false,
    "masters_access": false,
    "attendance_access": false,
    "employee_access": false
  }
}
```

---

### POST `/api/auth/logout/`

Blacklists the refresh token.

**Request:**
```json
{ "refresh": "<jwt_refresh_token>" }
```

**Response:** `{ "ok": true }`

---

### POST `/api/auth/refresh/`

Get a new access token using a refresh token.

**Request:**
```json
{ "refresh": "<jwt_refresh_token>" }
```

**Response:**
```json
{ "access": "<new_access_token>", "refresh": "<new_refresh_token>" }
```

---

### GET `/api/auth/me/`

Returns the currently authenticated user.

**Response:** Same as the `user` object in the login response.

---

## User Management Endpoints

### GET `/api/profiles/`

List all users. Supports `?active=true` / `?active=false` filter.

**Response:**
```json
[
  {
    "id": 1,
    "uid": "550e8400-...",
    "username": "tamil",
    "email": "tamil@tasktracker.local",
    "full_name": "Tamil",
    "role": "employee",
    "avatar_color": "#0ea5e9",
    "org": "550e8400-...",
    "org_detail": { "id": 1, "uid": "550e8400-...", "name": "Acme Inc" },
    "is_active": true,
    "manager_id": "550e8400-...",
    "manager_ids": ["550e8400-..."],
    "invoice_access": false,
    "notice_access": false,
    "masters_access": false,
    "attendance_access": false,
    "employee_access": false
  }
]
```

---

### POST `/api/users/create/`

Create a new user. **Admin only.**

**Request:**
```json
{
  "username": "john",
  "email": "john@example.com",
  "password": "secret123",
  "full_name": "John Doe",
  "role": "employee",
  "avatar_color": "#0ea5e9",
  "org_uid": "550e8400-...",
  "manager_uid": "550e8400-..."
}
```

`avatar_color`, `org_uid`, and `manager_uid` are optional. `avatar_color` must match `^#[0-9a-fA-F]{6}$` if provided.

**Response:** User object (201)

---

### PATCH `/api/users/<user_uid>/`

Update a user's fields. **Admin only.**

**Request (any subset):**
```json
{
  "role": "manager",
  "full_name": "John Smith",
  "username": "jsmith",
  "email": "john@example.com",
  "avatar_color": "#16a34a",
  "is_active": false,
  "invoice_access": true,
  "notice_access": false,
  "masters_access": false,
  "attendance_access": true,
  "employee_access": false,
  "manager_ids": ["550e8400-..."]
}
```

When an `*_access` flag flips **on**, the server records `<flag>_granted_by = request.user` and `<flag>_granted_at = now()`. When it flips **off**, both audit fields are cleared.

**Response:** Updated user object.

---

### POST `/api/users/reset-password/`

Reset a user's password. **Admin only.**

**Request:**
```json
{ "user_uid": "550e8400-...", "new_password": "newpass123" }
```

**Response:** `{ "ok": true }`

---

### POST `/api/users/delete/`

Delete a non-admin user. **Admin only.**

**Request:**
```json
{ "user_uid": "550e8400-..." }
```

**Response:** `{ "ok": true }`

---

### Access Control Lists

Return users who have a specific access flag enabled.

| Endpoint | Description |
|---|---|
| `GET /api/invoice_access/` | Users with invoice access |
| `GET /api/notice_access/` | Users with notice access |
| `GET /api/masters_access/` | Users with masters access |
| `GET /api/attendance_access/` | Users with attendance access |
| `GET /api/employee_access/` | Users with employee access |

**Response:**
```json
[
  {
    "user_id": "550e8400-...",
    "enabled": true,
    "granted_by": "550e8400-...",
    "granted_at": "2026-04-12T10:00:00Z"
  }
]
```

---

## Organisations

**Endpoint:** `/api/orgs/`

Tenant/organisation records. Reads open to any authenticated user, writes are **admin-only**. Looked up by `uid`, not numeric id.

**Response:**
```json
{
  "id": 1,
  "uid": "550e8400-...",
  "name": "Acme Inc",
  "created_at": "2026-04-12T10:00:00Z",
  "updated_at": "2026-04-12T10:00:00Z"
}
```

**Detail URL:** `/api/orgs/<uid>/`

---

## Masters

**Endpoint:** `/api/masters/`

Lookup table for clients, categories, and teams. Organisations are their own first-class table — see `/api/orgs/`.

**Query params:** `?type=client|category|team`

**Response:**
```json
[
  {
    "id": 1,
    "uid": "550e8400-...",
    "name": "Focus",
    "type": "client",
    "color": "",
    "is_active": true,
    "sort_order": 1,
    "org": "550e8400-...",
    "org_uid": "550e8400-...",
    "created_by_uid": "550e8400-...",
    "created_at": "2026-04-12T10:00:00Z",
    "updated_at": "2026-04-12T10:00:00Z"
  }
]
```

**Type values:** `client` `category` `team`

Writable `org` accepts an org `uid`. Uniqueness is enforced on `(type, name, org)` — two tenants can each have an "Acme" client independently.

**Extra actions:**

`DELETE /api/masters/delete_all/` — Delete all masters. **Admin only.**

`POST /api/masters/bulk_upsert/` — Upsert a list of masters. Pass `id` to update an existing record; omit it to create.
```json
[
  { "name": "Focus", "type": "client", "sort_order": 1 },
  { "id": 5, "name": "Updated Name", "type": "client" }
]
```

---

## Tasks

**Endpoint:** `/api/tasks/`

**Visibility:** Admin sees all. Manager sees own + subordinates'. Employee sees own responsible tasks only.

**Response:**
```json
{
  "id": 1,
  "uid": "550e8400-...",
  "serial_no": 1,
  "title": "",
  "description": "GST submission Q1",
  "status": "pending",
  "recurrence": "onetime",
  "target_date": "2026-03-01",
  "expected_date": "2026-03-05",
  "completed_date": null,
  "remarks": "",
  "client": "550e8400-...",
  "client_detail": { "id": 1, "uid": "550e8400-...", "name": "Focus", "type": "client", "color": "" },
  "category": "550e8400-...",
  "category_detail": { "id": 2, "uid": "550e8400-...", "name": "Tax", "type": "category", "color": "" },
  "org": "550e8400-...",
  "org_uid": "550e8400-...",
  "responsible": "550e8400-...",
  "responsible_detail": { "id": 3, "uid": "550e8400-...", "full_name": "Tamil", "username": "tamil" },
  "created_by_detail": { "id": 1, "uid": "550e8400-...", "full_name": "Admin", "username": "admin" },
  "created_at": "2026-04-12T10:00:00Z",
  "updated_at": "2026-04-12T10:00:00Z"
}
```

**Status values:** `pending` `today_task` `tomorrow` `in_progress` `completed` `completed_delay` `overdue` `future_goal` `tbc` `archived`

**Recurrence values:** `onetime` `daily` `weekly` `monthly` `quarterly` `halfyearly` `yearly`

**Writable FK fields:** `client`, `category`, `org`, `responsible` — all accept a uid string.

`description` is required and must be non-empty. `serial_no` is assigned by the server and immutable.

**Extra actions:**

`DELETE /api/tasks/delete_all/` — Delete all tasks. **Admin only.**

`POST /api/tasks/bulk_create/` — Batch create tasks. **Admin only.** Returns `207` if any row fails.
```json
[
  { "description": "Task 1", "status": "pending", "client": "550e8400-..." },
  { "description": "Task 2", "status": "today_task" }
]
```

---

## Task Logs

**Endpoint:** `/api/task_logs/`

Read and create only — no update or delete (audit trail).

**Query params:** `?task_uid=<uid>` or `?task_id=<id>`

**Response:**
```json
{
  "id": 1,
  "changed_by": { "id": 1, "uid": "550e8400-...", "full_name": "Admin", "username": "admin" },
  "changed_by_name": "Admin",
  "changed_at": "2026-04-12T10:00:00Z",
  "changes": [{ "field": "status", "from": "pending", "to": "completed" }]
}
```

`changed_by_name` is a snapshot of the actor's display name taken when the log row was first written — it survives the actor being deleted later. `changes` must be a non-empty list.

---

## Work Logs

**Endpoint:** `/api/work_logs/`

**Visibility:** Admin sees all. Manager sees own + subordinates'. Employee sees own only.

> The `user` field is **auto-set** to the authenticated user on create. Do not send it in the request body.

**Query params:** `?date=YYYY-MM-DD` `?month=YYYY-MM` `?user_uid=<uid>`

**Response:**
```json
{
  "id": 1,
  "uid": "550e8400-...",
  "user_detail": { "id": 3, "uid": "550e8400-...", "full_name": "Tamil", "username": "tamil" },
  "date": "2026-04-12",
  "task_description": "Completed GST filing",
  "hours_worked": "3.50",
  "priority": "Normal",
  "sort_order": 0,
  "client": "550e8400-...",
  "client_detail": { "id": 1, "uid": "550e8400-...", "name": "Focus", "type": "client", "color": "" },
  "org": "550e8400-...",
  "org_uid": "550e8400-...",
  "created_at": "2026-04-12T10:00:00Z",
  "updated_at": "2026-04-12T10:00:00Z"
}
```

**Priority values:** `Top Priority` `Priority` `Normal` `Not Urgent`

`hours_worked` is required and must satisfy `0.01 <= x <= 24`.

**Extra actions:**

`POST /api/work_logs/bulk_import/` — Import many work logs. Returns `207`.
```json
{
  "rows": [
    { "date": "2026-04-10", "task_description": "GST filing", "hours_worked": "3.5", "priority": "Normal" },
    { "date": "2026-04-11", "task_description": "Audit review", "hours_worked": "2" }
  ]
}
```
- Employees are limited by `worklog_backdate_days` (AppSetting, default `7`). Admin and manager skip the backdate check.
- Admins can assign rows to any user by sending `user_uid` on a row; others will have rows assigned to themselves.
- Response shape: `{ "created": N, "failed": M, "results": [...] }`.

`POST /api/work_logs/reorder/` — Update `sort_order` for several rows in one call (for drag-and-drop reordering). Employees can only reorder their own rows.
```json
{
  "rows": [
    { "uid": "550e8400-...", "sort_order": 0 },
    { "uid": "550e8400-...", "sort_order": 1 }
  ]
}
```
Returns `{ "updated": N }`.

---

## Work Plans

**Endpoint:** `/api/work_plans/`

**Visibility:** Admin and manager see all. Employee sees own plans only.

**Query params:** `?date=YYYY-MM-DD` `?user_uid=<uid>`

**Response:**
```json
{
  "id": 1,
  "uid": "550e8400-...",
  "assigned_to_detail": { "id": 3, "uid": "550e8400-...", "full_name": "Tamil", "username": "tamil" },
  "created_by_detail": { "id": 1, "uid": "550e8400-...", "full_name": "Admin", "username": "admin" },
  "date": "2026-04-12",
  "task_description": "Review GST documents",
  "planned_hours": "2.00",
  "client": "550e8400-...",
  "client_detail": { "id": 1, "uid": "550e8400-...", "name": "Focus", "type": "client", "color": "" },
  "org": "550e8400-...",
  "org_uid": "550e8400-...",
  "created_at": "2026-04-12T10:00:00Z",
  "updated_at": "2026-04-12T10:00:00Z"
}
```

`planned_hours` is required and must satisfy `0.01 <= x <= 24`.

---

## Notices

**Endpoint:** `/api/notices/`

**Query params:** `?status=Open|Replied|Appealed|Completed` `?client_uid=<uid>`

**Response:**
```json
{
  "id": 1,
  "uid": "550e8400-...",
  "serial_no": 1,
  "client": "550e8400-...",
  "client_detail": { "id": 1, "uid": "550e8400-...", "name": "Focus", "type": "client", "color": "" },
  "dispute_nature": "GST demand notice",
  "fy": "2024-25",
  "status": "Open",
  "remarks": "",
  "received_date": "2026-01-10",
  "replied_date": null,
  "next_target_date": "2026-02-10",
  "created_by_detail": { "id": 1, "uid": "550e8400-...", "full_name": "Admin", "username": "admin" },
  "created_at": "2026-04-12T10:00:00Z",
  "updated_at": "2026-04-12T10:00:00Z"
}
```

**Status values:** `Open` `Replied` `Appealed` `Completed`

> `received_date` / `replied_date` were previously named `notice_received_date` / `notice_replied_date`.

---

## Leads

### Lead Statuses

**Endpoint:** `/api/lead_statuses/`

```json
{ "id": 1, "name": "Cold", "color": "#64748b", "sort_order": 1, "is_active": true }
```

Default statuses seeded: `Cold` `Warm` `Hot` `Confirmed` `Cancelled`

---

### Leads

**Endpoint:** `/api/leads/`

**Visibility:** Admin and manager see all. Employee sees assigned leads only.

**Query params:** `?status_id=<id>` `?priority=High|Medium|Low`

**Response:**
```json
{
  "id": 1,
  "uid": "550e8400-...",
  "serial_no": 1,
  "client": "550e8400-...",
  "client_detail": { "id": 1, "uid": "550e8400-...", "name": "Focus", "type": "client", "color": "" },
  "contact_person": "John",
  "contact_email": "john@example.com",
  "contact_phone": "+971501234567",
  "lead_source": "Referral",
  "reference_from": "Tamil",
  "status": 1,
  "status_detail": { "id": 1, "name": "Cold", "color": "#64748b", "sort_order": 1 },
  "priority": "Medium",
  "assigned_to": "550e8400-...",
  "assigned_to_detail": { "id": 3, "uid": "550e8400-...", "full_name": "Tamil", "username": "tamil" },
  "estimated_value": "50000.00",
  "action_taken": "",
  "next_step": "Follow up call",
  "next_step_date": "2026-04-20",
  "remarks": "",
  "history": [],
  "created_by_detail": { "id": 1, "uid": "550e8400-...", "full_name": "Admin", "username": "admin" },
  "created_at": "2026-04-12T10:00:00Z",
  "updated_at": "2026-04-12T10:00:00Z"
}
```

**Priority values:** `High` `Medium` `Low`

> `client` and `assigned_to` accept uid strings on write. `status` accepts an integer PK on write. `estimated_value` is required (use `"0"` for unknown).

---

### Lead History

**Endpoint:** `/api/lead_history/`

Append-only log of notes / follow-ups attached to a lead. Previously called `/api/lead_followups/` — renamed for clarity (the data shape is unchanged).

**Query params:** `?lead_uid=<uid>` or `?lead_id=<id>`

**Response:**
```json
{
  "id": 1,
  "uid": "550e8400-...",
  "lead": 1,
  "note": "Called client, interested in audit services",
  "created_by_detail": { "id": 3, "uid": "550e8400-...", "full_name": "Tamil", "username": "tamil" },
  "created_at": "2026-04-12T10:00:00Z",
  "updated_at": "2026-04-12T10:00:00Z"
}
```

---

## Invoices

### Invoice Plans

**Endpoint:** `/api/invoice_plans/`

**Query params:** `?client_uid=<uid>`

**Response:**
```json
{
  "id": 1,
  "uid": "550e8400-...",
  "client": "550e8400-...",
  "client_detail": { "id": 1, "uid": "550e8400-...", "name": "Focus", "type": "client", "color": "" },
  "job_description": "Monthly accounting",
  "periodicity": "Monthly",
  "start_month": "2026-01-01",
  "end_month": "2026-12-01",
  "invoice_day": 1,
  "base_amount": "5000.00",
  "entries": [],
  "created_by_detail": { "id": 1, "uid": "550e8400-...", "full_name": "Admin", "username": "admin" },
  "created_at": "2026-04-12T10:00:00Z",
  "updated_at": "2026-04-12T10:00:00Z"
}
```

**Periodicity values:** `Monthly` `Quarterly` `Half-yearly` `Yearly`

---

### Invoice Entries

**Endpoint:** `/api/invoice_entries/`

**Query params:** `?plan_uid=<uid>` `?status=Pending|Uploaded|Approved|Rejected` `?month=YYYY-MM`

**Response:**
```json
{
  "id": 1,
  "uid": "550e8400-...",
  "invoice_month": "2026-04-01",
  "invoice_date": null,
  "amount": null,
  "status": "Pending",
  "invoice_number": "",
  "notes": "",
  "file_url": "http://localhost:8000/api/files/serve/?token=eyJhbGci...",
  "rejection_reason": "",
  "uploaded_by_detail": null,
  "uploaded_at": null,
  "approved_by_detail": null,
  "approved_at": null,
  "created_at": "2026-04-12T10:00:00Z",
  "updated_at": "2026-04-12T10:00:00Z"
}
```

**Status values:** `Pending` `Uploaded` `Approved` `Rejected`

> `file_url` is a short-lived JWT-signed URL (TTL set by `FILE_SIGNED_URL_TTL`, default 300s). It is regenerated on every response — don't cache it. See [File Downloads](#file-downloads).

**Extra actions:**

`POST /api/invoice_entries/<id>/upload/` — Upload invoice file. Send as multipart form data.
```
file: <binary>
invoice_number: "INV-2026-001"
notes: "April invoice"
```

`POST /api/invoice_entries/<id>/approve/` — Approve entry. **Admin only.**

`POST /api/invoice_entries/<id>/reject/` — Reject entry. **Admin only.**
```json
{ "reason": "Incorrect amount" }
```

`GET /api/invoice_entries/<id>/download/` — Force-download the attached file (returns `Content-Disposition: attachment`).

`POST /api/invoice_entries/generate/` — Create any missing monthly entries for a plan in one call. **Admin only.** Uses `plan.start_month`, `plan.end_month`, and `plan.periodicity` (`Monthly` / `Quarterly` / `Half-yearly` / `Yearly`) to compute the expected months and creates `Pending` entries for any month not already present.
```json
{ "plan_uid": "550e8400-..." }
```
Response:
```json
{
  "plan_uid": "550e8400-...",
  "created": 4,
  "skipped_existing": 2,
  "entries": [{ "id": 10, "uid": "...", "invoice_month": "2026-05-01", "status": "Pending", ... }]
}
```

---

## Chat

### Chat Rooms

**Endpoint:** `/api/chat_rooms/`

Only returns rooms the authenticated user is a member of. The creator is automatically added as a member on room creation.

**Response:**
```json
{
  "id": 1,
  "uid": "550e8400-...",
  "name": "General",
  "type": "group",
  "parent_room": null,
  "members": [
    {
      "id": 1,
      "user_detail": { "id": 1, "uid": "550e8400-...", "full_name": "Admin", "username": "admin" },
      "joined_at": "2026-04-12T10:00:00Z",
      "last_read_at": null
    }
  ],
  "created_by_detail": { "id": 1, "uid": "550e8400-...", "full_name": "Admin", "username": "admin" },
  "created_at": "2026-04-12T10:00:00Z",
  "updated_at": "2026-04-12T10:00:00Z"
}
```

**Type values:** `direct` `group`

**Extra actions:**

`POST /api/chat_rooms/<id>/add_member/`
```json
{ "user_uid": "550e8400-..." }
```

`POST /api/chat_rooms/<id>/mark_read/` — Mark all messages as read for the current user.

`GET /api/chat_rooms/<id>/messages/` — List messages in room. Supports `?since=<ISO datetime>`.

`GET /api/chat_rooms/<id>/members/` — List members of the room.

---

### Chat Members

**Endpoint:** `/api/chat_members/` (read-only)

**Query params:** `?room_uid=<uid>`

---

### Chat Messages

**Endpoint:** `/api/chat_messages/`

**Query params:** `?room_uid=<uid>` `?since=<ISO datetime>`

> `sender` is **auto-set** to the authenticated user on create.

**Response:**
```json
{
  "id": 1,
  "uid": "550e8400-...",
  "room": 1,
  "sender_detail": { "id": 1, "uid": "550e8400-...", "full_name": "Admin", "username": "admin" },
  "message": "Hello team",
  "reply_to": null,
  "file_url": "http://localhost:8000/api/files/serve/?token=eyJhbGci...",
  "file_type": "",
  "file_size": null,
  "is_deleted": false,
  "created_at": "2026-04-12T10:00:00Z",
  "updated_at": "2026-04-12T10:00:00Z"
}
```

> `file_url` is a short-lived signed URL — see [File Downloads](#file-downloads). `DELETE` on a message is a soft-delete: `is_deleted` flips to `true` and `message`/`file` are blanked.

`GET /api/chat_messages/<id>/download/` — Force-download attached file.

---

## Holidays

**Endpoint:** `/api/holidays/`

**Query params:** `?year=2026`

**Response:**
```json
{
  "id": 1,
  "uid": "550e8400-...",
  "name": "New Year",
  "date": "2026-01-01",
  "day": "Thursday",
  "type": "National",
  "created_at": "2026-04-12T10:00:00Z",
  "updated_at": "2026-04-12T10:00:00Z"
}
```

**Type values:** `National` `Regional` `Company`

> `day` is a computed read-only field (e.g., `"Monday"`, `"Thursday"`).

---

## App Settings

**Endpoint:** `/api/app_settings/`

Lookup by key string: `GET /api/app_settings/<key>/`

> `<key>` is the setting's string key, e.g. `worklog_backdate_days` — not a numeric ID.

**Response:**
```json
{
  "id": 1,
  "key": "worklog_backdate_days",
  "value": "7",
  "description": "Max past days an employee may back-date a work log entry.",
  "updated_at": "2026-04-12T10:00:00Z"
}
```

**Extra action:**

`POST /api/app_settings/upsert/` — Create or update a setting by key.
```json
{ "key": "worklog_backdate_days", "value": "14", "description": "Max past days a user can back-date a work log." }
```

Default keys seeded: `worklog_backdate_days`

---

## Employees

**Endpoint:** `/api/employees/`

**Query params:** `?status=Active|Inactive|Resigned`

**Response:**
```json
{
  "id": 1,
  "uid": "550e8400-...",
  "user_detail": { "id": 3, "uid": "550e8400-...", "full_name": "Tamil", "username": "tamil" },
  "employee_name": "Tamil",
  "status": "Active",
  "date_of_joining": "2024-01-01",
  "date_of_birth": "1995-06-15",
  "gender": "Male",
  "blood_group": "O+",
  "marital_status": "Single",
  "father_name": "",
  "phone": "+971501234567",
  "alt_phone": "",
  "email": "tamil@example.com",
  "permanent_address": "",
  "current_address": "",
  "aadhar_number": "",
  "pan_number": "",
  "bank_name": "",
  "bank_account": "",
  "ifsc_code": "",
  "address_proof_url": null,
  "emergency_contact_name": "",
  "emergency_contact_phone": "",
  "emergency_contact_relation": "",
  "reference_name": "",
  "reference_contact": "",
  "reference_relation": "",
  "salary_records": [],
  "created_at": "2026-04-12T10:00:00Z",
  "updated_at": "2026-04-12T10:00:00Z"
}
```

**Status values:** `Active` `Inactive` `Resigned`

**Gender values:** `Male` `Female` `Other`

**Marital status values:** `Single` `Married` `Divorced` `Widowed`

**Format validators** (all applied only when the field is non-empty):

| Field | Regex | Example |
|---|---|---|
| `aadhar_number` | `^\d{12}$` | `123456789012` |
| `pan_number` | `^[A-Z]{5}[0-9]{4}[A-Z]$` | `ABCDE1234F` |
| `ifsc_code` | `^[A-Z]{4}0[A-Z0-9]{6}$` | `HDFC0001234` |

**File uploads** — `address_proof` is a FileField uploaded as multipart form data. `address_proof_url` in the response is a signed URL; see [File Downloads](#file-downloads). Send the file as `address_proof` in the multipart body.

---

### Employee Salary

**Endpoint:** `/api/employee_salary/`

**Query params:** `?employee_uid=<uid>` or `?employee_id=<id>`

**Response:**
```json
{
  "id": 1,
  "designation": "Senior Accountant",
  "department": "Accounts",
  "fixed_salary": "30000.00",
  "basic_salary": "15000.00",
  "hra": "6000.00",
  "da": "3000.00",
  "other_allowances": "6000.00",
  "pf_number": "",
  "esi_number": "",
  "uan_number": "",
  "effective_from": "2024-01-01",
  "effective_to": null,
  "remarks": "",
  "created_at": "2026-04-12T10:00:00Z",
  "updated_at": "2026-04-12T10:00:00Z"
}
```

---

## Attendance

**Endpoint:** `/api/attendance/`

**Visibility:** Admin sees all. Manager sees own + subordinates'. Employee sees own only.

**Query params:** `?month=YYYY-MM` `?date=YYYY-MM-DD` `?user_uid=<uid>`

> `created_by` is **auto-set** to the authenticated user on create.

**Response:**
```json
{
  "id": 1,
  "uid": "550e8400-...",
  "user_detail": { "id": 3, "uid": "550e8400-...", "full_name": "Tamil", "username": "tamil" },
  "date": "2026-04-12",
  "status": "Present",
  "work_location": "Office",
  "login_time": "09:00:00",
  "logout_time": "18:00:00",
  "remarks": "",
  "created_at": "2026-04-12T10:00:00Z",
  "updated_at": "2026-04-12T10:00:00Z"
}
```

**Status values:** `Present` `Absent` `Half Day` `Leave`

**Work location values:** `Office` `WFH` `Client Site` `Field` `Other`

> **Status is orthogonal to location.** To mark a WFH day, send `status="Present"` and `work_location="WFH"`. There is no `"WFH"` status value — it used to exist and was removed to avoid two sources of truth for the same fact.

> The server enforces: `Present` and `Half Day` entries require a `login_time`; `logout_time` must be after `login_time` when both are set.

**Extra actions:**

`POST /api/attendance/quick_punch/` — One-button punch in / out for the current user, for today. Behaviour:
- No row for today → creates one with `status="Present"`, `login_time=now`, `work_location=<user's default or "Office">`.
- Row exists with `login_time` but no `logout_time` → stamps `logout_time=now`.
- Row exists with both times → returns `400 {"error": "already-punched-out"}`.
- Row exists without `login_time` → stamps `login_time=now`.

Returns the attendance object on success. No body required.

`POST /api/attendance/bulk_import/` — Import many attendance rows. Returns `207`.
```json
{
  "rows": [
    { "date": "2026-04-10", "status": "Present", "login_time": "09:00", "work_location": "Office" },
    { "date": "2026-04-11", "status": "Leave", "user_uid": "550e8400-..." }
  ]
}
```
- Employees can only import rows for themselves; managers for self + subordinates; admins for anyone via `user_uid`.
- Employees are further limited by `attendance_backdate_days` (AppSetting, default `7`). Admin/manager skip the backdate check.
- Response shape: `{ "created": N, "failed": M, "results": [{ "index": i, "status": 201|400|403, ... }] }`.

---

## Growth Plans

**Endpoint:** `/api/growth_plans/`

**Visibility:** Admin and manager see all. Employee sees assigned plans only.

**Query params:** `?status=Open|Under Progress|Completed|On Hold|Cancelled` `?priority=High|Medium|Low`

**Response:**
```json
{
  "id": 1,
  "uid": "550e8400-...",
  "activity": "Expand into new market segment",
  "target_month": "2026-06-01",
  "steps_taken": "",
  "steps_to_take": "Research, outreach, proposal",
  "status": "Open",
  "priority": "High",
  "remarks": "",
  "assigned_to": "550e8400-...",
  "assigned_to_detail": { "id": 3, "uid": "550e8400-...", "full_name": "Tamil", "username": "tamil" },
  "created_by_detail": { "id": 1, "uid": "550e8400-...", "full_name": "Admin", "username": "admin" },
  "created_at": "2026-04-12T10:00:00Z",
  "updated_at": "2026-04-12T10:00:00Z"
}
```

**Status values:** `Open` `Under Progress` `Completed` `On Hold` `Cancelled`

**Priority values:** `High` `Medium` `Low`

---

## PACE (goals, reviews, meetings, checklist)

The PACE module covers personal growth goals, goal reviews, team meetings, a weekly checklist, and per-client classifications. All endpoints are tenant-scoped.

### Pace Goals

**Endpoint:** `/api/pace_goals/`

**Visibility:** Admin sees all. Manager sees own + subordinates' goals. Employee sees own only.

**Query params:** `?profile_uid=<uid>` `?goal_type=<value>` `?status=<value>` `?priority=<value>`

**Response:**
```json
{
  "id": 1,
  "uid": "550e8400-...",
  "profile": "550e8400-...",
  "profile_detail": { "id": 3, "uid": "550e8400-...", "full_name": "Tamil", "username": "tamil" },
  "goal_type": "professional",
  "title": "Lead an audit engagement",
  "description": "",
  "status": "Open",
  "priority": "High",
  "current_rating": 3,
  "target_rating": 5,
  "success_criteria": "Sign-off from partner",
  "frequency": "Weekly",
  "target": "",
  "tracking_method": "",
  "learning_action": "",
  "completion_by": "2026-06-30",
  "iceberg_level": "",
  "focus_area": "",
  "daily_practice": "",
  "org": "550e8400-...",
  "org_uid": "550e8400-...",
  "created_by_detail": { "id": 1, "uid": "550e8400-...", "full_name": "Admin", "username": "admin" },
  "created_at": "2026-04-12T10:00:00Z",
  "updated_at": "2026-04-12T10:00:00Z"
}
```

> `profile` defaults to the caller on create when omitted. Managers can only create/update goals for themselves or their subordinates.

**Extra actions:**

`POST /api/pace_goals/bulk_create/` — Batch create goals. **Admin only.** Returns `207`.
```json
[
  { "title": "Goal 1", "profile": "550e8400-...", "goal_type": "professional", "priority": "High" },
  { "title": "Goal 2", "goal_type": "personal" }
]
```

---

### Pace Goal Reviews

**Endpoint:** `/api/pace_goal_reviews/`

Read and create only — reviews are append-only (no update/delete). Creating a review also updates the parent goal's `current_rating` to the new rating.

**Query params:** `?goal_uid=<uid>` or `?goal_id=<id>`

**Request:**
```json
{
  "goal": "550e8400-...",
  "review_date": "2026-04-15",
  "previous_rating": 3,
  "new_rating": 4,
  "reviewer_name": "Admin",
  "comments": "Strong progress on audit exposure."
}
```

> `reviewer_name` defaults to the caller's display name when omitted. `reviewed_by` is auto-set to the caller.

---

### Pace Meetings

**Endpoint:** `/api/pace_meetings/`

**Query params:** `?meeting_type=<value>` `?status=<value>` `?date_from=YYYY-MM-DD` `?date_to=YYYY-MM-DD` `?month=YYYY-MM`

**Response:**
```json
{
  "id": 1,
  "uid": "550e8400-...",
  "title": "Monthly team sync",
  "meeting_type": "team",
  "scheduled_date": "2026-05-01",
  "scheduled_time": "10:00:00",
  "duration_minutes": 60,
  "status": "Scheduled",
  "agenda": "",
  "minutes": "",
  "attendees": [],
  "action_items": [],
  "conducted_by": "",
  "org": "550e8400-...",
  "org_uid": "550e8400-...",
  "created_by_detail": { "id": 1, "uid": "550e8400-...", "full_name": "Admin", "username": "admin" },
  "created_at": "2026-04-12T10:00:00Z",
  "updated_at": "2026-04-12T10:00:00Z"
}
```

---

### Pace Checklist

**Endpoint:** `/api/pace_checklist/`

Per-week action-item checklist. Unique on `(org, fy, week_number, item_number)`.

**Query params:** `?fy=YYYY-YY` `?week_number=<int>`

**Response:**
```json
{
  "id": 1,
  "uid": "550e8400-...",
  "fy": "2026-27",
  "week_number": 16,
  "item_number": 1,
  "action_item": "Review pipeline",
  "done": false,
  "notes": "",
  "org": "550e8400-...",
  "org_uid": "550e8400-...",
  "updated_by_detail": { "id": 1, "uid": "550e8400-...", "full_name": "Admin", "username": "admin" },
  "created_at": "2026-04-12T10:00:00Z",
  "updated_at": "2026-04-12T10:00:00Z"
}
```

> `fy` must match `^\d{4}-\d{2}$` (e.g. `2026-27`). Duplicate `(fy, week_number, item_number)` on create returns `400`.

---

### Client Classifications

**Endpoint:** `/api/client_classifications/`

One-row-per-client classification used for PACE prioritisation. No DELETE (history is kept — create/update only).

**Query params:** `?client_uid=<uid>`

**Response:**
```json
{
  "id": 1,
  "uid": "550e8400-...",
  "client": "550e8400-...",
  "client_detail": { "id": 1, "uid": "550e8400-...", "name": "Focus", "type": "client", "color": "" },
  "classification": "A",
  "revenue_tier": "High",
  "strategic_importance": "High",
  "relationship_health": "Healthy",
  "growth_potential": "High",
  "risk_level": "Low",
  "notes": "",
  "org": "550e8400-...",
  "org_uid": "550e8400-...",
  "updated_by_detail": { "id": 1, "uid": "550e8400-...", "full_name": "Admin", "username": "admin" },
  "created_at": "2026-04-12T10:00:00Z",
  "updated_at": "2026-04-12T10:00:00Z"
}
```

**Extra actions:**

`POST /api/client_classifications/upsert/` — Create-or-update by client. Use this instead of POST/PATCH when you just want to "set the current classification for this client":
```json
{
  "client": "550e8400-...",
  "classification": "A",
  "revenue_tier": "High",
  "relationship_health": "Healthy"
}
```
Returns `201` on insert, `200` on update.

---

## Backup / Restore (admin)

Throttled per user: export 5/hr, restore 2/hr.

### GET `/api/backup/`

Admin-only. Dumps the caller's tenant into a single JSON document.

| Query param | Purpose |
|---|---|
| `resources` | CSV of resource keys to include (e.g. `tasks,worklog,chat_messages`). Defaults to all. |
| `counts_only` | `true` returns just `{ counts, total_rows, max_export_rows }` with no row data — use as a preflight. |
| `include_soft_deleted` | `true` includes soft-deleted chat messages. |

Responses:
- `200 OK` — `{ schema_version, generated_at, generated_by, counts, resources: { ... } }`
- `413 Payload Too Large` — `{ error: "export-too-large", total_rows, max_export_rows, counts, hint }` when the full dump exceeds 200 000 rows. Use `?resources=` to slice, or `?counts_only=true` to inspect sizes first.

### POST `/api/backup/restore/`

Admin-only. Body must include `{ "confirm": true, ...export payload... }`. See [`docs/backup_restore_api.md`](./docs/backup_restore_api.md) for modes (`upsert` / `replace`) and per-resource error limits.

---

## Audit Logs (admin)

Append-only audit trail written by server-side code via `core.audit.models.log(...)`. There is **no** write API — admins read only.

### GET `/api/audit-logs/`

- **Auth:** admin.
- **Scope:** rows are automatically filtered to the caller's `org`.
- **Pagination:** `page` + `page_size` (default 50, max 200).

| Query param | Purpose |
|---|---|
| `action` | Exact match on action string (e.g. `backup.export`, `backup.restore`). |
| `resource_type` | Exact match (e.g. `backup`, `task`). |
| `resource_id` | Exact match on the stringified resource identifier. |
| `actor_uid` | Filter by the acting user's UID. |
| `since` | ISO 8601 timestamp — rows at or after this time. |
| `until` | ISO 8601 timestamp — rows strictly before this time. |

Response shape:

```json
{
  "count": 124,
  "next": "http://.../api/audit-logs/?page=2",
  "previous": null,
  "results": [
    {
      "id": 512,
      "actor_detail": { "id": 4, "uid": "…", "full_name": "Jane", "username": "jane", "avatar_color": "" },
      "org_uid": "…",
      "action": "backup.export",
      "resource_type": "backup",
      "resource_id": "",
      "changes": { "counts": { "tasks": 120, "worklog": 430 }, "include_soft_deleted": false },
      "ip_address": "10.0.0.4",
      "created_at": "2026-04-17T10:12:00Z"
    }
  ]
}
```

### GET `/api/audit-logs/<id>/`

Retrieve a single audit entry by its numeric id.

---

## File Downloads

Uploaded files (invoice PDFs, chat attachments, `Employee.address_proof`) are never served via a predictable `/media/...` path. Instead, every `*_url` field in a response is a short-lived JWT-signed URL:

```
http://localhost:8000/api/files/serve/?token=...
```

**Endpoint:** `GET /api/files/serve/?token=<jwt>`

- **Auth:** none — the token **is** the auth. Anyone who holds an unexpired token can fetch the file. Treat the URL itself as a bearer credential and don't log it.
- **Token lifetime:** `FILE_SIGNED_URL_TTL` seconds (default 300). Expired tokens return `410 Gone`. Malformed tokens return `400 Bad Request`. Missing file returns `404`.
- **When to fetch:** call the API endpoint that owns the file first (e.g. `GET /api/invoice_entries/<id>/`), then use the `file_url` / `address_proof_url` returned in the body. Don't cache the URL — fetch a fresh one for each user action.

**Swapping to S3:** set `FILE_STORAGE_BACKEND=s3` and configure `django-storages`. The same `file_url` helper will return a presigned S3 URL instead, no API shape change.

---

## Realtime

The Django Channels WebSocket endpoint is at `ws://<host>/ws/`. Authenticated clients send a subscribe frame:

```json
{ "action": "subscribe", "channel": "leads" }
```

and receive broadcast events for create/update/delete on that channel:

```json
{ "channel": "leads", "event": "INSERT", "record": { ...LeadSerializer payload... } }
```

Known channels: `tasks`, `leads`, `lead-statuses`, `notices`, `invoice-plans`, `invoice-entries`. Use `action: "unsubscribe"` with the same `channel` to stop.

---

## Django Admin

Available at `/admin/`. All models are registered with search, filters, and inline editing.

Default admin credentials after seeding:
- **Email:** `safycosting@gmail.com`
- **Password:** `Admin123`
