# Client Management Module — Design

**Date:** 2026-04-21
**Branch:** `Client_Mgmt_Tab`
**Status:** Approved by user, pending written-spec review

## 1. Goal

Add a new top-level **Clients** tab that lets admins and managers track, per client:

1. **Road Map** — the deliverables / commitments we owe the client, with owners, target dates and status.
2. **MOM (Minutes of Meeting)** — a record of every client meeting (date, attendees, agenda, minutes, attachments) with a structured **Action Points** list attached to each meeting. Each action point has a responsible person, target date, completion date, status and priority.

The module is a monitoring tool for post-sale client delivery work. It is distinct from the existing **Pace** app, which is for internal team reviews and does not involve clients.

## 2. Non-goals (out of scope for v1)

- Change history / audit log (beyond `created_at` / `updated_at`)
- Email / push notifications and reminders
- Recurring meeting scheduling
- Client portal / external access — this is internal-only
- Migrating any data out of `pace.PaceMeeting` or `pace.ClientClassification`

## 3. Placement

### Django app

All new models live in `core/masters/` (no new app). Rationale: the `Client` record is already a `masters.Master` row with `type="client"`, so keeping roadmap / meetings / action points in the same app keeps all client-anchored data in one place and matches user guidance ("no new app required").

### Frontend navigation

New top-level nav item **Clients** in `Header.tsx`, registered as view key `"clients"` in `App.tsx`. The page has two sub-tabs — **Road Map** and **MOM & Action Points** — plus a persistent overdue-action-points card at the top.

## 4. Data model

All models extend `core.base.TimeStampedModel` (gives `created_at`, `updated_at`). All are org-scoped via a nullable `FK users.Org` (matches the pattern used by `Lead`, `PaceMeeting`, etc.). All expose a `uid = UUIDField(unique=True)` for API URLs.

### 4.1 `ClientRoadmap`

Flat list of deliverables owned by an internal person, per client.

| Field | Type | Notes |
|---|---|---|
| `uid` | UUID | API id |
| `org` | FK `users.Org` (nullable, SET_NULL) | Org scope |
| `client` | FK `masters.Master` (nullable, SET_NULL, `limit_choices_to={"type": "client"}`) | The client |
| `title` | Char(255) | Short headline |
| `description` | Text (blank) | Details |
| `owner` | FK `AUTH_USER_MODEL` (nullable, SET_NULL) | Internal responsible person |
| `target_date` | Date (nullable) | |
| `completion_date` | Date (nullable) | Filled when status becomes Achieved |
| `status` | Char(20), choices | `Not Started` / `In Progress` / `Achieved` / `At Risk` / `Cancelled`. Default `Not Started`. |
| `priority` | Char(10), choices | `High` / `Medium` / `Low`. Default `Medium`. |
| `progress_notes` | Text (blank) | Latest progress commentary |
| `category` | Char(100), blank | Free text (e.g. "Compliance", "Growth") |
| `created_by` | FK `AUTH_USER_MODEL` (nullable, SET_NULL) | |

**Meta:** `ordering = ["-created_at"]`; indexes on `client`, `status`, `target_date`.

### 4.2 `ClientMeeting`

One row per client meeting (MOM header).

| Field | Type | Notes |
|---|---|---|
| `uid` | UUID | |
| `org` | FK `users.Org` (nullable, SET_NULL) | |
| `client` | FK `masters.Master` (nullable, SET_NULL, `limit_choices_to={"type": "client"}`) | |
| `meeting_date` | Date | Required. Indexed. |
| `meeting_time` | Time (nullable) | |
| `meeting_type` | Char(20), choices | `Review` / `Kickoff` / `Escalation` / `Strategic` / `Ad-hoc`. Default `Review`. |
| `mode` | Char(20), choices | `In-person` / `Video` / `Phone`. Default `Video`. |
| `venue` | Char(255), blank | Free text (office name, meeting link, etc.) |
| `conducted_by` | FK `AUTH_USER_MODEL` (nullable, SET_NULL) | Internal chair |
| `our_attendees` | M2M `AUTH_USER_MODEL` (blank) | Internal attendees |
| `client_attendees` | JSONField (default list, blank) | List of `{name, designation, email}` dicts — clients aren't users |
| `agenda` | Text (blank) | |
| `minutes` | Text (blank) | Plain text for v1 (no rich-text editor yet) |
| `next_meeting_date` | Date (nullable) | Optional follow-up date |
| `created_by` | FK `AUTH_USER_MODEL` (nullable, SET_NULL) | |

**Meta:** `ordering = ["-meeting_date", "-created_at"]`; indexes on `client`, `meeting_date`.

