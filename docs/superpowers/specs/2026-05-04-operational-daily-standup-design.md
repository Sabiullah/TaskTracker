# Operational Daily Standup — Design

**Date:** 2026-05-04
**Status:** Draft (awaiting user review)
**Branch:** `Shedue_Opn_meeting-Changesetup`

## Problem

The existing Operational meeting flow models a daily standup as a single `PaceMeeting` record per session — with one big agenda, free-text minutes, and a flat attendees list. That shape doesn't capture what each employee actually said, can't be queried per-person, and has no approval workflow.

Operational meetings are short, structured daily standups: every employee answers three prompts — Breakdown / Breakthrough, top priorities for the day, collaboration needs — plus optional remarks. We need a per-employee, per-day record with role-aware editing and approval.

## Goal

Replace the current Operational meeting flow with a date-grouped grid where each row is one employee's standup for that date. Support entry by the employee themselves (pending approval) or by a manager/admin (auto-approved). Give admins a per-date "Final Review" bulk approval, a pending-count badge in nav, a month filter, and a roster exclude list.

Strategic and Tactical meetings are out of scope and remain unchanged.

## Non-goals

- No changes to Strategic or Tactical meetings.
- No migration of historical Operational `PaceMeeting` rows; they sit in the DB as legacy data.
- No auto-hide based on attendance/leave/WFH for a given date — admins use the exclude list for permanent exclusions; one-off absences show as "Not submitted."
- No re-approval requirement after a manager/admin edits an already-approved row.
- No notifications/email — pending count badge is the only signal.

## User decisions (locked)

| # | Decision |
|---|---|
| Q1 | Replace the Operational flow entirely (Strategic/Tactical untouched). |
| Q2 | Single approval gate. Manager/admin-entered rows are `Approved` immediately; employee-entered rows are `Pending` until **any** manager or admin in the org approves. Final Review = admin's per-date bulk approve. |
| Q3 | One row per `(org, profile, standup_date)` (DB-enforced). Manager/admin can edit `Approved` rows; the employee themselves cannot edit their own row once approved. |
| Q4 | Admin sees the **full active roster** for each date with "Not submitted" placeholders, **plus** an admin-managed exclude list to suppress specific people (admins, senior staff). |
| Q5 | Breakdown/Breakthrough = three-option dropdown (`Breakdown`, `Breakthrough`, blank `—`). Priorities = single auto-expanding multi-line textarea. Collaboration = free text. Remarks = free text. |
| Q6 | Pending badge for both managers and admins, scoped to their approval authority. Date sections: today expanded, all earlier dates collapsed. Month filter default = current month. |
| Q7 | Employees see the grid filtered to their own rows only. Managers see the same grid as admins (full org visibility) — they can edit and approve any row in their org. Admin's "Final Review" bulk-approve button is the one admin-only affordance. **Note:** the original Q7-B1 answer scoped managers to "subordinates + self," but this conflicts with the user's original "any of the respective manager or admin in the organization" phrasing and with the codebase's `visibility_q` helper, which deliberately abandoned the subordinate-narrowing pattern. We follow the user's original intent + codebase precedent here. |

## Architecture

New backend model `OperationalStandup` in `core/pace`, a sibling to the existing `PaceMeeting`. Existing `PaceMeeting` and `PaceGoal` flows are untouched. New frontend page `DailyStandupPage` mounts as a sub-tab inside the existing PACE page.

```
PACE page (sub-tabs)
├── Meetings        ← Strategic + Tactical only (Operational button + filter removed)
├── Goals
├── Daily Standup   ← NEW: date-grouped grid, owns OperationalStandup CRUD + approval
├── Clients
└── Checklist (admin)
```

## Data model

### `core/pace/models.py` — new model

