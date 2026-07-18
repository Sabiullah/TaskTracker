# Task creator + creation-time display

**Date:** 2026-07-18
**Branch:** `Task_Create_log`
**Status:** Approved design

## Problem

Tasks can be created by any user at any time. There is currently no visible
indication of **who** created a task and **when**. Users need to see the
creator and creation timestamp both while browsing the Board and while viewing
a specific task.

## Scope

Frontend display-only change. **No backend, model, migration, or serializer
changes** — the data already exists:

- `Task.created_by` (FK to user) is set on every create in
  `core/tasks/views.py` (`serializer.save(created_by=user, ...)`).
- `Task.created_at` is inherited from `TimeStampedModel`.
- The API already serves both via `created_by_detail` (a `UserMin` with
  `full_name`) and `created_at` in `TaskSerializer`.

## Design

### 1. Carry the creator name into the domain model

The frontend domain `Task` currently maps `createdBy` to the creator's **uid**
only (`src/lib/api/mappers.ts`), which is not enough to render a name on a card.
Add the display name, mirroring how `responsible`/`reportingManager` already map
to `full_name`.

- `src/types/task.ts`: add `createdByName: string` to the domain `Task`.
- `src/lib/api/mappers.ts` (`dtoToTask`): add
  `createdByName: dto.created_by_detail?.full_name ?? ""`.
  `createdAt: dto.created_at` already flows through — unchanged.

### 2. Date/time formatting helpers

Add two small helpers to `src/utils/date.ts` (existing `fmtDate`/`fmtFull`
include the year and don't match the requested style):

- `fmtCreatedAt(dt)` → `"18 Jul 15:42"` — day (numeric), month (short), 24-hour
  `HH:MM`, **no year**. Returns `""` for null/empty.
- `fmtCreatedDate(dt)` → `"18 Jul"` — day (numeric), month (short). Returns `""`
  for null/empty.

Both accept a full ISO datetime string (`createdAt`), unlike `fmtDate` which
expects a `YYYY-MM-DD` date. Use `toLocaleString("en-GB", { ..., hour12: false })`.

### 3. Edit Task modal — full detail at the top

`src/components/board/TaskModal.tsx`: under the header title (`Edit Goal #N`),
render a subtle meta line **only when editing an existing task** (`task` truthy)
**and** a creator is present:

> Created by **Aravindh** · 18 Jul 15:42

- Hidden on the "Add New Task" form (a new task has no creator yet).
- Hidden when `createdByName` is empty (legacy rows with `created_by = null`) —
  do not render "Created by —".
- Uses `fmtCreatedAt(task.createdAt)`.

### 4. Board cards — compact detail

`src/components/board/TaskCard.tsx`: add a small muted footer line:

> Created by Aravindh · 18 Jul

- Date only, via `fmtCreatedDate(task.createdAt)`.
- Hidden when `createdByName` is empty.
- Applies to sub-task cards too (they are `Task` rows).

### 5. Styling

Reuse existing muted/secondary text styling already used for card meta lines
(match the surrounding component's tokens/classes — no new global styles unless
none fit).

## Edge cases

- **Legacy tasks** with `created_by = null` → the line is omitted entirely on
  both surfaces.
- **Add-New modal** → no meta line (no creator/timestamp yet).
- **Timezone** → rendered in the viewer's local time via `toLocaleString`,
  consistent with other timestamps in the app.

## Testing

- **Mapper test** (`dtoToTask`): `created_by_detail.full_name` →
  `createdByName`; null detail → `""`.
- **Formatter test**: `fmtCreatedAt` / `fmtCreatedDate` produce
  `"18 Jul 15:42"` / `"18 Jul"` for a known datetime; `""` for null.
- **TaskModal test**: meta line shown when editing with a creator; hidden on
  add; hidden when `createdByName` empty.
- **TaskCard test**: compact line shown with creator; hidden when empty.

## Out of scope

- No column added to any tabular export.
- No change to the `TaskLog` audit trail or the log modal.
- No "last edited by" / update-time display (only creation).