### 4.3 `ClientActionPoint`

Nested rows attached to a `ClientMeeting`. `on_delete=CASCADE` — deleting a meeting removes its action points.

| Field | Type | Notes |
|---|---|---|
| `uid` | UUID | |
| `meeting` | FK `ClientMeeting` (CASCADE) | Parent meeting |
| `description` | Text | Required |
| `responsibility` | FK `AUTH_USER_MODEL` (nullable, SET_NULL) | Internal owner |
| `target_date` | Date (nullable) | |
| `completion_date` | Date (nullable) | Filled when status becomes Completed |
| `status` | Char(20), choices | `Open` / `In Progress` / `Completed` / `Cancelled`. Default `Open`. Indexed. |
| `priority` | Char(10), choices | `High` / `Medium` / `Low`. Default `Medium`. |
| `remarks` | Text (blank) | |
| `roadmap_link` | FK `ClientRoadmap` (nullable, SET_NULL) | Optional — links this action to a larger roadmap goal |

**Meta:** `ordering = ["target_date", "-created_at"]`; indexes on `meeting`, `status`, `target_date`.

Helper property: `is_overdue` = `status != "Completed" and status != "Cancelled" and target_date < today`.

### 4.4 `ClientMeetingAttachment`

Simple file store per meeting, using Django's `FileField` (not piggybacked on `filestore` — keeps the data model self-contained).

| Field | Type | Notes |
|---|---|---|
| `uid` | UUID | |
| `meeting` | FK `ClientMeeting` (CASCADE) | |
| `file` | FileField (`upload_to="client_meetings/%Y/%m/"`) | |
| `filename` | Char(255) | Original filename for display |
| `size_bytes` | PositiveIntegerField | For list display |
| `uploaded_by` | FK `AUTH_USER_MODEL` (nullable, SET_NULL) | |
| `uploaded_at` | DateTime (auto_now_add) | |

**Meta:** `ordering = ["-uploaded_at"]`.

## 5. API

All endpoints are under `/api/` and added via `core/masters/urls.py` (extending the existing router). ViewSets follow the patterns used by `core/leads/views.py` and `core/pace/views.py`:

- Org-scoping is enforced by reusing `core.org_utils` helpers already used in leads/pace.
- Write operations (POST / PATCH / PUT / DELETE) require **admin or manager** role in the caller's org. Read is available to any org member.

| Route | Method | Purpose |
|---|---|---|
| `/api/client-roadmap/` | GET, POST | List (filterable by `client`, `status`, `owner`, `overdue=true`), create |
| `/api/client-roadmap/{uid}/` | GET, PATCH, DELETE | Detail / update / delete |
| `/api/client-meetings/` | GET, POST | List (filterable by `client`, date range), create. Detail serializer nests `action_points` and `attachments`. |
| `/api/client-meetings/{uid}/` | GET, PATCH, DELETE | Detail / update / delete |
| `/api/client-meetings/{uid}/action-points/` | POST | Add an action point to this meeting |
| `/api/client-meetings/{uid}/attachments/` | POST (multipart), GET | Upload file / list attachments |
| `/api/client-action-points/{uid}/` | PATCH, DELETE | Update / delete a single action point |
| `/api/client-attachments/{uid}/` | DELETE | Delete a single attachment |
| `/api/client-action-points/overdue/` | GET | All overdue action points across clients for the caller's org, grouped by client in response payload |

**Serializers:**

- `ClientRoadmapSerializer` — flat.
- `ClientMeetingSerializer` — includes nested `action_points` (read-only nested write via the action-points endpoint) and `attachments` (read-only list of `{uid, filename, size_bytes, uploaded_at, download_url}`).
- `ClientActionPointSerializer`, `ClientMeetingAttachmentSerializer` — flat.

Realtime: emit existing-style broadcast events on create/update/delete for `client-roadmap`, `client-meetings`, `client-action-points` so other open tabs refresh (follow the `core/realtime.py` pattern already used by leads).

## 6. Permissions

Reuse the permission classes already defined in `core/permissions.py` — no new classes needed.

- **Backend:** each new viewset uses `permission_classes = [IsAuthenticated, IsAdminOrManagerInAny, PerOrgManager]`. The list-level gate `IsAdminOrManagerInAny` ensures the caller is an admin or manager in at least one org (so non-privileged users can still `GET`); the object-level gate `PerOrgManager` ensures write methods only succeed if the caller is admin/manager in the specific `obj.org`. Read methods fall through `SAFE_METHODS` and remain open to any authenticated org member whose queryset already filters by their org membership (same pattern as leads/pace).
- **Frontend:** `ClientsPage` uses `useAuth().isAdminInAny()` / `isManagerInAny()` to gate Add / Edit / Delete UI. Non-privileged users see a read-only view.