```python
class OperationalStandup(TimeStampedModel):
    BREAKTHROUGH_TYPE_CHOICES = [
        ("Breakdown", "Breakdown"),
        ("Breakthrough", "Breakthrough"),
    ]
    STATUS_CHOICES = [
        ("Pending", "Pending"),
        ("Approved", "Approved"),
    ]

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    org = models.ForeignKey("users.Org", on_delete=models.CASCADE, related_name="operational_standups")
    profile = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="operational_standups",
    )
    standup_date = models.DateField(db_index=True)
    breakthrough_type = models.CharField(max_length=20, choices=BREAKTHROUGH_TYPE_CHOICES, blank=True, default="")
    priorities = models.TextField(blank=True)
    collaboration_need = models.TextField(blank=True)
    remarks = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="Pending", db_index=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True, on_delete=models.SET_NULL,
        related_name="operational_standups_created",
    )
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True, on_delete=models.SET_NULL,
        related_name="operational_standups_approved",
    )
    approved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-standup_date", "profile__full_name"]
        constraints = [
            models.UniqueConstraint(
                fields=["org", "profile", "standup_date"],
                name="uniq_op_standup_org_profile_date",
            ),
        ]
        indexes = [
            models.Index(fields=["org", "standup_date"], name="op_standup_org_date_idx"),
            models.Index(fields=["org", "status"], name="op_standup_org_status_idx"),
        ]
```

### `users/models.py` — extend `OrgMembership`

```python
class OrgMembership(models.Model):
    # ...existing fields...
    exclude_from_operational_standup = models.BooleanField(default=False)
```

Default `False` ensures every existing membership stays in the roster until an admin opts them out.

### Migrations

- `core/pace/migrations/0003_operationalstandup.py` — creates the model + indexes + unique constraint.
- `users/migrations/0005_orgmembership_exclude_op_standup.py` — adds the boolean field with `default=False`.

## API

### `core/pace/views.py` — `OperationalStandupViewSet`

| Method | Path | Purpose | Auth |
|---|---|---|---|
| `GET` | `/operational_standups/` | List entries — filterable by `month`, `date`, `profile_uid`, `status`, `breakthrough_type` | scoped per role |
| `GET` | `/operational_standups/roster/?date=YYYY-MM-DD` | Returns `[{profile, entry|null, role_can_edit, role_can_approve}]` for the included roster on that date | scoped per role |
| `POST` | `/operational_standups/` | Create one entry; sets `status` based on caller role | role-gated |
| `PATCH` | `/operational_standups/{uid}/` | Update fields; permission-gated | role-gated |
| `POST` | `/operational_standups/{uid}/approve/` | Single-row approve | manager (subord+self) or admin |
| `POST` | `/operational_standups/bulk_approve/` | Body: `{date, org}` → approves all `Pending` rows for that date+org in a single transaction (idempotent) | admin only |
| `GET` | `/operational_standups/pending_count/` | `{count}` scoped to caller's authority | any auth user |
| `DELETE` | `/operational_standups/{uid}/` | Delete one row | admin only |

### Visibility scoping (`get_queryset`)

```text
admin in org           → all rows in that org
manager in org         → all rows in that org (matches codebase visibility_q pattern)
employee (neither)     → rows where profile == self
```

Multi-org users get the union across the orgs they belong to. A user who is admin in org A and employee in org B sees all of A's rows + only their own rows in B.

### Status assignment on create

```text
caller is admin in target org                       → Approved (approved_by=caller, approved_at=now)
caller is manager in target org                     → Approved (manager-entered, approved_by=caller)
caller is the target profile (self) and not a manager/admin → Pending
caller is creating row for someone in an org they don't belong to → 403
```

### Pending-count scoping (`pending_count`)

```text
admin or manager in org     → count Pending rows in that org
employee in org             → count Pending rows where profile == self
```

Counts summed across all orgs the user belongs to.

### Roster endpoint logic

For a `date` and the caller's accessible orgs:

1. Determine roster: `OrgMembership.objects.filter(org=..., user__is_active=True, exclude_from_operational_standup=False)`. (`is_active` lives on `User`, not `OrgMembership`.)
   - For employees: roster restricted to themselves.
   - For employees: roster restricted to themselves only.
   - For managers/admins: full roster (excluding opted-out members).
2. Left-join existing `OperationalStandup` rows for that date.
3. Return one entry per roster member: `{profile, entry_or_null, can_edit, can_approve}`.

### Realtime

Broadcast `pace-operational-standups` channel on INSERT / UPDATE / DELETE / APPROVE / BULK_APPROVE. Frontend `useOperationalStandups` hook subscribes and re-fetches.

## Permission matrix

