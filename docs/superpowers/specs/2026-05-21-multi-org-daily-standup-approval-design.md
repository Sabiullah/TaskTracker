# Multi-Org Daily Standup Approval — Design

**Date:** 2026-05-21
**Status:** Draft — awaiting implementation plan
**Owner:** Sabiullah

## Problem

A user who is a manager (or admin) in more than one organisation — e.g. Akilan and Hashim
each have rights in both **4D** and **YBV** — currently sees standups for only one of
their orgs in the Daily Standup view.

The schema requires one `OperationalStandup` row per `(org, profile, standup_date)`.
A multi-org employee therefore produces two rows per day (one per org). The frontend
deduplicates these by `profile.uid` in the "All" view
(`frontend/task-tracker/src/pages/DailyStandupPage.tsx:64-74`), so the second org's
row is silently hidden. This breaks two needs:

1. The multi-org employee has to write the same priorities twice for the day.
2. Multi-org managers can only see/approve one org's worth of rows in the dedupe-collapsed view.

## Goal

A daily standup is one entry per user per day, written once. Approval is tracked
**per org** so each org's manager/admin has an independent audit trail. Managers see
every standup across the orgs where they hold management rights, regardless of the
header `ORG` selector.

## Out of scope

- Roles or feature-access plumbing (handled by existing `OrgMembership`).
- Other PACE artefacts (`PaceGoal`, `PaceMeeting`, `PaceChecklist`) — they keep their
  current per-org models.
- Backfilling historic approvals for orgs the user joined after the standup was
  written (we backfill only the orgs that were active at the time of submission;
  see Migration).

## Design

### Schema

Two changes to `core/pace/models.py`:

#### `OperationalStandup` — collapse to one row per user per day

```python
class OperationalStandup(TimeStampedModel):
    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    profile = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="operational_standups",
    )
    standup_date = models.DateField(db_index=True)
    breakthrough_type = models.CharField(max_length=20, choices=..., blank=True, default="")
    priorities = models.TextField(blank=True)
    collaboration_need = models.TextField(blank=True)
    remarks = models.TextField(blank=True)
    created_by = models.ForeignKey(...)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["profile", "standup_date"],
                name="uniq_op_standup_profile_date",
            ),
        ]
```

**Removed fields:** `org`, `status`, `approved_by`, `approved_at`, `reviewed_by`,
`reviewed_at`. Approval state moves to the sibling table below.

#### `OperationalStandupApproval` — new model

```python
class OperationalStandupApproval(TimeStampedModel):
    STATUS_CHOICES = [("Pending", "Pending"), ("Approved", "Approved")]

    uid = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    standup = models.ForeignKey(
        OperationalStandup,
        on_delete=models.CASCADE,
        related_name="approvals",
    )
    org = models.ForeignKey("users.Org", on_delete=models.CASCADE, related_name="+")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="Pending", db_index=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+",
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["standup", "org"], name="uniq_op_approval_standup_org"),
        ]
        indexes = [
            models.Index(fields=["org", "status"]),
        ]
```

### Auto-fan-out on standup create

When a standup is created, the view layer creates one `Approval` row per org in the
profile's current memberships, excluding orgs flagged
`exclude_from_operational_standup=True`.

If the standup is created by the profile themselves: every approval starts as
`Pending`. If created by a manager: only approvals for orgs **where that manager
has management rights** start as `Approved` (carrying `approved_by` / `approved_at`);
the rest stay `Pending` so the other org's manager still has an action item.

### Backend API

`core/pace/views.py` — `OperationalStandupViewSet`:

- **List (`GET /operational_standups/`)** — return standups whose `profile` shares
  at least one org with the viewer. Drop the manager/employee split: the per-org
  approval table carries the access information. For an employee with no
  management rights anywhere, restrict to their own rows.
