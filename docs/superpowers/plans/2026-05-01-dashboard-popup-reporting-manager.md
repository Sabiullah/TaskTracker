# Dashboard Popup — Reporting Manager Column + Admin Full-Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the existing `reportingManager` field in the dashboard's `TaskDrillModal` popup, and let admins open the board's full `TaskModal` editor by clicking a row.

**Architecture:** Frontend-only change. A new optional `onEditTaskFull?: (task: Task) => void` callback is threaded `App.tsx → DashboardPage → TeamTable/ClientTable → TaskDrillModal`. App.tsx passes its existing `openEditModal` for this prop, reusing the already-mounted board `TaskModal` (which is self-contained — pulls its own masters via `useMasters`/`useProfiles`/`useAuth`). The popup also gains a display-only Reporting Manager column and a `useEffect` that resyncs `localTasks` when the `tasks` prop changes.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, @testing-library/react, jsdom.

**Spec:** [docs/superpowers/specs/2026-05-01-dashboard-popup-reporting-manager-design.md](../specs/2026-05-01-dashboard-popup-reporting-manager-design.md)

---

## File Structure

**Files modified:**
- `frontend/task-tracker/src/components/dashboard/TaskDrillModal.tsx` — new column + role-aware row click + sync effect
- `frontend/task-tracker/src/components/dashboard/TeamTable.tsx` — accept + forward `onEditTaskFull`
- `frontend/task-tracker/src/components/dashboard/ClientTable.tsx` — accept + forward `onEditTaskFull`
- `frontend/task-tracker/src/pages/DashboardPage.tsx` — accept + forward `onEditTaskFull`
- `frontend/task-tracker/src/App.tsx` — pass `openEditModal` as `onEditTaskFull`

**Files created:**
- `frontend/task-tracker/src/__tests__/components/dashboard/taskDrillModal.test.tsx` — behavior tests for the popup

---

## Task 1: Scaffold the test file with role mocks

**Files:**
- Create: `frontend/task-tracker/src/__tests__/components/dashboard/taskDrillModal.test.tsx`

**Why first:** Establishes the `useAuth` mock pattern and the test fixture used by all subsequent tasks. The codebase has no existing `useAuth` mock pattern, so this defines it once.

- [ ] **Step 1: Verify the target directory exists**

Run: `ls frontend/task-tracker/src/__tests__/components/`
Expected: directory listing including `attendance/`, `clients/`, etc. If `dashboard/` is absent it will be created in the next step.

- [ ] **Step 2: Create the test file with the harness, no test cases yet**

Create `frontend/task-tracker/src/__tests__/components/dashboard/taskDrillModal.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { Task } from "@/types";

const mockUseAuth = vi.fn();
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

import TaskDrillModal from "@/components/dashboard/TaskDrillModal";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    serialNo: 1,
    client: "Acme",
    category: "Audit",
    description: "Review Q1 ledger",
    status: "Overdue",
    targetDate: "2026-04-25",
    expectedDate: "",
    completedDate: "",
    responsible: "Akilan",
    reportingManager: "",
    remarks: "",
    recurrence: "Onetime",
    organization: "org-1",
    createdBy: null,
    createdAt: null,
    ...overrides,
  };
}

function setRole(role: "admin" | "manager" | "user") {
  mockUseAuth.mockReturnValue({
    isAdminInAny: () => role === "admin",
    isManagerInAny: () => role === "admin" || role === "manager",
  });
}

beforeEach(() => {
  cleanup();
  mockUseAuth.mockReset();
});

describe("TaskDrillModal — module shape", () => {
  it("is a function component", () => {
    expect(typeof TaskDrillModal).toBe("function");
  });
});
```

- [ ] **Step 3: Run the smoke test**

Run: `npm --prefix frontend/task-tracker test -- taskDrillModal`
Expected: 1 test passes (the smoke test). If you see import errors for `@/types` or `@/components/dashboard/TaskDrillModal`, the path alias isn't resolving — check `vite.config.ts` for the `@` alias before continuing.

