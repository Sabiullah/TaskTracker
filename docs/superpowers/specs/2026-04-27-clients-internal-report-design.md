# Clients — Internal Report tab

## Goal

Add a third sub-tab — **Internal Report** — to the **Clients** page so junior
team members can submit observation reports after a client visit, route them
through a manager approval workflow, and track delivery to the client (sent
date + voice-note tick). Sits alongside the existing **Road Map** and
**MOM & Action Points** sub-tabs.

## Motivation

Today, observations from on-site client visits live in chat threads / emails
and there is no system of record for: (a) who visited which client when,
(b) what they observed, (c) whether a manager has reviewed it, or (d) whether
the cleaned-up report was actually delivered to the client. Without this, the
team cannot enforce the SLA of "observation must reach the client within one
day of the visit" and rejections / revisions are invisible.

## Scope

In:

- A new sub-tab `📝 Internal Report` on `ClientsPage.tsx`.
- Three new Django models in `core/masters/`: `ClientVisit`, `VisitReport`,
  `VisitReportAuditEvent`.
- Two new DRF viewsets (`ClientVisitViewSet`, `VisitReportViewSet`) plus a
  read-only `VisitReportAuditEventViewSet`, with custom actions for the
  lifecycle (`submit`, `approve`, `reject`, `resubmit`, `sent-info`).
- React UI mirroring the MOM tab: grouped by client, descending visit_date,
  filter bar, expandable row showing revisions + post-approval panel +
  audit timeline.
- In-app toast notifications via the existing `lib/toast.ts` + a new
  directed `notifications` realtime channel — no email, no scheduler.
- Computed-on-read overdue badge + page-header counter (no cron).

Out (deferred for later):

- Email notifications.
- A scheduled job that pushes overdue nudges (chose computed-on-read in
  Section "Notifications").
- Bulk approve / reject.
- Soft-delete / archive of visits.
- Multiple observation files per revision (one file, replace-on-upload).
- Cross-tab badge counts on the page-header sub-tab strip.
- Linking a visit report to a specific MOM action point — this is a
  *visit-level* report, not action-point-level.

## Decisions log

These were resolved during brainstorming before this spec was written. They
exist as a single block here so the implementer can reference them without
hunting through chat history.

1. **Manager assignment.** Junior **picks** the manager at submission time
   from a dropdown of the org's admins/managers (no auto-assignment, no
   reporting-line lookup).
2. **Editing while pending.** Junior **can edit freely** while status is
   `Draft` or `Pending`. They cannot withdraw a `Pending` submission — the
   manager must act.
3. **Resubmission shape.** A reject creates the need for a **new row**, not
   an edit-in-place — so revision count is visible (`#1 Rejected`,
   `#2 Approved`). Modeled as a parent `ClientVisit` + many `VisitReport`
   revisions.
4. **Visibility rule.** Only the **author + assigned manager + org admins**
   can view a report. Other juniors / other managers (not assigned) cannot.
5. **Voice note.** A **checkbox + free-text summary** field. No file
   upload, no link field.
6. **Overdue rule.** A visit becomes overdue when the **manager has not
   entered `report_sent_date` by end of `visit_date + 1` calendar day**.
   All days count, weekends included.
