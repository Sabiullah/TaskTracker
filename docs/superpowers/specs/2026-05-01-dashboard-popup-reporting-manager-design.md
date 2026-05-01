# Reporting Manager column + admin full-edit in dashboard popup

**Date:** 2026-05-01
**Branch:** `Reporting_Manager-Addn`
**Scope:** Frontend only. Backend `Task.reporting_manager` field already shipped on this branch (commits `b17d101`, `f04a2f1`).

## Summary

The dashboard's drill-down popup ([`TaskDrillModal.tsx`](../../../frontend/task-tracker/src/components/dashboard/TaskDrillModal.tsx)) — opened by clicking a member or client hyperlink in `TeamTable`/`ClientTable` — currently shows seven data columns and supports inline editing of dates and remarks only. This change:

1. Adds a **Reporting Manager** column (display only) to that popup.
2. For **admins**, replaces the inline-edit row-click behavior with **opening the existing board `TaskModal`** so every field on the task can be edited.

Manager and regular-user behavior is unchanged.

The full-page drilldown ([`TaskDetailTable.tsx`](../../../frontend/task-tracker/src/components/dashboard/TaskDetailTable.tsx)) is **not** in scope.

## Motivation

The Reporting Manager field exists on the `Task` model and is already populated in the API → domain mapper ([`mappers.ts:128`](../../../frontend/task-tracker/src/lib/api/mappers.ts:128)), but it isn't surfaced anywhere in the dashboard drill-downs — so admins reviewing a member's overdue tasks can't see who the reporting manager is without leaving the dashboard. Admins also need a way to fix any task field (description, client, responsible, reporting manager, recurrence, etc.) without navigating away to the board.

## Non-goals

- Inline-editing of Description / Client / Responsible / Reporting Manager directly in the popup table cells. Admins go through the existing `TaskModal` instead — it's the proven editor used on the board, and reusing it avoids duplicating dropdown plumbing.
- Changes to `TaskDetailTable.tsx` (the full-page drilldown). Confirmed out of scope by user.
- Backend or API contract changes. The `reporting_manager` field is already in the DTO and domain `Task` type.

## Architecture

### Where the popup is mounted today

- `App.tsx` mounts `DashboardPage` and already passes `onAddTask={() => openAddModal("Pending")}` and `onPatchTask={patchTask}`.
- `App.tsx` already mounts the `TaskModal` itself at app level (driven by `modal.open` state) and owns `openEditModal(task)` ([`App.tsx:226-229`](../../../frontend/task-tracker/src/App.tsx:226)) and `handleSaveTask` ([`App.tsx:260-296`](../../../frontend/task-tracker/src/App.tsx:260)) — the latter already handles `reportingManager` → `reporting_manager` UID resolution.
- `DashboardPage` → `TeamTable`/`ClientTable` → `TaskDrillModal` is the chain that renders the popup.

### Plumbing change

Add a new optional callback prop `onEditTaskFull?: (task: Task) => void` and thread it through:

```
App.tsx
  └─ DashboardPage  (forwards as prop)
       └─ TeamTable / ClientTable  (forwards as prop)
            └─ TaskDrillModal  (consumes)
```

`App.tsx` passes its existing `openEditModal` as `onEditTaskFull`. No new state, no new modal — the existing app-level `TaskModal` is reused.

### Row-click behavior in `TaskDrillModal`

```
isAdmin && onEditTaskFull   →  call onEditTaskFull(task), close popup, do NOT enter inline-edit mode
isManager (not admin)       →  inline-edit (Target Date + Expected Date + Comp Date + Remarks) — unchanged
regular user                →  inline-edit (Expected Date + Comp Date + Remarks) — unchanged
```

The popup closes (`onClose()`) when admin opens the full editor — a modal-on-modal stack is jarring, and after the admin saves, the dashboard re-renders with the updated task. If the admin needs to view the popup again they can click the hyperlink. (If user feedback says the popup should stay open, this is a one-line change.)

### Sync after admin save

After `TaskModal` saves through `handleSaveTask` in `App.tsx`, `useTasks` updates the `tasks` state, which propagates down to the dashboard. The popup is now closed (per above), so no in-popup sync is needed for the admin path.

For the existing inline-edit path (managers/users), the popup currently does NOT have a `useEffect` resetting `localTasks` when `tasks` props change — see [`TaskDrillModal.tsx:27`](../../../frontend/task-tracker/src/components/dashboard/TaskDrillModal.tsx:27). This is a pre-existing bug for managers/users (a stale local copy after save), but it's out of scope for this change. Mirroring the `useEffect` pattern from [`TaskDetailTable.tsx:43-45`](../../../frontend/task-tracker/src/components/dashboard/TaskDetailTable.tsx:43) is a minor improvement we **will** include since it's cheap and supports admin re-opening the popup with fresh data.

## Detailed changes

### 1. `frontend/task-tracker/src/components/dashboard/TaskDrillModal.tsx`

**Props:**
- Add optional `onEditTaskFull?: (task: Task) => void`.

