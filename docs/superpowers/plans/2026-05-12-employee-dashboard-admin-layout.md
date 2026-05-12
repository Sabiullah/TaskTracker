# Employee Dashboard — Admin-Style Layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the solo-employee Dashboard panel layout match the admin/manager Dashboard: show **By Client** + **Status Distribution** scoped to the employee's own tasks. Remove the inline Active Tasks table and Recent Completions block.

**Architecture:** Single-file UI change in `DashboardPage.tsx`. The employee branch (rendered when `!isAdmin && !isManager`) currently renders `TaskDetailTable` + `StatusDist` + `RecentCompletions`. It will be replaced with a stacked `ClientTable` + `StatusDist`, reusing the exact components the admin branch uses and feeding them the already-employee-scoped `filteredTasks`. Drill-downs (`drillDown?.type === "client" | "status"`) already exist and need no change.

**Tech Stack:** React 19, TypeScript, Vitest + Testing Library (jsdom), ESLint, Vite.

**Spec:** `docs/superpowers/specs/2026-05-12-employee-dashboard-admin-layout-design.md`

---

## File Structure

- **Modify:** `frontend/task-tracker/src/pages/DashboardPage.tsx` — replace the employee branch JSX (current lines 1003–1040) and drop the `RecentCompletions` import.
- **Modify:** `frontend/task-tracker/src/__tests__/components/dashboard/dashboardReportingManager.smoke.test.tsx` — add an employee-view smoke test that asserts the new panel set.

No other files are touched. `ClientTable`, `StatusDist`, and `TaskDetailTable` components are unchanged. `RecentCompletions.tsx` is left in place (no longer imported by `DashboardPage`, but still part of the codebase; not deleted to keep this change minimal).

---

## Task 1: Add failing smoke test for the new employee layout

**Files:**
- Modify: `frontend/task-tracker/src/__tests__/components/dashboard/dashboardReportingManager.smoke.test.tsx`

This test file already mocks all dashboard child components with `data-testid` attributes (lines 11–30). We'll append a new `describe` block that renders `DashboardPage` as a regular user and asserts the new panel set.

- [ ] **Step 1: Write the failing test**

Append the following new `describe` block to the end of `frontend/task-tracker/src/__tests__/components/dashboard/dashboardReportingManager.smoke.test.tsx`, immediately before the final closing `});` of the file:

```tsx
describe("DashboardPage — employee layout matches admin", () => {
  it("regular user sees By Client and Status Distribution, not inline Active Tasks or Recent Completions", () => {
    setRole("user");
    const profiles = [profile("1", "Alice")];
    render(
      <DashboardPage
        tasks={[task("Alice", "Sabiullah")]}
        profile={profiles[0]}
        profiles={profiles}
      />,
    );

    expect(screen.getByTestId("client-table")).toBeTruthy();
    expect(screen.getByTestId("status-dist")).toBeTruthy();
    expect(screen.queryByTestId("task-detail-table")).toBeNull();
    expect(screen.queryByTestId("recent-completions")).toBeNull();
  });

  it("regular user does not see Team Performance (TeamTable) on dashboard root", () => {
    setRole("user");
    const profiles = [profile("1", "Alice")];
    render(
      <DashboardPage
        tasks={[task("Alice", "Sabiullah")]}
        profile={profiles[0]}
        profiles={profiles}
      />,
    );

    expect(screen.queryByTestId("team-table")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run from `D:/TaskTracker/frontend/task-tracker`:

```bash
npm test -- dashboardReportingManager.smoke.test.tsx
```

Expected: the two new tests fail. The first fails because `client-table` is not rendered for a regular user (current employee branch renders `task-detail-table` and `recent-completions` instead). The second already passes (no `team-table` for employees). Both must exist in the output — the failure of the first one is the proof the layout is wrong.

- [ ] **Step 3: Commit the failing test**

```bash
git add frontend/task-tracker/src/__tests__/components/dashboard/dashboardReportingManager.smoke.test.tsx
git commit -m "test(dashboard): expect employee view to show By Client + Status Distribution"
```

---

## Task 2: Replace employee-branch JSX with admin-style panels

**Files:**
- Modify: `frontend/task-tracker/src/pages/DashboardPage.tsx` (employee branch, currently lines 1003–1040; and the import block at the top)

- [ ] **Step 1: Remove the now-unused `RecentCompletions` import**

In `frontend/task-tracker/src/pages/DashboardPage.tsx`, delete this line (currently line 12):

```tsx
import RecentCompletions from "@/components/dashboard/RecentCompletions";
```

- [ ] **Step 2: Replace the employee branch JSX**

In `frontend/task-tracker/src/pages/DashboardPage.tsx`, locate the `else` branch that starts at the `) : (` on line 1002 and ends with the `</>` on line 1040. The current content between those fragments is:

```tsx
<>
  <div className="dm-box" style={boxStyle}>
    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
      📋 Active Tasks{" "}
      <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 400 }}>
        (excluding today's tasks)
      </span>
    </div>
    <TaskDetailTable
      tasks={activeTasks}
      allTasks={tasks}
      title=""
      filename="my-active-tasks.csv"
    />
  </div>
  <div
    style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
  >
    <div className="dm-box" style={boxStyle}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
        📈 Status Distribution
      </div>
      <StatusDist
        tasks={filteredTasks}
        onSelectStatus={(s) =>
          setDrillDown({ type: "status", value: s })
        }
      />
    </div>
    <div className="dm-box" style={boxStyle}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
        ✅ Recent Completions
      </div>
      <RecentCompletions tasks={filteredTasks} />
    </div>
  </div>
</>
```

Replace it entirely with:

```tsx
<>
  <div className="dm-box" style={boxStyle}>
    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
      🏢 By Client{" "}
      <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 400 }}>
        (click to view tasks)
      </span>
    </div>
    <ClientTable
      tasks={filteredTasks}
      allTasks={tasks}
      clientNames={
        [
          ...new Set(
            filteredTasks.map((t) => t.client).filter(Boolean),
          ),
        ] as string[]
      }
      todayStr={todayStr}
      onSelectClient={(c) =>
        setDrillDown({ type: "client", value: c })
      }
      onTaskUpdated={() => {}}
      onPatchTask={onPatchTask}
      profile={profile}
      onEditTaskFull={onEditTaskFull}
    />
  </div>
  <div className="dm-box" style={boxStyle}>
    <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
      📈 Status Distribution{" "}
      <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 400 }}>
        (click to view tasks)
      </span>
    </div>
    <StatusDist
      tasks={filteredTasks}
      onSelectStatus={(s) =>
        setDrillDown({ type: "status", value: s })
      }
    />
  </div>