- [ ] **Step 4: Commit**

```bash
git add frontend/task-tracker/src/__tests__/components/dashboard/taskDrillModal.test.tsx
git commit -m "test(dashboard): scaffold TaskDrillModal test harness with role mock"
```

---

## Task 2: Test — Reporting Manager column renders (failing test first)

**Files:**
- Modify: `frontend/task-tracker/src/__tests__/components/dashboard/taskDrillModal.test.tsx`

- [ ] **Step 1: Add the failing test cases**

Append inside the existing test file, after the module-shape `describe`:

```tsx
describe("TaskDrillModal — Reporting Manager column", () => {
  it("renders a Reporting Manager header and cell value", () => {
    setRole("user");
    const tasks = [makeTask({ reportingManager: "Sabiullah N" })];
    render(
      <TaskDrillModal
        title="Akilan — Overdue"
        tasks={tasks}
        onClose={() => {}}
        profile={null}
      />,
    );
    expect(screen.getByText("Reporting Manager")).toBeTruthy();
    expect(screen.getByText("Sabiullah N")).toBeTruthy();
  });

  it("renders an em-dash when reportingManager is empty", () => {
    setRole("user");
    const tasks = [makeTask({ reportingManager: "" })];
    render(
      <TaskDrillModal
        title="Akilan — Overdue"
        tasks={tasks}
        onClose={() => {}}
        profile={null}
      />,
    );
    // Multiple "—" cells exist (Expected, Comp, Remarks fallbacks). Find the one
    // in the same row and column. Cells render plain text — count em-dash text
    // nodes, expect >= 4 (Expected + Comp + Remarks + ReportingManager).
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(4);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npm --prefix frontend/task-tracker test -- taskDrillModal`
Expected: both new tests FAIL — the column does not yet exist. Error will say `Unable to find an element with the text: Reporting Manager`.

- [ ] **Step 3: Commit the failing test**

```bash
git add frontend/task-tracker/src/__tests__/components/dashboard/taskDrillModal.test.tsx
git commit -m "test(dashboard): assert Reporting Manager column in TaskDrillModal (red)"
```

---

## Task 3: Implement — Reporting Manager column in TaskDrillModal

**Files:**
- Modify: `frontend/task-tracker/src/components/dashboard/TaskDrillModal.tsx`

- [ ] **Step 1: Add the column header**

In `TaskDrillModal.tsx`, the header row is built from a string array starting around [line 191-202](../../../frontend/task-tracker/src/components/dashboard/TaskDrillModal.tsx:191). Replace:

```tsx
                  {[
                    "#",
                    "Description",
                    "Client",
                    "Responsible",
                    "Status",
                    "Target Date",
                    "Expected Date",
                    "Comp Date",
                    "Remarks",
                    "",
                  ].map((h) => (
```

with:

```tsx
                  {[
                    "#",
                    "Description",
                    "Client",
                    "Responsible",
                    "Reporting Manager",
                    "Status",
                    "Target Date",
                    "Expected Date",
                    "Comp Date",
                    "Remarks",
                    "",
                  ].map((h) => (
```

- [ ] **Step 2: Add the body cell**

The body cells appear inside `localTasks.map((t, i) => {...})` around [line 220-450](../../../frontend/task-tracker/src/components/dashboard/TaskDrillModal.tsx:220). Find the Responsible cell:

```tsx
                      <td
                        style={{
                          padding: "7px 12px",
                          color: "#64748b",
                          fontSize: 12,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {t.responsible || "—"}
                      </td>
```

Immediately after it (and before the Status `<td>` containing the colored span), insert a new cell:

```tsx
                      <td
                        style={{
                          padding: "7px 12px",
                          color: "#64748b",
                          fontSize: 12,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {t.reportingManager || "—"}
                      </td>
```