| Action | Employee (self) | Manager | Admin |
|---|---|---|---|
| Read own row | ✅ | ✅ | ✅ |
| Read others' rows | ❌ | ✅ entire org | ✅ entire org |
| Create own row → `Pending` | ✅ | own row → `Approved` (manager-entered) | own row → `Approved` |
| Create others' rows | ❌ | ✅ anyone in org → `Approved` | ✅ anyone in org → `Approved` |
| Edit own `Pending` row | ✅ | ✅ | ✅ |
| Edit own `Approved` row | ❌ | ✅ | ✅ |
| Edit others' rows | ❌ | ✅ entire org | ✅ entire org |
| Approve single row | ❌ | ✅ entire org | ✅ entire org |
| Bulk approve a date (Final Review) | ❌ | ❌ | ✅ |
| Delete | ❌ | ❌ | ✅ |
| Toggle exclude flag on `OrgMembership` | ❌ | ❌ | ✅ |

All checks enforced server-side; frontend mirrors them only to gate UI affordances.

## Frontend

### Page wiring

- `frontend/task-tracker/src/pages/PacePage.tsx` — add a `"daily-standup"` sub-tab between `"meetings"` and `"goals"`. Sub-tab label includes a red badge when pending count > 0.
- `frontend/task-tracker/src/pages/PaceMeetingsPage.tsx` — remove the "Schedule Operational" button and remove `"Operational"` from the type filter options. Keep `MEETING_TYPE_CHOICES` on the model intact (legacy read).
- New `frontend/task-tracker/src/pages/DailyStandupPage.tsx`.

### Components

```
src/components/pace/
├── DailyStandupRow.tsx           ← inline-editable row (real entry or placeholder)
├── DailyStandupDateSection.tsx   ← collapsible per-date section with table + Final Review button
├── DailyStandupAddModal.tsx      ← single-row modal for manager/admin "Add Entry" (pick employee + date)
└── RosterExcludePanel.tsx        ← admin-only collapsible: chips of org members with toggle
```

### Hooks

```
src/hooks/
├── useOperationalStandups.ts     ← list + roster fetch, websocket sub
├── useOperationalStandupsBadge.ts ← pending_count poller + ws sub
```

### Types

```
src/types/api/operationalStandup.ts
├── OperationalStandupDto
├── OperationalStandupCreate
├── OperationalStandupRosterRow
├── BreakthroughTypeValue   = "Breakdown" | "Breakthrough" | ""
├── OperationalStandupStatus = "Pending" | "Approved"
```

### Page layout

```
┌────────────────────────────────────────────────────────────────────────┐
│ 📋 Daily Standup           [Month: May 2026 ▾]  [Org ▾]   [+ Add Entry]│
├────────────────────────────────────────────────────────────────────────┤
│ [Total: 145] [Approved: 138] [Pending: 5] [Not Submitted today: 2]     │
├────────────────────────────────────────────────────────────────────────┤
│ Filters: [Employee ▾]  [Breakdown/Breakthrough ▾]                      │
├────────────────────────────────────────────────────────────────────────┤
│ ▾ 📅 Mon 4 May 2026 · 24/30 submitted · 3 pending  [Final Review]      │
│   ┌──┬───────────┬────────┬────────────────────────┬───────┬─────┬────┐│
│   │ #│ Employee  │ Type   │ Priorities             │ Collab│Rmrks│By  ││
│   ├──┼───────────┼────────┼────────────────────────┼───────┼─────┼────┤│
│   │ 1│ Sabiullah │ Brkthr │ Ship release, fix CI   │ —     │ —   │ ✓  ││
│   │ 2│ Priya     │ Brkdwn │ Auth blocked on review │ Need… │ —   │ ⏳ ││
│   │..│ ...                                                             ││
│   │30│ Karthik   │ —      │ Not submitted          │ —     │ —   │ —  ││
│   └──┴───────────┴────────┴────────────────────────┴───────┴─────┴────┘│
│ ▸ 📅 Sun 3 May 2026 · 28/30 submitted · 0 pending                      │
│ ▸ 📅 Sat 2 May 2026 · 30/30 submitted · 0 pending                      │
└────────────────────────────────────────────────────────────────────────┘
```

### Behavior details