</>
```

Notes:
- The `<ClientTable>` prop set is copied verbatim from the admin branch (DashboardPage.tsx:979–997). `filteredTasks` is already employee-scoped by the existing logic at lines 207–219.
- `TaskDetailTable` is still imported and used by the drill-down branches earlier in the file (`drillDown?.type === "status" | "client" | "member" | "today" | "active"`) — do not remove its import.

- [ ] **Step 3: Run the smoke test and confirm it passes**

```bash
npm test -- dashboardReportingManager.smoke.test.tsx
```

Expected: all tests in that file pass, including the two new employee-layout assertions from Task 1.

- [ ] **Step 4: Run the full frontend test suite**

```bash
npm test
```

Expected: all tests pass. No regressions in `taskDrillModal.test.tsx` or any other dashboard test.

- [ ] **Step 5: Run typecheck and lint**

```bash
npm run build
npm run lint
```

Expected: `npm run build` completes (tsc + vite build) with no TypeScript errors. `npm run lint` reports no new errors or unused-import warnings (the `RecentCompletions` import removal in Step 1 prevents an unused-import warning).

- [ ] **Step 6: Manually verify in browser (optional but recommended)**

Start the dev server and confirm the employee view visually:

```bash
npm run dev
```

Log in as a non-admin / non-manager user and confirm:
1. Dashboard shows: title → filter bar → 6 stat cards → **By Client** panel (full width) → **Status Distribution** panel (full width).
2. No inline Active Tasks table on the root view.
3. No Recent Completions panel.
4. Clicking a client row drills into that client's tasks.
5. Clicking a status bar drills into that status's tasks.
6. The **Active** stat card still drills into the active-tasks list.
7. Log in as admin or manager — their dashboards look unchanged.

- [ ] **Step 7: Commit**

```bash
git add frontend/task-tracker/src/pages/DashboardPage.tsx
git commit -m "$(cat <<'EOF'
feat(dashboard): employee view uses admin-style By Client + Status Distribution

Solo employees now see the same panel layout as admin/manager — By Client
above Status Distribution — scoped to their own tasks. Removes the inline
Active Tasks table (still reachable via the Active stat card) and the
Recent Completions block.
EOF
)"
```

- [ ] **Step 8: Push the branch**

```bash
git push
```

Expected: branch `Db_Like_Admin` is pushed to origin with the two new commits (failing test + implementation).

---

## Self-Review

**1. Spec coverage:** Each acceptance criterion from the spec maps to a task or test step:
- AC 1 (order of panels): Task 2 Step 2 + Step 6 manual check.
- AC 2 (no inline Active Tasks / Recent Completions): Task 1 Step 1 first test, Task 2 Step 3.
- AC 3 (drill-down on client): Task 2 Step 6 manual check (drill-down code path is untouched and pre-existing).
- AC 4 (drill-down on status): same as AC 3.
- AC 5 (Active stat card drill-down): Task 2 Step 6 manual check (code untouched).
- AC 6 (admin/manager unchanged): Task 2 Step 4 full test run + Step 6 manual check.
- AC 7 (no TS / lint errors): Task 2 Step 5.

**2. Placeholder scan:** No TBDs, no "implement later", every code block is the actual content to paste. No "similar to Task N" references.

**3. Type consistency:** `ClientTable` props match those in `DashboardPage.tsx:979–997` exactly. `StatusDist` props (`tasks`, `onSelectStatus`) match the existing admin usage. Test mocks for `client-table`, `status-dist`, `task-detail-table`, `recent-completions`, `team-table` all already exist in the test file (lines 11–30).