## 7. Frontend

### 7.1 Routing & navigation

- Add `const ClientsPage = lazy(() => import("./pages/ClientsPage"));` in `App.tsx`.
- Register `clients` in the `VIEW_MAP` with the same admin/manager-only props plumbing used by other pages.
- Add a **Clients** nav button + icon to `Header.tsx` alongside Leads / Pace.

### 7.2 Page structure (`ClientsPage.tsx`)

```
┌─────────────────────────────────────────────────────────────┐
│  Client selector  [▼ Acme Corp]        [ ⚠ 7 overdue →  ]   │  ← top strip
├─────────────────────────────────────────────────────────────┤
│  [ Road Map ]  [ MOM & Action Points ]                      │  ← sub-tab bar
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                       <active tab content>                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

- Client selector reuses the existing `useMasters` clients list.
- Overdue card is a button with the red-warning styling already used elsewhere; clicking it switches the view to a cross-client **Overdue Action Points** list (grouped by client), regardless of which client is currently selected.

### 7.3 Road Map tab

- Table columns: **Title · Owner · Category · Target · Completion · Status · Priority · Progress Notes · Actions**.
- Filters above the table: status, priority, owner, overdue-only toggle.
- **Add Roadmap** button opens a modal. Edit uses the same modal pre-filled.
- Admin / manager: see Edit + Delete row actions. Others see a read-only table.

### 7.4 MOM tab

- Left: vertical list of meetings for the selected client, newest first, showing date + type.
- Right: selected meeting detail, with sections:
  - **Header** — date, time, type, mode, venue, conducted by, next meeting date
  - **Attendees** — ours (chips of user names) + theirs (list of `{name, designation, email}`)
  - **Agenda** / **Minutes** (text)
  - **Attachments** — upload button + list with download links + delete (admin/manager only)
  - **Action Points** — inline-editable table (Description · Responsibility · Target · Completion · Status · Priority · Linked Roadmap · Remarks) with Add row at the bottom

- **New Meeting** button at the top of the list opens a modal to create the meeting header; action points and attachments are added after creation.

### 7.5 Overdue Action Points card / view

- Card shows count of action points where `status not in (Completed, Cancelled)` and `target_date < today` for the caller's org.
- Clicking opens a modal or inline panel listing all overdue action points grouped by client, each row linking straight to the parent meeting.

## 8. File organisation

```
core/masters/
  models.py                (+ ClientRoadmap, ClientMeeting, ClientActionPoint, ClientMeetingAttachment)
  serializers.py           (+ 4 serializers)
  views.py                 (+ 4 viewsets + overdue endpoint)
  urls.py                  (+ router registrations)
  admin.py                 (+ admin registrations)
  migrations/              (+ new migration)

frontend/task-tracker/src/
  pages/ClientsPage.tsx                             (new)
  components/clients/ClientRoadmapTab.tsx           (new)
  components/clients/ClientRoadmapModal.tsx         (new)
  components/clients/ClientMOMTab.tsx               (new)
  components/clients/ClientMeetingModal.tsx         (new)
  components/clients/ClientActionPointsTable.tsx    (new)
  components/clients/ClientMeetingAttachments.tsx   (new)
  components/clients/OverdueActionPointsPanel.tsx   (new)
  hooks/useClientRoadmap.ts                         (new)
  hooks/useClientMeetings.ts                        (new)
  types/api/clients.ts                              (new DTOs)
  App.tsx                                           (register view)
  components/layout/Header.tsx                      (nav item + icon)
```

## 9. Testing

- **Backend:** `core/masters/tests.py` — CRUD happy paths per model, permission checks (viewer vs admin/manager), overdue endpoint correctness, cascade behaviour on meeting delete.
- **Frontend:** minimal smoke test of `ClientsPage` rendering with a mocked client + one meeting + one action point.

## 10. Migration & rollout

- One new Django migration adds all four tables.
- No data migration needed — this is greenfield.
- Deploy: run migrate, rebuild frontend, restart server. Feature-flag not needed.

## 11. Open items (resolved before implementation)

All design questions have been answered during brainstorming:

- Models in `core/masters/` — **confirmed**.
- New top-level nav tab "Clients" (not a sub-tab under Pace) — **confirmed**.
- Attachments on MOM — **included**.
- Admins + managers can edit — **included**.
- Overdue action points surface — **included as dashboard card + panel**.