7. **Audit log UI.** A **timeline panel** under each visit, showing the
   full chain (Created → Submitted → Rejected with comment → Resubmitted
   #2 → Approved → Sent → Voice note ✓).
8. **Notifications.** **Required** for v1. In-app toast only (use existing
   infra). No email, no cron.
9. **Post-approval edits.** `report_sent_date` and voice-note fields are
   **editable** by the manager after approval. The report content
   (`key_points`, `observation_attachment`) is **frozen** on approval.
10. **Page architecture.** **Approach A** — single unified table grouped by
    client (matches MOM tab), with role-aware action buttons + a
    `Pending my approval` quick-toggle for managers.

## Design

### Data model

Three new models in `core/masters/models.py`, alongside `ClientMeeting`.

#### `ClientVisit` (parent — one per visit)

| Field | Type | Notes |
|---|---|---|
| `uid` | `UUIDField` | unique, indexed |
| `org` | `FK users.Org`, nullable, `SET_NULL` | scoping |
| `client` | `FK Master`, `limit_choices_to={'type': 'client'}` | the client visited |
| `visit_date` | `DateField`, indexed | drives overdue clock |
| `prepared_by` | `FK User`, `SET_NULL` | the junior who did the visit |
| `assigned_manager` | `FK User`, `SET_NULL` | manager picked at submission (must be admin/manager of org) |
| `current_status` | `CharField(20)`, choices `Draft / Pending / Approved / Rejected`, indexed | denormalized: mirrors the latest `VisitReport.status` |
| `report_sent_date` | `DateField`, nullable | manager fills after approval |
| `voice_note_sent` | `BooleanField`, default `False` | tick-box |
| `voice_note_summary` | `TextField`, blank, default "" | free-text |
| `created_by` | `FK User`, `SET_NULL` | typically `= prepared_by` |
| `created_at` / `updated_at` | inherited from `TimeStampedModel` | |

Indexes:

- `(client, visit_date)` — for the grouped-by-client / descending-date list.
- `(org, report_sent_date, visit_date)` — for the overdue filter.
- `(org, current_status)` — for the status filter.

Ordering: `["-visit_date", "-created_at"]`.

#### `VisitReport` (child — one row per attempt)

| Field | Type | Notes |
|---|---|---|
| `uid` | `UUIDField` | unique, indexed |
| `visit` | `FK ClientVisit`, `CASCADE`, `related_name="reports"` | |
| `revision_number` | `PositiveIntegerField` | 1, 2, 3… auto-assigned per visit |
| `key_points` | `TextField` | manual entry by junior |
| `observation_attachment` | `FileField(upload_to="client_visits/%Y/%m/")` | one file per revision |
| `attachment_filename` | `CharField(255)` | mirrors `ClientMeetingAttachment` |
| `attachment_size_bytes` | `PositiveBigIntegerField`, default 0 | |
| `status` | `CharField(20)`, choices `Draft / Pending / Approved / Rejected` | |
| `submitted_at` | `DateTimeField`, nullable | set when junior calls `submit` |
| `reviewed_at` | `DateTimeField`, nullable | set when manager calls `approve` / `reject` |
| `reviewed_by` | `FK User`, `SET_NULL` | the manager who acted |
| `manager_comment` | `TextField`, blank, default "" | required when rejecting |
| `created_by` | `FK User`, `SET_NULL` | the junior |

Constraints:

- `unique_together = (visit, revision_number)`.
- `revision_number >= 1` (`CheckConstraint`).

Ordering: `["visit", "revision_number"]`.

#### `VisitReportAuditEvent` (timeline log — append-only)

| Field | Type | Notes |
|---|---|---|
| `uid` | `UUIDField` | |
| `visit` | `FK ClientVisit`, `CASCADE`, `related_name="audit_events"` | timeline lives on the visit, spans all revisions |
| `report` | `FK VisitReport`, `SET_NULL`, nullable | which revision triggered the event (null for visit-level events like `sent_to_client`) |
| `event_type` | `CharField(30)`, choices below | |
| `actor` | `FK User`, `SET_NULL` | who performed the action |
| `comment` | `TextField`, blank, default "" | manager comment on reject; optional context otherwise |
| `created_at` | `DateTimeField`, `auto_now_add=True` | |

`event_type` choices:

`created`, `submitted`, `approved`, `rejected`, `resubmitted`,
`sent_to_client`, `voice_note_marked`.

Audit events are **created server-side inside the same transaction as the
state change**. They are never written from the client.

Ordering: `["visit", "created_at"]`.

#### Why this shape

- `ClientVisit` separates "the visit happened" (immutable, drives overdue)
  from "the team's attempts to write it up" (`VisitReport` revisions).
  Post-approval fields belong naturally to the visit, not to a specific
  attempt.
- `current_status` is denormalized so list queries don't need a window
  function to find the latest report's status. Updated inside the same
  transaction whenever any `VisitReport.status` changes (in the API action
  handlers, not in `save()` — see "State machine" below).
- `revision_number` makes "rejected N times" trivial:
  `visit.reports.count() - 1` if the latest is approved, else
  `visit.reports.filter(status='Rejected').count()`.

### State machine

State lives on `VisitReport.status`. Mirrored to `ClientVisit.current_status`
inside the same transaction.

```
                            ┌──────────┐
   junior creates visit ──▶ │  Draft   │ (rev #1)
                            └────┬─────┘
                                 │ submit
                                 ▼
                            ┌──────────┐    approve     ┌──────────┐
                            │ Pending  │ ─────────────▶ │ Approved │ (terminal for the report)
                            └────┬─────┘                └──────────┘
                                 │ reject (comment required)
                                 ▼
                            ┌──────────┐
                            │ Rejected │  ◀── frozen, kept in history
                            └────┬─────┘
                                 │ junior clicks "Resubmit"
                                 │ → creates NEW VisitReport (rev #2) in Draft
                                 ▼
                            ┌──────────┐
                            │  Draft   │ (rev #2) ──▶ submit ──▶ Pending ──▶ ...
                            └──────────┘
```

#### Actor → action matrix

| Actor | Draft (latest rev) | Pending (latest rev) | Approved (terminal) | Rejected (latest rev) |
|---|---|---|---|---|
| **Junior (= author)** | Edit fields, upload/replace attachment, **Submit** | Edit fields, upload/replace attachment | View only | **Resubmit** → new revision in `Draft` |
| **Assigned manager** | View only | **Approve** / **Reject** (comment required) | Edit `report_sent_date`, `voice_note_sent`, `voice_note_summary` | View only |
| **Other admin (same org)** | View only | **Approve** / **Reject** (admin override) | Edit sent-date / voice-note fields | View only |
| **Other manager (same org)** | View only | View only (cannot approve someone else's assignment) | View only | View only |
| **Other juniors (same org)** | No access | No access | No access | No access |

#### Server-side invariants (enforced)

1. **Only one non-terminal report per visit.** Cannot create a new revision
   unless the latest is `Rejected`. Enforced in the `resubmit` action —
   errors with 400 if latest is in any other state.
2. **Reject requires `manager_comment`.** Validated in the `reject` action
   (non-empty after strip).
3. **Approving freezes report content.** After `status = Approved`, PATCH
   on `VisitReport` rejects edits to `key_points` / `observation_attachment`
   with 403.
4. **`report_sent_date` and voice-note fields are only writable when the
   visit has an Approved report.** `PATCH /sent-info/` returns 400 otherwise.
5. **Audit event is written in the same transaction as every state change.**
   Wrapped in `transaction.atomic()`.
6. **`current_status` mirror is updated** in the same transaction whenever a
   report's status changes.
7. **`assigned_manager` must be admin or manager of the visit's org.**
   Validated at visit creation and on resubmit.

### API endpoints

Two new DRF viewsets in `core/masters/views.py` plus a read-only audit
endpoint, registered in `core/masters/urls.py`. All scoped via the existing
`scoped(qs, user)` helper, with object-level visibility enforced by a new
`IsVisitParticipant` permission class.

#### `ClientVisitViewSet` — `/api/client-visits/`

| Method | URL | Who | Purpose |
|---|---|---|---|
| GET | `/api/client-visits/` | author / assigned manager / admin | List visits visible to caller (visibility rule) |
| GET | `/api/client-visits/?client_uid=&prepared_by_uid=&assigned_manager_uid=&status=&visit_month=&overdue=true&date_from=&date_to=` | same | All filters mirror the UI controls |
| POST | `/api/client-visits/` | any authenticated user in the org | Create visit + initial `VisitReport` rev #1 in `Draft` (atomic, server-side); body: `{client, visit_date, assigned_manager, key_points, observation_attachment}` |
| GET | `/api/client-visits/{uid}/` | author / assigned manager / admin | Full detail with embedded `reports[]` and `audit_events[]` |
| PATCH | `/api/client-visits/{uid}/sent-info/` | assigned manager / admin | Updates `report_sent_date`, `voice_note_sent`, `voice_note_summary`. Returns 400 if no Approved report exists. Writes `sent_to_client` / `voice_note_marked` audit events as appropriate. |
| DELETE | `/api/client-visits/{uid}/` | author (Draft only) / admin | Hard delete; admin-only after submission |

#### `VisitReportViewSet` — `/api/visit-reports/`

Per-revision actions. Reports are not directly created via POST — use the
visit-creation flow or `resubmit`.

| Method | URL | Who | Purpose |
|---|---|---|---|
| PATCH | `/api/visit-reports/{uid}/` | author, only while `Draft` or `Pending` | Edit `key_points` / replace `observation_attachment`. 403 if `Approved` / `Rejected`. |
| POST | `/api/visit-reports/{uid}/submit/` | author | `Draft` → `Pending`. Sets `submitted_at`. Writes `submitted` audit event. Triggers manager notification. |
| POST | `/api/visit-reports/{uid}/approve/` | assigned manager (or org admin) | `Pending` → `Approved`. Sets `reviewed_at` / `reviewed_by`. Writes `approved` event. Triggers junior notification. |
| POST | `/api/visit-reports/{uid}/reject/` | assigned manager (or org admin) | `Pending` → `Rejected`. Body: `{manager_comment: "…"}` — required, non-empty. Writes `rejected` event. Triggers junior notification. |
| POST | `/api/visit-reports/{uid}/resubmit/` | author of the rejected revision | Creates a NEW `VisitReport` (rev = latest+1, status=`Draft`) on the same visit. Multipart body: `{key_points, observation_attachment}`. Writes `resubmitted` event. Errors if latest revision is not `Rejected`. |
| GET | `/api/visit-reports/{uid}/attachment/download/?download=1` | author / assigned manager / admin | Streams the file via the existing `_stream_attachment()` helper |

#### `VisitReportAuditEventViewSet` — read-only

| Method | URL | Who | Purpose |
|---|---|---|---|
| GET | `/api/visit-audit-events/?visit_uid=` | author / assigned manager / admin | List timeline events for a visit (chrono ascending). Audit log is also embedded in the visit-detail response above; this endpoint exists for fresh polling / dedicated panel reloads. |

#### Wiring

- All viewsets use `UidLookupMixin` so URLs use `uid`, not `pk` (matches
  existing pattern).
- Multipart parsing for the attachment endpoints (mirrors
  `ClientMeetingViewSet.attachments`).
- `broadcast("client-visits", ...)` and `broadcast("visit-reports", ...)`
  channels emit on every state change so the React side gets realtime
  list updates (matches existing `client-meetings` /
  `client-action-points` channels).

### UI structure

A new sub-tab `📝 Internal Report` added to `ClientsPage.tsx` after
`MOM & Action Points`.

#### File layout

New files under `frontend/task-tracker/src/components/clients/`:

```
ClientInternalReportTab.tsx        — top-level: filters bar + grouped list
ClientVisitGroupedView.tsx         — collapsible client groups, descending visit_date
ClientVisitRow.tsx                 — one row per visit; expand → revisions + timeline + sent panel
VisitSubmitModal.tsx               — junior: create visit / edit draft / resubmit (shared form)
VisitReviewPanel.tsx               — manager: Approve / Reject (with comment) buttons
VisitSentInfoPanel.tsx             — manager: report_sent_date + voice note tick + summary
VisitTimelinePanel.tsx             — read-only audit event list
internalReportFilters.ts           — pure filter helpers (mirrors actionPointFilter.ts)
internalReportGrouping.ts          — pure groupByClient + sort (mirrors momGrouping.ts)
visitOverdue.ts                    — overdue calculation helper
```

New files under `frontend/task-tracker/src/`:

```
hooks/useClientVisits.ts           — data hook (list + mutations + realtime sub)
hooks/useVisitAuditEvents.ts       — per-visit audit fetch (used inside expanded row)
hooks/useDirectedNotifications.ts  — toast subscriber for the directed notifications channel
types/api/internalReports.ts       — DTOs (ClientVisitDto, VisitReportDto, VisitAuditEventDto)
lib/api/internalReports.ts         — fetch wrappers for the new endpoints
```

Existing files touched:

- `frontend/task-tracker/src/pages/ClientsPage.tsx` — add `internal` to
  `SubTab` union and a third button in the sub-tab bar.

#### Filters bar (top of tab)

```
CLIENT [dropdown — inherited from page header]   PREPARED BY [multi-select users]
ASSIGNED MANAGER [multi-select users]            STATUS [multi-select: Draft/Pending/Approved/Rejected]
VISIT MONTH [<input type="month">]               □ OVERDUE ONLY    □ PENDING MY APPROVAL
                                                                   [+ New Visit] (any user)
```

`PENDING MY APPROVAL` is a quick toggle for managers — sets
`assigned_manager_uid = me` + `status = Pending` in one click.

`OVERDUE ONLY` filters via `overdue=true` query param (server-side rule
below).

#### Grouped list (body of tab)

Same shape as `ClientMOMAllView`:

```
▾ Acme Corp  (3 visits)                                                 [+ New Visit]
  ┌──────────────┬──────────────┬─────────────┬──────────┬─────────────┬────────────┐
  │ Visit Date   │ Prepared By  │ Manager     │ Status   │ Sent Date   │ Overdue?   │
  ├──────────────┼──────────────┼─────────────┼──────────┼─────────────┼────────────┤
  │ ▸ 2026-04-25 │ Ravi K.      │ Sabiullah   │ Pending  │ —           │ ⚠ Overdue  │
  │ ▾ 2026-04-22 │ Priya S.     │ Sabiullah   │ Approved │ 2026-04-23  │            │
  │     [expanded panel — see below]                                                │
  │ ▸ 2026-04-18 │ Ravi K.      │ Anita J.    │ Approved │ 2026-04-19  │            │
  └──────────────┴──────────────┴─────────────┴──────────┴─────────────┴────────────┘

▸ Globex Ltd  (1 visit)
```

Sort: descending `visit_date`. Groups follow the page-level `Client`
filter (matches MOM/Roadmap behavior).

#### Expanded visit row — three stacked panels

```
┌────────────────────────────────────────────────────────────────┐
│ 1. REVISIONS (table)                                           │
│    Rev | Status   | Submitted        | Reviewed by  | Comment  │
│    ----+----------+------------------+--------------+--------- │
│    #1  | Rejected | 2026-04-22 10:14 | Sabiullah    | "missing │
│        |          |                  |              | safety   │
│        |          |                  |              | photos"  │
│    #2  | Approved | 2026-04-22 16:30 | Sabiullah    | —        │
│       [📎 Download report]                                     │
│                                                                │
│   Junior actions on latest row:                                │
│     • Draft     → [Edit] [Submit]                              │
│     • Pending   → [Edit] (no manual unsubmit; manager acts)    │
│     • Rejected  → [Resubmit] (opens VisitSubmitModal pre-      │
│                   filled with prior key_points + manager       │
│                   comment shown above the form)                │
│                                                                │
│   Manager actions on latest row (when Pending):                │
│     [✓ Approve]  [✗ Reject — opens comment prompt]             │
├────────────────────────────────────────────────────────────────┤
│ 2. POST-APPROVAL — VisitSentInfoPanel (visible after Approval) │
│    Report sent date: [2026-04-23 ✎]   ☑ Voice note sent        │
│    Voice note summary: [textarea ✎]                            │
│    (editable by assigned manager / admin only)                 │
├────────────────────────────────────────────────────────────────┤
│ 3. TIMELINE — VisitTimelinePanel                               │
│    • 2026-04-22 09:55  Visit created by Ravi K.                │
│    • 2026-04-22 10:14  Submitted (rev #1)                      │
│    • 2026-04-22 11:02  Rejected (rev #1) by Sabiullah —        │
│                        "missing safety photos"                 │
│    • 2026-04-22 16:25  Resubmitted as rev #2                   │
│    • 2026-04-22 16:30  Approved (rev #2) by Sabiullah          │
│    • 2026-04-23 09:10  Sent to client                          │
│    • 2026-04-23 09:11  Voice note marked sent                  │
└────────────────────────────────────────────────────────────────┘
```

#### `VisitSubmitModal` — shared form for create / edit-draft / resubmit

Single component, three modes (decided by props):

- **Client** — dropdown, defaults to the page-header client; locked when
  resubmitting.
- **Visit Date** — date picker; locked when resubmitting (visit is fixed).
- **Assigned Manager** — single-select from the org's admins/managers;
  locked when resubmitting.
- **Key Points** — multi-line textarea (manual entry).
- **Observation Report** — file input (single file; replaces if
  re-uploaded in draft).
- **Manager comment from prior rejection** — read-only banner shown only
  in resubmit mode, so the junior sees what to address.

Submit button label adapts: `Save Draft` / `Save & Submit` (toggle) on
create + edit, `Save & Submit` on resubmit.

### Notifications

Two layers, both using existing infra. No new tables, no scheduler.

#### Realtime broadcast (already wired)

Every state-changing API action calls
`broadcast("client-visits", "INSERT" | "UPDATE", payload)` and/or
`broadcast("visit-reports", "UPDATE", payload)` — same pattern as
`client-meetings`. The React `useClientVisits` hook subscribes via the
existing `RealtimeConsumer` and refreshes the list automatically. This
makes the *list* live; it doesn't pop a notification.

#### Targeted toast notifications

Backend emits a **second broadcast** on a new `notifications` channel with
a directed payload:

```json
{
  "to_user_uid": "<uid>",
  "kind": "visit_report_submitted" | "visit_report_approved" | "visit_report_rejected",
  "title": "New report awaiting your approval",
  "body": "Ravi K. submitted a visit report for Acme Corp (2026-04-25)",
  "link": { "tab": "internal", "visit_uid": "..." }
}
```

A new `useDirectedNotifications()` hook subscribes to that channel,
filters `to_user_uid === currentUser.uid`, and calls `toast(...)` with a
clickable action that navigates to Clients → Internal Report and
scrolls/expands the target visit.

#### Triggers

| Event | Recipient | Toast text |
|---|---|---|
| Junior `submit` (any revision) | assigned manager | "New report awaiting your approval — `<client>` (`<visit_date>`)" |
| Manager `approve` | report author (junior) | "Your report for `<client>` (`<visit_date>`) was approved" |
| Manager `reject` | report author (junior) | "Your report for `<client>` (`<visit_date>`) was rejected — see comment" |

The three fire inside the same DB transaction as the state change
(best-effort; broadcast failures are logged but don't roll back, matching
the existing `broadcast()` swallow-and-log behavior).

#### Overdue nudge

Computed on read — no scheduled job. The React UI renders the
`⚠ Overdue` row badge from a server-computed `is_overdue` field on the
serialized visit, and the page-header overdue counter (already done for
action points) gets extended to include overdue visits. The manager sees
it the moment they open the Clients page.

If experience shows managers miss things, a daily management command +
push notification can be added later; out of scope for v1.

### Permissions

"Assigned manager" = the manager named in `assigned_manager` for the visit
in question. "Other manager (same org)" = a manager in the same org but
not assigned to this specific visit. Visibility applies per-visit.

| Action | Author (junior) | Assigned manager | Other admin (same org) | Other manager (same org) | Other juniors |
|---|---|---|---|---|---|
| Create visit (POST) | ✅ | ✅ | ✅ | ✅ | ✅ (any authenticated user in the org) |
| List / retrieve a given visit | ✅ if author | ✅ if assigned | ✅ always | ❌ | ❌ |
| Edit Draft / Pending report (`PATCH /visit-reports/{uid}/`) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Submit (`POST .../submit/`) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Approve / Reject | ❌ | ✅ | ✅ (admin override) | ❌ | ❌ |
| Resubmit | ✅ | ❌ | ❌ | ❌ | ❌ |
| Edit `report_sent_date` / voice-note fields | ❌ | ✅ | ✅ | ❌ | ❌ |
| Delete visit | ✅ only while Draft, never after submit | ❌ | ✅ any time | ❌ | ❌ |

Implemented as a new `IsVisitParticipant` permission class in
`core/masters/views.py` enforcing the visibility column at object level
(author OR assigned_manager OR is_admin_in(org)). The action-level checks
(`approve` / `reject` / `submit` / `resubmit` / `sent-info`) live inside
the action handlers.

### Filters

| UI control | Query param | Backend filter | Notes |
|---|---|---|---|
| Page header `Client` dropdown | `client_uid=<uid>` | `client__uid=` | Inherited from `ClientsPage` selection (matches MOM tab behavior) |
| `Prepared by` multi-select | `prepared_by_uid=<uid>&prepared_by_uid=<uid>` | `prepared_by__uid__in=[...]` | Multi-value param |
| `Assigned manager` multi-select | `assigned_manager_uid=...` | `assigned_manager__uid__in=[...]` | Multi-value |
| `Status` multi-select | `status=Draft&status=Pending` | `current_status__in=[...]` | Filters on visit's denormalized status |
| `Visit Month` (`<input type="month">`) | `visit_month=2026-04` | `visit_date__year=` AND `visit_date__month=` | Same shape as MOM `targetMonth` |
| `Overdue only` checkbox | `overdue=true` | `report_sent_date__isnull=True AND visit_date < today - 1 day` | Server-computed (not relying on stored `is_overdue`) |
| `Pending my approval` checkbox | `assigned_manager_uid=<me>&status=Pending` | combo of the two above | Convenience toggle, no new param |

Group-by-client + descending visit_date is applied **client-side in
`internalReportGrouping.ts`** — same pattern as `momGrouping.ts` —
because Django can't easily emit a nested grouped JSON. The backend just
orders by `(client_id, -visit_date)` so the client-side group is a
single-pass walk.

### Overdue rule — single source of truth

```python
# helper in core/masters/models.py — used by both list filter and the row badge
def is_visit_overdue(visit, today=None):
    today = today or timezone.localdate()
    return (
        visit.report_sent_date is None
        and (today - visit.visit_date).days > 1
    )
```

- `(today - visit_date).days > 1` means a visit on Mon (day 0) starts
  being overdue on Wed (day 2) — i.e. **end of "visit_date + 1 calendar
  day"** is the deadline (matches Decision #6).
- Calendar days, weekends counted (Decision #6).
- Returns `False` as soon as `report_sent_date` is set, regardless of
  when it was set — a late-marked visit stops being "overdue today".
  Historical "was it overdue when sent?" can be derived from the audit
  log if needed later, but is out of scope for v1.
- Exposed as a serializer-only `is_overdue` boolean on
  `ClientVisitSerializer`, so the React `⚠ Overdue` badge renders without
  re-computing the rule client-side.

### Migrations

Single new migration in `core/masters/migrations/` (next sequence number
after `0008_clientactionpointattachment.py`) that:

1. Creates `ClientVisit`, `VisitReport`, `VisitReportAuditEvent`.
2. Adds the indexes listed above.

No data migration — the feature ships empty.

## Testing strategy

Backend (`core/masters/tests.py`):

- Visit creation → initial report created in `Draft` with rev #1 +
  `created` audit event.
- Submit → report goes `Draft` → `Pending`, `submitted_at` set, audit +
  manager notification fired.
- Approve / Reject by assigned manager — happy paths.
- Approve / Reject by non-assigned manager — 403.
- Approve / Reject by org admin override — 200.
- Reject without comment — 400.
- Resubmit when latest is not `Rejected` — 400.
- Resubmit when latest is `Rejected` — new revision in `Draft`,
  `revision_number` incremented, `resubmitted` audit event.
- PATCH report after approval — 403.
- PATCH `sent-info` before approval — 400.
- PATCH `sent-info` after approval — updates fields, writes
  `sent_to_client` / `voice_note_marked` events.
- Visibility: junior B cannot list / retrieve junior A's visits.
- Overdue filter: visit on `today - 2 days` with no `report_sent_date`
  appears; visit on `today - 2 days` with `report_sent_date` set does not.
- `assigned_manager` not an admin/manager of the org — 400.
- Atomicity: simulated DB error in audit-write rolls back the state
  change.

Frontend (Vitest + React Testing Library, mirroring the existing
`__tests__` patterns under `frontend/task-tracker/src/__tests__`):

- `internalReportFilters.ts` — pure unit tests for each filter
  predicate (matches `actionPointFilter.test.ts` style).
- `internalReportGrouping.ts` — group-by-client + descending sort.
- `visitOverdue.ts` — overdue boolean for a fixed `today`.
- `ClientInternalReportTab` integration: filter bar applies query params,
  realtime broadcast triggers refetch.
- Permission-driven rendering: junior sees `Submit` only on their own
  drafts; manager sees `Approve / Reject` only on assigned pending
  reports.

Manual / browser verification (per CLAUDE.md "test the UI in a browser
before reporting complete"):

- Junior creates visit → submits → manager approves → sent date entered
  → voice note ticked. Verify timeline reflects each step.
- Junior creates visit → submits → manager rejects with comment → junior
  resubmits → manager approves. Verify revision count = 2 in the table.
- Overdue badge: create a visit dated 3 days ago, leave sent date empty,
  confirm `⚠ Overdue` appears and `Overdue only` filter shows it.
- Notifications: log in as junior in one window, manager in another;
  submitting in junior window pops a toast in manager window.

## Open questions

None — all clarifying questions were resolved during brainstorming (see
the Decisions log above).