- **Inline editing:** clicking any cell with edit permission turns it into an inline input. Auto-save on blur or 600ms idle. Status pill on the row shows `Saving…` → `Saved`.
- **Priorities cell:** auto-expanding textarea (mirrors the existing `MeetingEditModal` agenda textarea pattern) when focused. When unfocused, clipped to ~2 lines with `…` and a "more" affordance.
- **Placeholder rows:** "Not submitted" shown in grey. Clicking it (when caller has create permission) materialises a draft row inline; submitting calls `POST /operational_standups/`.
- **Add Entry modal (manager/admin):** date picker + employee picker (scoped to their accessible roster) + the four fields. Submits as `Approved` automatically.
- **Final Review button:** admin-only, visible per-date when ≥1 `Pending` row exists. Click → confirm → `POST /operational_standups/bulk_approve/`. After success, all those rows flip to `Approved` with `approved_by = current admin` in real time.
- **Collapse/expand:** chevron in the date section header. Today is auto-expanded; earlier dates collapsed. Collapse state is local component state — not persisted.
- **Conducted/Approved By column:** for `Approved` rows where `created_by == approved_by` (auto-approved by manager/admin who entered the row), shows the manager/admin's name. For employee-entered rows that were later approved, shows the approver's name with a small "approved" tooltip.
- **Roster settings:** an admin-only collapsible panel above the date sections — chip list of all org members with a toggle to include/exclude. Persists immediately via `PATCH /org_memberships/{uid}/`.

### Nav badge

- `useOperationalStandupsBadge` polls `/operational_standups/pending_count/` on mount and re-fetches on `pace-operational-standups` ws events.
- Badge bubbles up:
  - The "Daily Standup" sub-tab (always when count > 0).
  - The "PACE" top-nav tab (sum of all sub-tab pending counts — currently only this one contributes).

## Edge cases

| Scenario | Behavior |
|---|---|
| Employee in multiple orgs | Per-org rows; each org has its own approval state. |
| Employee on leave/WFH | Still appears as "Not submitted" placeholder. Admin uses exclude list for permanent exclusions. |
| Approver deactivated | `approved_by` is `SET_NULL`; UI shows "(former member)". |
| Edit after approval | Manager/admin edits in place — row stays `Approved`, no re-approval needed. Employee themselves cannot edit. |
| Bulk approve race | Single DB transaction; `WHERE status='Pending'` ensures already-approved rows are untouched. Idempotent. |
| Concurrent edits to same cell | Last write wins (no merge UI). Realtime broadcast surfaces the other user's update. |
| Existing Operational `PaceMeeting` rows | Not migrated. UI removes the entry points; rows sit unused in DB. |
| Multi-org admin with `month=YYYY-MM` filter | Returns rows across all orgs the admin belongs to; date sections show org name in the header bar. |

## Testing

### Backend (`core/pace/tests.py`)

- **Model:** unique constraint on `(org, profile, standup_date)`.
- **Permission matrix** (one test per cell of the matrix above): create, edit-own, edit-others, approve, bulk-approve, delete.
- **Status auto-assign:** employee → `Pending`, manager-entered → `Approved`, admin-entered → `Approved`.
- **Roster endpoint:** roster respects `is_active`, excludes opt-outs, returns placeholders for non-submitters, restricts roster per role.
- **Bulk approve:** transactional, idempotent, only flips `Pending` → `Approved`, sets `approved_by` and `approved_at`.
- **Pending count:** scoping per role and across multi-org membership.
- **Edit-after-approval:** manager edit OK, status stays `Approved`; employee edit on own approved row → 403.
- **Multi-org isolation:** standup in org A invisible to admin of org B.

### Frontend (`__tests__/`)

- **Smoke test** `__tests__/components/pace/dailyStandupPage.smoke.test.tsx` — page renders with stat cards, date sections, badge.
- **Inline edit:** typing in priorities cell triggers debounced PATCH.
- **Placeholder click:** materialises a draft row, POSTs on save.
- **Final Review button:** admin-only visibility; click → bulk approve API called with date+org.
- **Badge hook:** pending count updates on ws event.
- **Sub-tab removal:** Operational button + filter no longer present in `PaceMeetingsPage`.

## Out of scope (follow-ups)

- Optional notification (email / Slack) when an employee submits or when bulk approval happens.
- Optional auto-skip rows for users on approved leave on that date.
- Export (CSV) of standups by month.
- Migration utility for legacy Operational `PaceMeeting` records (archive vs delete).