- [ ] **Step 3: Run the tests to confirm they pass**

Run: `npm --prefix frontend/task-tracker test -- taskDrillModal`
Expected: all 3 tests in the file pass (smoke + 2 column tests).

- [ ] **Step 4: Commit**

```bash
git add frontend/task-tracker/src/components/dashboard/TaskDrillModal.tsx
git commit -m "feat(dashboard): add Reporting Manager column to TaskDrillModal popup"
```

---

## Task 4: Test — admin row-click opens full editor (failing test first)

**Files:**
- Modify: `frontend/task-tracker/src/__tests__/components/dashboard/taskDrillModal.test.tsx`

- [ ] **Step 1: Add the failing tests**

Append after the existing describe blocks:

```tsx
describe("TaskDrillModal — row click behavior", () => {
  it("admin click calls onEditTaskFull and onClose, does NOT enter inline-edit", () => {
    setRole("admin");
    const onEditTaskFull = vi.fn();
    const onClose = vi.fn();
    const tasks = [makeTask()];
    render(
      <TaskDrillModal
        title="Akilan — Overdue"
        tasks={tasks}
        onClose={onClose}
        onEditTaskFull={onEditTaskFull}
        profile={null}
      />,
    );
    // Click on the description cell — clicking the row triggers onClick.
    fireEvent.click(screen.getByText("Review Q1 ledger"));
    expect(onEditTaskFull).toHaveBeenCalledWith(tasks[0]);
    expect(onClose).toHaveBeenCalled();
    // Inline-edit must NOT have started — no date inputs appear.
    expect(screen.queryAllByDisplayValue("2026-04-25")).toHaveLength(0);
  });

  it("manager click enters inline-edit with Target Date input", () => {
    setRole("manager");
    const onEditTaskFull = vi.fn();
    const onClose = vi.fn();
    render(
      <TaskDrillModal
        title="Team — Overdue"
        tasks={[makeTask()]}
        onClose={onClose}
        onEditTaskFull={onEditTaskFull}
        profile={null}
      />,
    );
    fireEvent.click(screen.getByText("Review Q1 ledger"));
    expect(onEditTaskFull).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // Target Date input should be present for managers.
    const dateInputs = document.querySelectorAll('input[type="date"]');
    expect(dateInputs.length).toBeGreaterThanOrEqual(3); // Target + Expected + Comp
  });

  it("regular user click enters inline-edit WITHOUT Target Date input", () => {
    setRole("user");
    const onEditTaskFull = vi.fn();
    render(
      <TaskDrillModal
        title="My — Tasks"
        tasks={[makeTask()]}
        onClose={() => {}}
        onEditTaskFull={onEditTaskFull}
        profile={null}
      />,
    );
    fireEvent.click(screen.getByText("Review Q1 ledger"));
    expect(onEditTaskFull).not.toHaveBeenCalled();
    // Only Expected + Comp date inputs (no Target Date) — exactly 2 date inputs.
    const dateInputs = document.querySelectorAll('input[type="date"]');
    expect(dateInputs.length).toBe(2);
  });

  it("when admin but no onEditTaskFull is passed, falls back to inline-edit", () => {
    // Defensive: prop is optional, so admins on a parent that didn't wire
    // it through still get a working popup (manager-style inline edit).
    setRole("admin");
    render(
      <TaskDrillModal
        title="Team — Overdue"
        tasks={[makeTask()]}
        onClose={() => {}}
        profile={null}
      />,
    );
    fireEvent.click(screen.getByText("Review Q1 ledger"));
    const dateInputs = document.querySelectorAll('input[type="date"]');
    expect(dateInputs.length).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npm --prefix frontend/task-tracker test -- taskDrillModal`
Expected: the 4 new tests FAIL. The first one fails because `onEditTaskFull` is not a prop yet, so TypeScript will also flag the unknown prop. If TS strict mode rejects the unknown prop in tests, the test file won't compile — adding the prop in Task 5 fixes both.

