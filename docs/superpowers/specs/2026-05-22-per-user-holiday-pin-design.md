# Per-User Holiday Pin (HD) on the Attendance Matrix

**Date:** 2026-05-22
**Status:** Approved (brainstorm)
**Area:** Attendance → Matrix view
**Branch:** Holiday_Sel

## Problem

The Matrix view on the Employee Management page already lets an admin pin a single (user, date) cell to **Present / Half Day / Absent / Leave** via an inline picker, backed by `POST /attendance/set_status/`. There is no equivalent for **Holiday (HD)**: today, HD only appears on dates that exist in the `Holiday` table (org-wide or global, since `Holiday.date` is `unique=True`) or on Sundays.

Real-world need: admins occasionally grant a holiday to a subset of employees based on a regional function (Eid for one community, Pongal for another, a religious/community day-off, an off-cycle local function). With the current model the admin has no way to record that — they must either fake it as "Leave" (skews leave balances and counts) or do nothing.

## Goal

Let an admin mark **any day** as Holiday (HD) for **one specific employee** by clicking that user's cell in the Matrix view and choosing "Holiday". One-click, same UX as the existing Present/Half Day/Absent/Leave pin.

## Scope

In scope:

- Adding `"Holiday"` to `Attendance.STATUS_CHOICES`.
- Extending `POST /attendance/set_status/` to accept `"Holiday"`. Same admin-in-target-org permission check.
- Extending `core/attendance/matrix.py::derive_cell` so the `manual_status_override` branch returns `{"code": "HD", "holiday_name": "Regional Holiday"}` when `status == "Holiday"`.
- Adding a 5th option to the `MatrixCell` picker: `{ code: "HD", status: "Holiday", label: "Holiday" }`.
- Broadening the frontend `StatusValue` type in `AttendanceMatrixView.tsx` to include `"Holiday"`.

Out of scope (YAGNI):

- Bulk "mark Holiday for these N employees on this date" multi-select. The single-cell pin covers the stated use case; revisit if marking many people one-by-one becomes painful.
- Per-user `Holiday` table (FK to users). Heavier data-model change with no current need — overriding `Attendance.status` is sufficient.
- Custom holiday name per pin or a name-entry prompt. Auto-labeled `"Regional Holiday"` per the brainstorm decision.
- "Clear pin" button. Parity with the existing picker — to revert, the admin picks a different status.
- Treating a pinned Holiday day with punches as `HW` (Holiday Worked). Override is sticky: pinned HD stays HD regardless of punches, matching the existing override semantics for the other four codes.

## Approach

Backend stores the pin as `Attendance.status = "Holiday"` with `manual_status_override = True`. The matrix renderer recognises the new status and emits the existing `HD` cell code. The frontend gets one extra picker option; everything else (style, legend, totals column, realtime push) already handles HD today.

The `manual_status_override` branch in `derive_cell` already sits above the Sunday/holiday/leave rules, so the pin is sticky on **any** day (regular weekday, Sunday, or even an existing org-wide holiday date). The open-punch `?` rule still wins because that represents a data-integrity issue the admin must fix at the source — same trade-off as the other four pinned statuses.

## Components and data flow

```
[Admin clicks a cell in Matrix view]
    └─→ MatrixCell.tsx picker → onStatusChange("Holiday")
         └─→ AttendanceMatrixView.handleStatusChange
              └─→ POST /attendance/set_status/ { user_uid, date, status: "Holiday" }
                   └─→ AttendanceViewSet.set_status
                        ├─ admin-in-target-org check (unchanged)
                        ├─ upsert Attendance row, status="Holiday",
                        │   manual_status_override=True
                        └─ broadcast("attendance", INSERT|UPDATE)
                              └─→ ws subscription → useAttendanceMatrix.reload()
                                   └─→ matrix re-renders, cell shows "HD"
```

## Backend changes

### 1. `core/attendance/models.py`

Add `"Holiday"` to `Attendance.STATUS_CHOICES` (current set: Present, Absent, Half Day, Leave). Update `_derive_status` only if needed — `_derive_status` should leave the status untouched when `manual_status_override=True`, which it already does, so adding `"Holiday"` as a stored value is safe.

### 2. `core/attendance/views.py::AttendanceViewSet.set_status`

Replace the hard-coded tuple:

```python
if status not in ("Present", "Absent", "Half Day", "Leave"):
    raise ValidationError(...)
```

with:

```python
if status not in ("Present", "Absent", "Half Day", "Leave", "Holiday"):
    raise ValidationError(...)
```

No other changes — the admin-in-target-org check, the upsert/broadcast logic, and the `manual_status_override=True` flag are already correct for the new status.

### 3. `core/attendance/matrix.py::derive_cell`

