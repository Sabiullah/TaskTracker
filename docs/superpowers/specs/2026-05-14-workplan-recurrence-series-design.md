# Work Plan recurrence: series tag, list column, edit-following

**Date:** 2026-05-14
**Status:** Draft — pending user review
**Area:** `core/worklog/` (backend), `frontend/task-tracker/src/components/worklog/` (UI)

## 1. Problem

The Add Work Plan modal already supports recurrence (daily / weekly / monthly): when the user picks a recurrence + end date, the frontend expands the choice into N dated rows and POSTs each one independently. After save, those rows have **no link back to the original recurrence** — the database sees only independent `WorkPlan` records.

Two consequences:

1. The Work Log → Work Plan list can't show which rows are recurring or what the original cadence/end date was.
2. Editing a recurring row only ever changes that one row. Updating "Internal Audit" → "Field Audit" for the next 12 Thursdays means 12 manual edits.

The user wants:

- A **Recurrence** column on the list that reveals the cadence and end date for recurring rows.
- An edit-scope prompt: when saving an edit on a row that's part of a series, ask "this entry only" vs "this and following entries" — the latter applies the change to every same-series row dated on or after the edited row.

## 2. Approach

Lightweight series tag on `WorkPlan` (no separate parent table). When the Add modal expands a recurrence into N rows, the frontend generates **one `series_uid` per employee** and stamps it on every row created for that employee, alongside the recurrence type and end date. The series_uid + recurrence + end-date are stored on each row.

Editing a row that has a non-null `series_uid` shows an inline scope picker. "This entry only" goes through the existing PATCH path. "This and following entries" calls a new server endpoint that atomically applies the changed fields to every same-series row with `date >= source.date`.

**Why this approach over a separate `WorkPlanSeries` parent model:** the materialization-up-front pattern is already in place and works well for the team's workflow (each day's plan is editable individually, deletions don't cascade, the calendar view stays simple). A parent model would require either lazy materialization (more migration risk) or keeping both — neither pays for itself here. The series_uid tag delivers both asks with one additive migration and no behavior change for existing rows.

**One series_uid per employee** (not one per Add submission across all selected employees): if a user later edits Employee A's series, those changes shouldn't bleed into Employee B's rows even though they were created in the same modal submission.

## 3. Data model

File: `core/worklog/models.py` — add three nullable fields to `WorkPlan`.

| Field | Type | Notes |
|---|---|---|
| `series_uid` | `UUIDField(null=True, blank=True, db_index=True)` | One UUID per employee per Add-modal submission with recurrence ≠ one-time. NULL for one-time and legacy rows. |
| `recurrence` | `CharField(max_length=20, blank=True, default="")` | One of `"daily"`, `"weekly"`, `"monthly"`. Empty for one-time / legacy. Choices defined on the field for admin UX. |
| `recurrence_end_date` | `DateField(null=True, blank=True)` | The end date the user picked. Stamped identically on every row in a series. |

No constraints other than the index on `series_uid`. The three fields are all-or-none in practice (the frontend always sets all three together) but the model does not enforce that — we rely on the frontend / serializer to keep them consistent.

**Migration:** additive only, all columns nullable. No backfill — legacy rows stay NULL and are treated as one-time.

## 4. Backend API

### 4.1 Serializer (`core/worklog/serializers.py`)

`WorkPlanSerializer` exposes the three new fields:

- `series_uid`, `recurrence`, `recurrence_end_date` — readable on GET.
- Writable on POST (the Add flow needs to set them).
- **Read-only on PATCH** — the standard `PATCH /work_plans/{id}/` path must not allow the series tag to be reassigned. Use a separate endpoint for series-wide edits.

### 4.2 New endpoint: apply-to-following

`POST /work_plans/{id}/apply_to_following/`

Body (all keys optional, at least one required):

```json
{
  "date": "YYYY-MM-DD",
  "task_description": "...",
  "planned_hours": "2.50",
  "client": "<client-master-uid>"
}
```

Behavior:

1. Load source row by `id`. 404 if not found, 403 if the caller can't write it (same permission check as the existing PATCH).
2. Reject with 400 if source has `series_uid IS NULL` (caller shouldn't have reached this endpoint).
3. Inside a single `transaction.atomic()`:
   - Select all rows where `series_uid = source.series_uid AND date >= source.date`, ordered by date.
   - Compute `delta = new_date - source.date` if `date` is in the payload, else `None`.
   - Loop over each row and apply the changed fields (`task_description`, `planned_hours`, `client` get the new value; `date` gets `row.date + delta` when delta is set), then `row.save()`. Loop+save (not `.update()`) so the `auto_now` `updated_at` ticks on each row — the existing audit/log layer relies on it.
4. Return `{"updated_count": N}`.

### 4.3 Permissions

Reuse the existing `WorkPlanViewSet` permission class. The endpoint is added as an `@action(detail=True, methods=["post"])` on the existing viewset so it inherits org filtering, ownership checks, and authentication.

## 5. Frontend

### 5.1 Types

`frontend/task-tracker/src/types/api/workPlan.ts` — add the three fields to `WorkPlanDto` (all optional / nullable):

```ts
series_uid?: string | null;
recurrence?: "" | "daily" | "weekly" | "monthly";
recurrence_end_date?: string | null;  // YYYY-MM-DD
```

`frontend/task-tracker/src/types/worklog.ts` — surface them on the UI-facing `WorkPlan` type as well, so the table can read them off `row`.

`frontend/task-tracker/src/lib/api/mappers.ts` — pass the three fields through the DTO→model mapper.

### 5.2 `PlanAddModal.tsx`

In `handleSave`, before the per-employee loop:

- If `recur !== "onetime"`: continue per-employee; otherwise the three fields stay empty.
- Inside the loop, for each employee, generate `const empSeriesUid = crypto.randomUUID()` **once per employee** (not once per date).
- Attach `series_uid: empSeriesUid, recurrence: recur, recurrence_end_date: endDate` to every body for that employee.
- One-time submissions: leave `series_uid = null, recurrence = "", recurrence_end_date = null`.

### 5.3 List view: Recurrence column

`WorkPlanTab.tsx` — insert a "Recurrence" column **between Client and Planned Task** in the header array and in each row.

Render rule for the cell:

- `row.series_uid` is falsy → `—`.
- Otherwise → small badge:
  - icon by recurrence (`☀️` daily, `🔁` weekly, `📆` monthly)
  - label `Daily` / `Weekly` / `Monthly`
  - ` · ends ${formatDDMMYYYY(recurrence_end_date)}`

Example: `🔁 Weekly · ends 31/07/2026`.

Use a styled `<span>` mirroring the existing client chip styling (rounded, light blue/violet) for visual consistency.

### 5.4 Edit-scope prompt

Today `saveEdit(id)` in `WorkPlanTab.tsx` calls `apiPatch` directly. New behavior:

- If the row being saved has no `series_uid` → existing path, no prompt.
- If the row has a `series_uid` → open a small inline modal (not `window.confirm`) anchored over the row. Show:
  - The fields that changed (label + before → after).
  - Two buttons: **This entry only** and **This and following entries**.
  - A Cancel link that returns to the edit row without saving.

"This entry only" → existing `apiPatch` path. "This and following entries" → POST to `apply_to_following` with only the fields that actually changed (compare `editRows[id]` against `row` field-by-field).

After either save path, reload via `load()` and `cancelEdit(id)`.

## 6. Edge cases & decisions

- **Editing a row's date in series scope shifts later rows by the same delta.** Weekly Thursdays → Fridays for this row and all later rows. The user confirmed this is the desired behavior.
- **Legacy rows stay one-time forever.** No retro-grouping. If users want to retro-tag past rows, that's a future feature.
- **Recurrence type is not editable post-creation.** To change cadence, the user deletes the series (bulk-select all rows with this `series_uid`) and re-adds. This is out-of-scope here.
- **Deleting a row in the middle of a series leaves earlier and later rows intact.** No cascade — same as today. The `series_uid` group can be sparse without issue.
- **Bulk delete already exists.** No changes needed; a future enhancement could add "delete series" but is not part of this scope.
- **Holidays / Sundays.** The Add modal already filters those at expansion time. The `apply_to_following` date-shift does **not** re-filter — if the user shifts a series by 1 day onto a Sunday, the Sunday row persists. Calling out so we don't silently lose rows.

## 7. Testing

### Backend (`core/worklog/tests.py`)

- POST with recurrence=weekly creates N rows; every row has the same `series_uid`, `recurrence="weekly"`, `recurrence_end_date` matches the user's end date.
- POST one-time creates a row with `series_uid IS NULL` and `recurrence=""`.
- POST with recurrence=weekly for two employees in one Add submission yields two distinct `series_uid` values.
- PATCH `/work_plans/{id}/` ignores changes to `series_uid` / `recurrence` / `recurrence_end_date`.
- `apply_to_following`:
  - Updates this row and all later rows in the same series; doesn't touch earlier rows.
  - Doesn't touch rows from a different `series_uid` even if they overlap in date.
  - Date-shift: delta is applied uniformly; per-row save advances `updated_at`.
  - 400 when source has NULL `series_uid`.
  - 403 / 404 honour the existing permission rules.
  - All field updates happen inside a single transaction (force one row to fail validation and assert the others did not change).

### Frontend (`frontend/task-tracker/src/__tests__/...`)

- `PlanAddModal` integration: generates one `series_uid` per employee and reuses it across all dates for that employee.
- `WorkPlanTab` render: recurrence column shows `—` for one-time, badge with end date for series.
- Edit-scope modal appears only when the edited row has `series_uid`; "This entry only" calls PATCH, "This and following entries" calls the new endpoint with only the changed fields.

## 8. Out of scope

- Retroactive tagging of legacy rows as a series.
- Changing recurrence cadence on an existing series.
- "Delete series" action (separate from existing bulk-delete).
- Calendar view changes — recurrence info is list-only for this iteration.
- Notifying assigned employees when a series edit changes their future plans.