If the tests fail to even compile due to TS, that's still "red" — proceed to Task 5.

- [ ] **Step 3: Commit the failing tests**

```bash
git add frontend/task-tracker/src/__tests__/components/dashboard/taskDrillModal.test.tsx
git commit -m "test(dashboard): assert role-aware row click on TaskDrillModal (red)"
```

---

## Task 5: Implement — admin row-click opens full editor

**Files:**
- Modify: `frontend/task-tracker/src/components/dashboard/TaskDrillModal.tsx`

- [ ] **Step 1: Update the props interface**

In `TaskDrillModal.tsx`, find `TaskDrillModalProps` (lines 8-15) and add `onEditTaskFull`:

```tsx
export interface TaskDrillModalProps {
  title: string;
  tasks: Task[];
  onClose: () => void;
  onTaskUpdated?: () => void;
  onPatchTask?: (taskId: string, patch: { targetDate?: string | null; expectedDate?: string | null; completedDate?: string | null; remarks?: string }) => Promise<void>;
  onEditTaskFull?: (task: Task) => void;
  profile: Profile | null;
}
```

- [ ] **Step 2: Destructure the new prop and grab the admin flag**

Find the function signature at line 17 and update:

```tsx
export default function TaskDrillModal({
  title,
  tasks,
  onClose,
  onTaskUpdated,
  onPatchTask,
  onEditTaskFull,
  profile: _profile,
}: TaskDrillModalProps) {
  const { isAdminInAny, isManagerInAny } = useAuth();
  const isAdmin = isAdminInAny();
  const isPriv = isManagerInAny();
```

(Replaces the existing two lines `const { isManagerInAny } = useAuth();` / `const isPriv = isManagerInAny();`.)

- [ ] **Step 3: Branch the row click**

Find the `<tr ... onClick={() => !ed && startEdit(t)}` (around line 239) and replace its `onClick` with:

```tsx
                      onClick={() => {
                        if (ed) return;
                        if (isAdmin && onEditTaskFull) {
                          onEditTaskFull(t);
                          onClose();
                          return;
                        }
                        startEdit(t);
                      }}
```

- [ ] **Step 4: Update the helper-text hint**

Find the hint span around line 149-152:

```tsx
            <span style={{ fontSize: 11, color: "#64748b", marginLeft: 12 }}>
              ✏️ Click a row to edit {isPriv ? "Target Date, " : ""}Expected
              Date, Comp Date &amp; Remarks
            </span>
```

Replace with:

```tsx
            <span style={{ fontSize: 11, color: "#64748b", marginLeft: 12 }}>
              {isAdmin && onEditTaskFull
                ? "✏️ Click a row to edit any field"
                : `✏️ Click a row to edit ${isPriv ? "Target Date, " : ""}Expected Date, Comp Date & Remarks`}
            </span>
```

- [ ] **Step 5: Run the tests to confirm they pass**

Run: `npm --prefix frontend/task-tracker test -- taskDrillModal`
Expected: all 7 tests in the file pass (1 smoke + 2 column + 4 row-click).

- [ ] **Step 6: Run typecheck**

Run: `npm --prefix frontend/task-tracker run build`
Expected: no TypeScript errors. (Build runs `tsc -b` first; if you only want typecheck, `npx --prefix frontend/task-tracker tsc -b` works too.)

- [ ] **Step 7: Commit**

```bash
git add frontend/task-tracker/src/components/dashboard/TaskDrillModal.tsx
git commit -m "feat(dashboard): admins open full TaskModal from popup row click"
```

---

## Task 6: Test — `useEffect` resyncs popup with upstream task changes (failing test)

**Files:**
- Modify: `frontend/task-tracker/src/__tests__/components/dashboard/taskDrillModal.test.tsx`

- [ ] **Step 1: Add the failing test**

Append:

```tsx
describe("TaskDrillModal — sync with upstream tasks", () => {
  it("re-renders rows when the tasks prop changes", () => {
    setRole("user");
    const t1 = makeTask({ id: "a", description: "Original task" });
    const t2 = makeTask({ id: "b", description: "Updated task" });
    const { rerender } = render(
      <TaskDrillModal
        title="Test"
        tasks={[t1]}
        onClose={() => {}}
        profile={null}
      />,
    );
    expect(screen.getByText("Original task")).toBeTruthy();
    rerender(
      <TaskDrillModal
        title="Test"
        tasks={[t2]}
        onClose={() => {}}
        profile={null}
      />,
    );
    expect(screen.queryByText("Original task")).toBeNull();
    expect(screen.getByText("Updated task")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `npm --prefix frontend/task-tracker test -- taskDrillModal`
Expected: the new test FAILS — `localTasks` is initialized from `tasks` only on mount (`useState(tasks)` at line 27) and never resynced.

- [ ] **Step 3: Commit failing test**

```bash
git add frontend/task-tracker/src/__tests__/components/dashboard/taskDrillModal.test.tsx
git commit -m "test(dashboard): assert TaskDrillModal resyncs on tasks prop change (red)"
```

---

## Task 7: Implement — `useEffect` to resync `localTasks`

**Files:**
- Modify: `frontend/task-tracker/src/components/dashboard/TaskDrillModal.tsx`

- [ ] **Step 1: Add `useEffect` import**

At the top of `TaskDrillModal.tsx`, change:

```tsx
import { useState } from "react";
```

to:

```tsx
import { useState, useEffect } from "react";
```

- [ ] **Step 2: Add the sync effect**

Just after the `useState` declarations (after line 30 `const [saved, ...]`), add:

```tsx
  useEffect(() => {
    Promise.resolve().then(() => {
      setLocalTasks(tasks);
      setEdits({});
    });
  }, [tasks]);
```

(Mirrors the existing pattern in [TaskDetailTable.tsx:43-45](../../../frontend/task-tracker/src/components/dashboard/TaskDetailTable.tsx:43) — `Promise.resolve().then(...)` defers state update one microtask, avoiding "setState during render" warnings if the parent re-renders synchronously while the modal is mounting.)

- [ ] **Step 3: Run tests to confirm pass**

Run: `npm --prefix frontend/task-tracker test -- taskDrillModal`
Expected: all 8 tests pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/task-tracker/src/components/dashboard/TaskDrillModal.tsx
git commit -m "fix(dashboard): TaskDrillModal resyncs localTasks when tasks prop changes"
```

---

## Task 8: Forward `onEditTaskFull` through `TeamTable`

**Files:**
- Modify: `frontend/task-tracker/src/components/dashboard/TeamTable.tsx`

- [ ] **Step 1: Inspect existing props interface**

Run: `grep -n "interface.*Props\|export default function TeamTable\|TaskDrillModal" frontend/task-tracker/src/components/dashboard/TeamTable.tsx`
Use the line numbers to navigate. You're adding one optional prop and one prop pass-through.

- [ ] **Step 2: Add `onEditTaskFull` to the props interface**

Find the props interface (`TeamTableProps` or similar). Add:

```tsx
  onEditTaskFull?: (task: Task) => void;
```

- [ ] **Step 3: Destructure and forward**

In the function signature, add `onEditTaskFull` to the destructured props. Find the `<TaskDrillModal ... />` JSX and add the prop:

```tsx
        <TaskDrillModal
          title={drill.title}
          tasks={drill.tasks}
          // ... existing props ...
          onEditTaskFull={onEditTaskFull}
          profile={profile}
        />
```

- [ ] **Step 4: Verify TypeScript**