**Imports:**
- `useAuth`: also pull `isAdminInAny`.

**Body:**
- `const isAdmin = isAdminInAny();`
- Add `useEffect(() => { setLocalTasks(tasks); }, [tasks]);` so the popup reflects updates from upstream.
- Update header hint:
  - admin → `"✏️ Click a row to edit any field"`
  - manager → existing string with Target Date
  - user → existing string without Target Date
- In the row's `onClick`, branch on `isAdmin && onEditTaskFull`:
  ```ts
  onClick={() => {
    if (ed) return;                       // already editing → ignore
    if (isAdmin && onEditTaskFull) {
      onEditTaskFull(t);
      onClose();
      return;
    }
    startEdit(t);
  }}
  ```

**Table columns (header row):**
Insert `"Reporting Manager"` between `"Responsible"` and `"Status"`. Final order:
```
# · Description · Client · Responsible · Reporting Manager · Status · Target Date · Expected Date · Comp Date · Remarks · (actions)
```

**Table cells (body row):**
Add a new `<td>` after the Responsible cell rendering `t.reportingManager || "—"` with the same muted styling as Responsible:
```tsx
<td style={{ padding: "7px 12px", color: "#64748b", fontSize: 12, whiteSpace: "nowrap" }}>
  {t.reportingManager || "—"}
</td>
```

The new cell is **never** part of inline-edit mode — there's no `ed`-branch, no input. Admins edit it via the full TaskModal.

### 2. `frontend/task-tracker/src/components/dashboard/TeamTable.tsx`

- Add optional prop `onEditTaskFull?: (task: Task) => void` to `TeamTableProps`.
- Forward to `<TaskDrillModal onEditTaskFull={onEditTaskFull} ... />`.

### 3. `frontend/task-tracker/src/components/dashboard/ClientTable.tsx`

Same as TeamTable: accept and forward the prop.

### 4. `frontend/task-tracker/src/pages/DashboardPage.tsx`

- Add `onEditTaskFull?: ((task: Task) => void) | null` to `DashboardPageProps`.
- Forward the prop to both `<TeamTable>` and `<ClientTable>`.
- (No need to pass it to `TaskDetailTable` — out of scope.)

### 5. `frontend/task-tracker/src/App.tsx`

In the `dashboard` view of `VIEW_MAP`, pass `onEditTaskFull={openEditModal}`:
```tsx
<DashboardPage
  tasks={tasks}
  profile={profile}
  profiles={profiles}
  onAddTask={() => openAddModal("Pending")}
  onPatchTask={patchTask}
  onEditTaskFull={openEditModal}
/>
```

## Tests

New unit test: `frontend/task-tracker/src/__tests__/components/dashboard/TaskDrillModal.test.tsx` (or extend an existing test if one exists — verify during implementation).

Cases:

1. **Reporting Manager column renders.** Mount with a task whose `reportingManager === "Alice K"`. Assert the header `"Reporting Manager"` is present and the row shows `"Alice K"`.
2. **Reporting Manager fallback.** Task with empty `reportingManager` → cell shows `"—"`.
3. **Admin row-click opens full editor.** Mock `useAuth` to return admin. Pass `onEditTaskFull` mock and `onClose` mock. Click a row. Assert `onEditTaskFull` called with that task AND `onClose` called. Assert no `<input>` appears (inline-edit didn't start).
4. **Manager row-click still inline-edits.** Mock `useAuth` to return manager (not admin). Click a row. Assert inputs appear for Target/Expected/Comp dates + remarks. Assert `onEditTaskFull` NOT called.
5. **User row-click still inline-edits without Target Date input.** Mock useAuth to return regular user. Click row. Assert Expected/Comp/Remarks inputs appear, no Target Date input.
6. **`useEffect` sync.** Re-render with a different `tasks` prop. Assert the table reflects the new tasks (regression coverage for the new sync effect).

`useAuth` is mocked in existing tests under `frontend/task-tracker/src/__tests__/` — follow the same pattern.

## Verification checklist

- [ ] Run `npm run typecheck` (TypeScript) in `frontend/task-tracker/`.
- [ ] Run `npm run test` — new test file passes plus existing dashboard tests still pass.
- [ ] Run `npm run lint`.
- [ ] Manual: open dashboard as admin, click a member name → popup shows Reporting Manager column → click a row → board's TaskModal opens with the task pre-filled including Reporting Manager → edit and save → popup is closed → re-open the popup, the row shows the updated values.
- [ ] Manual: open dashboard as a manager (non-admin) → popup row-click still triggers inline editing of Target/Expected/Comp/Remarks.
- [ ] Manual: open dashboard as a regular user → popup row-click still inline-edits Expected/Comp/Remarks only.

## Risks and rollback

- **Low risk.** No backend, no API, no schema. Frontend-only, additive prop.
- **Failure mode:** if `onEditTaskFull` isn't wired through, admins fall back to the manager inline-edit behavior — degraded but not broken.
- **Rollback:** revert the single feature commit on this branch.