In the existing `manual_status_override` branch, add one clause **above** the `"Absent"` line:

```python
if s == "Holiday":
    return {"code": "HD", "holiday_name": "Regional Holiday"}
```

That's it. The override branch already runs before the `is_holiday or Sunday` rule and before the leave-session rules, so a pinned Holiday day will always render as `HD` (unless there's an open punch, which is still treated as `?` upstream).

### 4. Migration

Adding a new choice to `Attendance.STATUS_CHOICES` is a Django model-state change that requires a migration even though no column shape changes. Generate `core/attendance/migrations/0006_attendance_status_holiday_choice.py` via `makemigrations`.

## Frontend changes

### 1. `frontend/task-tracker/src/components/attendance/MatrixCell.tsx`

Append one entry to `PICKER_OPTIONS`:

```typescript
{ code: "HD", status: "Holiday", label: "Holiday" }
```

Broaden the `onStatusChange` prop type and `PICKER_OPTIONS` element type to include the new `"HD"` code and `"Holiday"` status. The picker is already laid out vertically, so a 5th row fits without restyling.

### 2. `frontend/task-tracker/src/components/attendance/AttendanceMatrixView.tsx`

Broaden `StatusValue`:

```typescript
type StatusValue = "Present" | "Absent" | "Half Day" | "Leave" | "Holiday";
```

`handleStatusChange` already forwards `status` directly into the POST body — no other change.

### 3. `matrixCells.ts`

No edits. `CELL_STYLE.HD`, `CELL_LABEL.HD`, and the `HD` slot in `totalsFor` already exist (since HD is rendered today from the `Holiday` table). The HD column will start reflecting per-user pins for free.

### 4. Totals row

`TOTAL_COLS` in `AttendanceMatrixView` currently lists `["P", "H", "L", "WFH", "HW", "?", "WP"]` — note **HD is not in the totals strip**, only the cell legend. That's intentional today because HD is org-wide and constant per row. We leave `TOTAL_COLS` as-is for this change; per-user HD counts are visible by scanning the row, and the legend explains the code. If users later ask for an HD total column, that's a one-line follow-up.

## Edge cases

| Scenario | Result |
|---|---|
| Pin Holiday on a regular weekday | Cell shows `HD` |
| Pin Holiday on a Sunday | Cell shows `HD` (no semantic change — it was HD anyway, but the override is now explicit) |
| Pin Holiday on an existing org-wide holiday date | Cell shows `HD` (no change) |
| Pin Holiday on a day with punches | Cell shows `HD` — override is sticky, `HW` is not auto-applied. Admin must un-pin (pick another status) to see HW. |
| Pin Holiday on a day with an open punch (`?`) | Cell still shows `?` — open-punch rule wins. Admin must fix the punch first. |
| Pin Holiday on a day with an approved Leave row | Cell shows `HD` — override branch runs before the leave-session rules. Leave balance is unaffected (no LeaveRequest row was touched). |
| Non-admin sends `set_status` with `"Holiday"` | 403 (existing admin-in-target-org check, unchanged). |
| Admin sends `set_status` with an unknown status | 400 (existing validation, with the expanded allow-list). |

## Tests

### Backend

`core/attendance/test_matrix.py`:

- `derive_cell` returns `{code: "HD", holiday_name: "Regional Holiday"}` when `attendance.manual_status_override=True` and `attendance.status="Holiday"`, on a regular weekday.
- Same input on a Sunday → still `HD`.
- Same input plus an open punch (login without logout) → `?` wins.

`core/attendance/tests.py`:

- `POST /attendance/set_status/ {status: "Holiday"}` as admin in target's org → 200/201, row has `status="Holiday"`, `manual_status_override=True`.
- Same call as a non-admin → 403.
- Same call with `status="HD"` (the cell code, not the status string) → 400.
- Existing `set_status` tests for Present/Absent/Half Day/Leave continue to pass.

### Frontend

`frontend/task-tracker/src/__tests__/components/attendance/matrixCell.behavior.test.tsx`:

- The picker, when opened, renders 5 options including one labelled "Holiday" with code "HD".
- Clicking the Holiday option calls `onStatusChange("Holiday")` and closes the picker.

## Risks

- **None significant.** The change reuses the existing override pipeline end-to-end. The only data-model change is one new enum value, and the matrix renderer's existing priority order already does the right thing.
- **Realtime:** `set_status` already broadcasts on the `attendance` channel, which both List and Matrix views subscribe to. No new socket plumbing.
- **CSV export** in `AttendanceMatrixView.exportMatrixCsv` reads the cell `code` directly, so HD pins will appear in the export automatically.

## Rollout

Single PR. No feature flag. Migration runs in the normal deploy step. No data backfill — pinned holidays only exist going forward, as admins click them in.