Run: `npm --prefix frontend/task-tracker run build`
Expected: passes. If a missing import for `Task` shows up, add `import type { Task } from "@/types";` (it's likely already imported at the top).

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/components/dashboard/TeamTable.tsx
git commit -m "feat(dashboard): TeamTable forwards onEditTaskFull to TaskDrillModal"
```

---

## Task 9: Forward `onEditTaskFull` through `ClientTable`

**Files:**
- Modify: `frontend/task-tracker/src/components/dashboard/ClientTable.tsx`

- [ ] **Step 1: Mirror the TeamTable change**

Repeat the same pattern as Task 8 in `ClientTable.tsx`:

1. Add `onEditTaskFull?: (task: Task) => void` to the props interface.
2. Destructure it in the function signature.
3. Forward it to `<TaskDrillModal onEditTaskFull={onEditTaskFull} ... />`.

- [ ] **Step 2: Verify TypeScript**

Run: `npm --prefix frontend/task-tracker run build`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add frontend/task-tracker/src/components/dashboard/ClientTable.tsx
git commit -m "feat(dashboard): ClientTable forwards onEditTaskFull to TaskDrillModal"
```

---

## Task 10: Forward `onEditTaskFull` through `DashboardPage`

**Files:**
- Modify: `frontend/task-tracker/src/pages/DashboardPage.tsx`

- [ ] **Step 1: Add to props interface**

Find `DashboardPageProps` (around [line 17](../../../frontend/task-tracker/src/pages/DashboardPage.tsx:17)) and add:

```tsx
  onEditTaskFull?: ((task: Task) => void) | null;
```

- [ ] **Step 2: Destructure with default**

Find the function signature (around [line 33](../../../frontend/task-tracker/src/pages/DashboardPage.tsx:33)) and add:

```tsx
export default function DashboardPage({
  tasks,
  profile,
  profiles = [],
  onAddTask = null,
  onPatchTask,
  onEditTaskFull = null,
}: DashboardPageProps) {
```

- [ ] **Step 3: Forward to TeamTable and ClientTable**

Find both `<TeamTable ... />` and `<ClientTable ... />` JSX usages and add the prop. The render of `TeamTable` is around [line 691-701](../../../frontend/task-tracker/src/pages/DashboardPage.tsx:691); add:

```tsx
                <TeamTable
                  tasks={filteredTasks}
                  teamNames={teamNames}
                  todayStr={todayStr}
                  onSelectMember={(name) =>
                    setDrillDown({ type: "member", value: name })
                  }
                  onTaskUpdated={() => {}}
                  onPatchTask={onPatchTask}
                  onEditTaskFull={onEditTaskFull ?? undefined}
                  profile={profile}
                />
```

And for `ClientTable` around [line 748-764](../../../frontend/task-tracker/src/pages/DashboardPage.tsx:748):

```tsx
                <ClientTable
                  tasks={filteredTasks}
                  // ... existing props ...
                  onEditTaskFull={onEditTaskFull ?? undefined}
                  profile={profile}
                />
```

(`?? undefined` because `null` doesn't satisfy the optional-`(task: Task) => void` typing on the children.)

- [ ] **Step 4: Verify TypeScript**

Run: `npm --prefix frontend/task-tracker run build`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/pages/DashboardPage.tsx
git commit -m "feat(dashboard): DashboardPage forwards onEditTaskFull"
```

---

## Task 11: Wire `openEditModal` through `App.tsx`

**Files:**
- Modify: `frontend/task-tracker/src/App.tsx`

- [ ] **Step 1: Locate the dashboard view in `VIEW_MAP`**

Find the `dashboard:` entry in `VIEW_MAP` (around [line 326-334](../../../frontend/task-tracker/src/App.tsx:326)):

```tsx
    dashboard: (
      <DashboardPage
        tasks={tasks}
        profile={profile}
        profiles={profiles}
        onAddTask={() => openAddModal("Pending")}
        onPatchTask={patchTask}
      />
    ),
```

- [ ] **Step 2: Add the prop**

Replace with:

```tsx
    dashboard: (
      <DashboardPage
        tasks={tasks}
        profile={profile}
        profiles={profiles}
        onAddTask={() => openAddModal("Pending")}
        onPatchTask={patchTask}
        onEditTaskFull={openEditModal}
      />
    ),
```

`openEditModal` is already defined at [line 226-229](../../../frontend/task-tracker/src/App.tsx:226) with signature `(task: Task) => void`.

- [ ] **Step 3: Verify TypeScript and lint**

Run: `npm --prefix frontend/task-tracker run build && npm --prefix frontend/task-tracker run lint`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/task-tracker/src/App.tsx
git commit -m "feat(dashboard): wire admin full-edit from popup via openEditModal"
```

---

## Task 12: Full test suite + manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm --prefix frontend/task-tracker test`
Expected: all suites pass — including the new `taskDrillModal.test.tsx` (8 tests) and existing tests untouched.

- [ ] **Step 2: Run the build**

Run: `npm --prefix frontend/task-tracker run build`
Expected: clean build, no TypeScript errors.

- [ ] **Step 3: Run lint**

Run: `npm --prefix frontend/task-tracker run lint`
Expected: clean.

- [ ] **Step 4: Manual smoke — admin path**

1. Start backend: `python manage.py runserver` (or use existing local URL `49.12.190.43:8000`).
2. Start frontend: `npm --prefix frontend/task-tracker run dev`.
3. Log in as an admin user (`Sabiullah` per the screenshot).
4. Open Dashboard → click a member name in the Team Performance table → popup opens.
5. **Verify:** Reporting Manager column header is present; values render or show `—` when blank.
6. **Verify:** Hint text reads `✏️ Click a row to edit any field`.
7. Click a row → popup closes, the board's TaskModal opens pre-filled with all fields including Reporting Manager.
8. Edit Reporting Manager (or any other field) → Save → modal closes.
9. Re-open the popup (click the member name again) → row reflects the new value.

- [ ] **Step 5: Manual smoke — manager path**

1. Log in as a non-admin manager.
2. Open Dashboard → click a member name → popup opens.
3. **Verify:** Reporting Manager column is visible (display only).
4. **Verify:** Hint text reads `✏️ Click a row to edit Target Date, Expected Date, Comp Date & Remarks`.
5. Click a row → inputs appear for Target / Expected / Comp / Remarks (no full TaskModal).

- [ ] **Step 6: Manual smoke — regular user path**

1. Log in as a non-manager.
2. Open Dashboard → click a member name → popup opens.
3. **Verify:** Reporting Manager column is visible.
4. **Verify:** Hint text reads `✏️ Click a row to edit Expected Date, Comp Date & Remarks` (no Target Date).
5. Click a row → inputs appear for Expected / Comp / Remarks only.

- [ ] **Step 7: Final commit (only if you discovered something to fix during manual verification — otherwise skip)**

If you found a defect, fix it, add a regression test, and commit. If verification was clean, no further commit.

---

## Self-Review

**Spec coverage:**
- ✓ Reporting Manager column added to popup → Tasks 2 & 3
- ✓ Admin row-click opens TaskModal → Tasks 4 & 5
- ✓ Manager / user inline-edit unchanged → Task 4 (negative tests)
- ✓ Hint text updated per role → Task 5 step 4
- ✓ Plumbing chain (App → DashboardPage → TeamTable/ClientTable → TaskDrillModal) → Tasks 8-11
- ✓ `useEffect` resync of `localTasks` → Tasks 6 & 7
- ✓ Out of scope: TaskDetailTable left untouched (no task modifies it)

**Placeholder scan:** No "TBD", "implement later", or vague handwaving. Every code step shows the exact code. Every command has expected output.

**Type consistency:** `onEditTaskFull?: (task: Task) => void` is consistent across `TaskDrillModal`, `TeamTable`, `ClientTable`. `DashboardPage` uses `((task: Task) => void) | null` (nullable for default-value ergonomics) and bridges with `?? undefined` when forwarding — the spread/passthrough types align.