- **Roster (`GET /operational_standups/roster/?date=…`)** — return one row per
  member of any org the viewer can see (union of orgs the viewer is admin/manager
  in, plus the viewer's own membership). Each row carries the per-org approval
  matrix:
  ```json
  {
    "profile": {…},
    "entry": {…standup or null…},
    "approvals": [
      {"org_uid": "…", "org_name": "4D", "status": "Approved",
       "approved_by": "Akilan", "reviewed_at": null, "can_act": true},
      {"org_uid": "…", "org_name": "YBV", "status": "Pending",
       "approved_by": null, "reviewed_at": null, "can_act": true}
    ],
    "can_edit": true
  }
  ```
  `can_act` is `true` for the orgs where the viewer is admin/manager.
- **`POST /operational_standups/{uid}/approve/`** — body `{"org": "<org-uid>"}`.
  403 unless the caller is `is_manager_in(org)` AND `org` is one of the profile's
  memberships. Updates a single `Approval` row.
- **`POST /operational_standups/{uid}/review/`** — body `{"org": "<org-uid>"}`.
  403 unless caller is `is_admin_in(org)`. Sets `reviewed_by/reviewed_at` on that
  org's `Approval` row only.
- **`POST /operational_standups/bulk_review/`** — body `{date, org}`. 403 unless
  caller is admin in `org`. Approves+reviews all `Approval` rows for that org
  belonging to standups dated `date`.
- **`GET /operational_standups/pending_count/`** — counts approvals that need the
  caller's attention: `Pending` in any org where the caller is admin/manager, plus
  (for admins) `Approved` but `reviewed_at IS NULL` rows.

The header `ORG` selector is **ignored** by these endpoints — managers see every
standup they have rights to, irrespective of the selector. The selector remains in
the UI for navigation symmetry with other pages but does not narrow this list.

### Frontend

`frontend/task-tracker/src/pages/DailyStandupPage.tsx`:

- Remove the user-uid dedupe block (`dedupedRoster`, `olderByDate` dedupe). One row
  per `(profile, standup_date)` already exists on the wire.
- For older dates, rebuild rows directly from `standups` without per-user dedupe.
- Stop reading `selectedOrg` — the page renders the manager's full view always.

`DailyStandupRow.tsx`:

- Render an `approvals[]` chip strip in place of the single status badge. Each
  chip shows `<OrgBadge> <StatusIcon> <approved-by name|‑>`. Chips with `can_act`
  get a click-to-approve menu (Approve / Review for admins, Approve only for
  managers).
- Edit permission: the caller can edit the priorities/etc if they are the profile
  themselves AND **every** approval is still `Pending`, OR they are a manager in
  any org listed in `approvals`.

`DailyStandupDateSection.tsx`:

- "Final Review" button stays per-org. When the admin holds rights in multiple
  orgs, render one button per admin-org (`Final Review — 4D`, `Final Review — YBV`).
  Each calls `bulk_review` for that org.

`useOperationalStandups.ts` / `types/api/pace.ts`:

- Update DTOs to include the `approvals[]` array on the standup payload.
- The websocket channel `pace-operational-standups` keeps the same name; payloads
  now embed the full `approvals[]` so realtime stays coherent.

### Migration

`core/pace/migrations/0005_multi_org_standup.py` (new):

1. Create `OperationalStandupApproval` table.
2. Add `(profile, standup_date)` index/constraint preparation — but keep the old
   table intact until step 4.
3. **Data migration:**
   - For each `(profile, standup_date)`, pick the canonical row: the one with
     `status="Approved"` first, then highest `updated_at`. Copy
     `priorities`/`collaboration_need`/`remarks`/`breakthrough_type` from that row.
   - For **every** existing row in that `(profile, date)` group, create an
     `Approval` carrying the row's `status`/`approved_by`/`approved_at`/`reviewed_by`/
     `reviewed_at` and pointing at the canonical standup.
   - Delete the non-canonical rows.
4. Drop the old unique constraint `uniq_op_standup_org_profile_date`, drop the
   `org` FK, `status`, `approved_by`, `approved_at`, `reviewed_by`, `reviewed_at`
   columns. Add the new `uniq_op_standup_profile_date` constraint.

The migration is irreversible (the reverse direction can't recreate per-org
priority text). Document this in the migration's `Migration.atomic = True` block
with a comment explaining the data loss on rollback.

### Tests

Backend (`core/pace/tests.py`):

- `OperationalStandup` enforces `UNIQUE(profile, standup_date)`.
- Creating a standup auto-creates `Approval` rows for each of the profile's
  non-excluded orgs.
- Manager in 4D only can approve only the 4D `Approval` row of a standup whose
  profile is in {4D, YBV}; the YBV row stays `Pending`.
- Multi-org manager (in 4D + YBV) sees standups by both 4D and YBV members in
  list/roster regardless of any `org` query-param.
- Employee in 4D + YBV sees only their own standup row(s); cannot approve any.
- `bulk_review` for org=4D only touches `Approval` rows where org=4D.
- Migration test: an old fixture with `(Alice, 4D, 2026-05-01, Approved)` and
  `(Alice, YBV, 2026-05-01, Pending)` collapses to one standup with two
  approvals carrying the original statuses.

Frontend:

- `DailyStandupPage` smoke test no longer dedupes — multi-org users in fixtures
  produce a single row carrying multiple approval chips.
- `DailyStandupRow` renders an approval chip per org; `can_act=false` chips have
  no menu.
- `Final Review` buttons render one per admin-org for an admin with rights in
  multiple orgs.

### Error handling

- `POST approve/review` with an `org` the profile is not a member of → 400
  ("That org is not part of this standup").
- `POST approve` by a non-manager in the target org → 403.
- Creating a second standup for the same `(profile, date)` → 400 (existing
  `IntegrityError` mapping in `create()` is retained).
- Approval rows for orgs a user later leaves are not deleted — they remain as
  historic audit trail. New standups by that user will not generate approvals
  for the dropped org.

## Open questions

None — answered during brainstorming on 2026-05-21:
- One standup per user per day, no per-org duplication.
- Managers see all standups across their orgs irrespective of the header ORG
  filter.
- Approval state is tracked per-org with full audit fields.
