# Dashboard Expected-Date Overdue Filter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins and managers drill into the dashboard's Overdue stat card and slice it into three buckets — Per Target, Past Expected Date, and No Expected Set — to identify overdue rows that need a revised ETA or a delay reason.

**Architecture:** Frontend-only change. A new `utils/overdueBuckets.ts` exposes three pure predicates that operate on `Task[]`. The dashboard's red Overdue stat card becomes clickable (same pattern as Active/Today). A new `drillDown.type === "overdue"` branch in `DashboardPage.tsx` renders a tab strip + the existing `TaskDetailTable`. No backend, schema, or API changes — `expectedDate` is already on `Task`.

**Tech Stack:** React 19, TypeScript, Vite, Vitest + Testing Library (jsdom env).

**Spec:** [docs/superpowers/specs/2026-05-17-dashboard-expected-date-overdue-filter-design.md](../specs/2026-05-17-dashboard-expected-date-overdue-filter-design.md)

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `frontend/task-tracker/src/utils/overdueBuckets.ts` | Three pure predicates: `isOverduePerTarget`, `isOverduePerExpected`, `isOverdueNoExpectedSet`. No React. |
| Create | `frontend/task-tracker/src/__tests__/utils/overdueBuckets.test.ts` | Predicate unit tests with 5 fixture cases. |
| Modify | `frontend/task-tracker/src/types/ui.ts` | Add `"overdue"` to `DashboardDrillDown["type"]` union. |
| Modify | `frontend/task-tracker/src/pages/DashboardPage.tsx` | Make Overdue card clickable; add drill-down branch with tab strip + `TaskDetailTable`. |
| Create | `frontend/task-tracker/src/__tests__/pages/dashboardPage.expectedDateOverdue.test.tsx` | Render test: click card → tabs render with counts; switching tabs filters rows. |

**Run tests from:** `frontend/task-tracker/` directory. Tests use `vitest --run` (script: `npm test`). The repo also runs `uv run pre-commit run --all-files` for lint/format/typecheck — run it once before the final push.

---

## Task 1: Pure bucket predicates + unit tests

**Files:**
- Create: `frontend/task-tracker/src/utils/overdueBuckets.ts`
- Create: `frontend/task-tracker/src/__tests__/utils/overdueBuckets.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `frontend/task-tracker/src/__tests__/utils/overdueBuckets.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { Task } from "@/types";
import type { ID } from "@/types/common";
import {
  isOverduePerTarget,
  isOverduePerExpected,
  isOverdueNoExpectedSet,
} from "@/utils/overdueBuckets";

// All fixtures use a fixed `today` so tests are deterministic regardless of
// the actual clock. The predicates accept `today` as an argument for this.
const today = new Date("2026-05-17");
today.setHours(0, 0, 0, 0);

const past = "2026-05-10";
const future = "2026-05-25";

const base: Task = {
  id: "t-1" as ID,
  serialNo: 1,
  client: "Acme",
  category: "Audit",
  description: "x",
  status: "Overdue",
  targetDate: past,
  expectedDate: "",
  completedDate: "",
  responsible: "Alice",
  reportingManager: "",
  remarks: "",
  recurrence: "Onetime",
  organization: "org-1",
  createdBy: null,
  createdAt: null,
  parentId: null,
};

describe("overdueBuckets predicates", () => {
  it("Per Target: rows with status='Overdue' qualify", () => {
    expect(isOverduePerTarget(base)).toBe(true);
  });

  it("Per Target: rows with any other status do not qualify", () => {
    expect(isOverduePerTarget({ ...base, status: "Pending" })).toBe(false);
    expect(isOverduePerTarget({ ...base, status: "Ontime" })).toBe(false);
    expect(isOverduePerTarget({ ...base, status: "Completed Delay" })).toBe(false);
  });

  it("Past Expected: expectedDate set + before today + not completed", () => {
    const t = { ...base, expectedDate: past };
    expect(isOverduePerExpected(t, today)).toBe(true);
  });

  it("Past Expected: future expectedDate does NOT qualify (single lapsed-target case)", () => {
    const t = { ...base, expectedDate: future };
    expect(isOverduePerExpected(t, today)).toBe(false);
  });

  it("Past Expected: empty expectedDate does NOT qualify", () => {
    expect(isOverduePerExpected({ ...base, expectedDate: "" }, today)).toBe(false);
  });

  it("Past Expected: completed rows do NOT qualify even if expectedDate is past", () => {
    const t = { ...base, expectedDate: past, completedDate: past };
    expect(isOverduePerExpected(t, today)).toBe(false);
  });

  it("Past Expected: future target + lapsed expectedDate DOES qualify (edge case)", () => {
    const t = { ...base, targetDate: future, status: "Pending", expectedDate: past };
    expect(isOverduePerExpected(t, today)).toBe(true);
  });

  it("No Expected Set: status='Overdue' AND empty expectedDate qualifies", () => {
    expect(isOverdueNoExpectedSet({ ...base, expectedDate: "" })).toBe(true);
  });

  it("No Expected Set: status='Overdue' with expectedDate set does NOT qualify", () => {
    expect(isOverdueNoExpectedSet({ ...base, expectedDate: future })).toBe(false);
  });

  it("No Expected Set: non-overdue rows do NOT qualify even with empty expectedDate", () => {
    expect(
      isOverdueNoExpectedSet({ ...base, status: "Pending", expectedDate: "" }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/__tests__/utils/overdueBuckets.test.ts
```

Expected: FAIL with "Cannot find module '@/utils/overdueBuckets'" (or equivalent).

- [ ] **Step 3: Create the predicate module**

Create `frontend/task-tracker/src/utils/overdueBuckets.ts`:

```typescript
import type { Task } from "@/types";

/**
 * Predicates for the three "overdue" buckets surfaced on the Team Dashboard.
 *
 * These intentionally overlap — they are *views*, not a partition. See
 * docs/superpowers/specs/2026-05-17-dashboard-expected-date-overdue-filter-design.md
 */

/** Status-based overdue: the existing definition (targetDate < today AND not completed). */
export function isOverduePerTarget(task: Task): boolean {
  return task.status === "Overdue";
}

/**
 * Revised-ETA overdue: an `expectedDate` was committed AND has lapsed AND the
 * task isn't completed. Does NOT require `targetDate < today` — a future-target
 * row with an already-lapsed expectedDate still counts.
 */
export function isOverduePerExpected(task: Task, today: Date): boolean {
  if (!task.expectedDate) return false;
  if (task.completedDate) return false;
  const expected = new Date(task.expectedDate);
  expected.setHours(0, 0, 0, 0);
  return expected < today;
}

/** Overdue per target AND no revised ETA recorded yet. */
export function isOverdueNoExpectedSet(task: Task): boolean {
  return task.status === "Overdue" && !task.expectedDate;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/__tests__/utils/overdueBuckets.test.ts
```

Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/utils/overdueBuckets.ts frontend/task-tracker/src/__tests__/utils/overdueBuckets.test.ts
git commit -m "feat(dashboard): add overdue bucket predicates (target / expected / no-expected)"
```

---

## Task 2: Extend the `DashboardDrillDown` type

**Files:**
- Modify: `frontend/task-tracker/src/types/ui.ts:20`

- [ ] **Step 1: Apply the type change**

In `frontend/task-tracker/src/types/ui.ts`, replace line 20:

```typescript
  type: "report" | "status" | "client" | "member" | "today" | "active";
```

with:

```typescript
  type: "report" | "status" | "client" | "member" | "today" | "active" | "overdue";
```

And update the JSDoc on line 18 to mention that for `overdue`, `value` carries the bucket key:

```typescript
/**
 * Drill-down state for DashboardPage.
 *
 * For `type === "overdue"`, `value` is one of "target" | "expected" | "no-expected".
 */
export interface DashboardDrillDown {
  type: "report" | "status" | "client" | "member" | "today" | "active" | "overdue";
  value?: string;
}
```

- [ ] **Step 2: Run typecheck to verify compilation**

```bash
npm run build
```

Expected: PASS (build completes; the type change is backwards-compatible).

- [ ] **Step 3: Commit**

```bash
git add frontend/task-tracker/src/types/ui.ts
git commit -m "feat(dashboard): extend DashboardDrillDown union with overdue bucket view"
```

---

## Task 3: Make the Overdue stat card clickable + add drill-down branch (default tab)

This task implements the click-through with a single hard-coded `target` bucket and no tab switching yet. Task 4 layers tabs on top.

**Files:**
- Modify: `frontend/task-tracker/src/pages/DashboardPage.tsx` (Overdue card at lines 863–873; new drill-down branch before line 473)
- Create: `frontend/task-tracker/src/__tests__/pages/dashboardPage.expectedDateOverdue.test.tsx`

- [ ] **Step 1: Write the failing render test**

Create `frontend/task-tracker/src/__tests__/pages/dashboardPage.expectedDateOverdue.test.tsx`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import type { Task, Profile } from "@/types";
import type { ID } from "@/types/common";

const mockUseAuth = vi.fn();
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

// Light-weight mocks so we can focus on the drill-down's own contents
vi.mock("@/components/dashboard/TeamTable", () => ({
  default: () => <div data-testid="team-table" />,
}));
vi.mock("@/components/dashboard/ClientTable", () => ({
  default: () => <div data-testid="client-table" />,
}));
vi.mock("@/components/dashboard/StatusDist", () => ({
  default: () => <div data-testid="status-dist" />,
}));
vi.mock("@/components/dashboard/TaskDetailTable", () => ({
  default: ({ tasks }: { tasks: Task[] }) => (
    <div data-testid="task-detail-table">
      {tasks.map((t) => (
        <div key={t.id} data-testid={`row-${t.id}`}>{t.description}</div>
      ))}
    </div>
  ),
}));
vi.mock("@/components/dashboard/ReportView", () => ({
  default: () => <div data-testid="report-view" />,
}));

import DashboardPage from "@/pages/DashboardPage";

const profile: Profile = {
  id: "p1",
  username: "alice",
  full_name: "Alice",
  email: "a@x.com",
  manager_ids: null,
  avatar_color: null,
  orgs: [],
  highest_role: "admin",
} as unknown as Profile;

// Use real "today" so computeStatus picks up Overdue rows correctly.
const today = new Date();
today.setHours(0, 0, 0, 0);
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() - n);
  return iso(d);
};
const daysAhead = (n: number) => {
  const d = new Date(today);
  d.setDate(d.getDate() + n);
  return iso(d);
};

const taskBase: Task = {
  id: "t-base" as ID,
  serialNo: 1,
  client: "Acme",
  category: "Audit",
  description: "task",
  status: "Pending",
  targetDate: "",
  expectedDate: "",
  completedDate: "",
  responsible: "Alice",
  reportingManager: "",
  remarks: "",
  recurrence: "Onetime",
  organization: "org-1",
  createdBy: null,
  createdAt: null,
  parentId: null,
};

// Fixture: 3 rows, one in each "of interest" bucket.
// row-no-exp: targetDate past, expectedDate empty → Overdue + No Expected Set
// row-past-exp: targetDate past, expectedDate also past → Overdue + Past Expected
// row-future-exp: targetDate past, expectedDate in future → Overdue (Per Target) only
const tasks: Task[] = [
  { ...taskBase, id: "row-no-exp" as ID, description: "no-exp", targetDate: daysAgo(10), status: "Overdue", expectedDate: "" },
  { ...taskBase, id: "row-past-exp" as ID, description: "past-exp", targetDate: daysAgo(10), status: "Overdue", expectedDate: daysAgo(2) },
  { ...taskBase, id: "row-future-exp" as ID, description: "future-exp", targetDate: daysAgo(10), status: "Overdue", expectedDate: daysAhead(3) },
];

beforeEach(() => {
  cleanup();
  mockUseAuth.mockReset();
  mockUseAuth.mockReturnValue({
    isAdminInAny: () => true,
    isManagerInAny: () => false,
  });
});

describe("DashboardPage — Overdue drill-down (default tab = Per Target)", () => {
  it("clicking the Overdue stat card opens the drill-down with all three Per-Target rows", () => {
    render(<DashboardPage tasks={tasks} profile={profile} profiles={[profile]} />);

    // The Overdue card label is "Overdue"; the stat card is the parent of the count.
    const overdueLabel = screen.getByText("Overdue");
    fireEvent.click(overdueLabel.closest(".dm-stat-card") as HTMLElement);

    const table = screen.getByTestId("task-detail-table");
    expect(within(table).getByTestId("row-row-no-exp")).toBeTruthy();
    expect(within(table).getByTestId("row-row-past-exp")).toBeTruthy();
    expect(within(table).getByTestId("row-row-future-exp")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend/task-tracker
npm test -- src/__tests__/pages/dashboardPage.expectedDateOverdue.test.tsx
```

Expected: FAIL — clicking the card has no handler yet, so the drill-down does not open and `task-detail-table` is not rendered.

- [ ] **Step 3: Make the Overdue stat card clickable**

In `frontend/task-tracker/src/pages/DashboardPage.tsx`, replace the existing Overdue card block (lines 863–873):

```tsx
        <div className="dm-stat-card" style={cardStyle("#dc2626")}>
          <div style={{ fontSize: 26, fontWeight: 800, color: "#dc2626" }}>
            {overdue}
          </div>
          <div
            className="dm-stat-lbl"
            style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}
          >
            Overdue
          </div>
        </div>
```

with the clickable version (mirrors the Active card pattern on lines 832–846):

```tsx
        <div
          className="dm-stat-card"
          onClick={() => setDrillDown({ type: "overdue", value: "target" })}
          style={{ ...cardStyle("#dc2626"), cursor: "pointer" }}
          title="Click to view overdue tasks"
        >
          <div style={{ fontSize: 26, fontWeight: 800, color: "#dc2626" }}>
            {overdue}
          </div>
          <div
            className="dm-stat-lbl"
            style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}
          >
            Overdue
          </div>
        </div>
```

- [ ] **Step 4: Add the drill-down branch (default `target` bucket only — no tabs yet)**

Add a new branch in `DashboardPage.tsx` BEFORE the `// ── Main dashboard ──` comment (which is currently at line 473). Place it between the existing `active` branch and the main dashboard return.

Also add the imports at the top of the file:

```tsx
import {
  isOverduePerTarget,
  isOverduePerExpected,
  isOverdueNoExpectedSet,
} from "@/utils/overdueBuckets";
```

The drill-down branch:

```tsx
  if (drillDown?.type === "overdue") {
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    const buckets = {
      target: filteredTasks.filter(isOverduePerTarget),
      expected: filteredTasks.filter((t) => isOverduePerExpected(t, todayDate)),
      "no-expected": filteredTasks.filter(isOverdueNoExpectedSet),
    } as const;
    const activeBucket = (drillDown.value || "target") as keyof typeof buckets;
    const slice = buckets[activeBucket];
    const bucketLabel = {
      target: "Per Target Date",
      expected: "Past Expected Date",
      "no-expected": "No Expected Set",
    }[activeBucket];
    const filenameSuffix = {
      target: "per-target",
      expected: "past-expected",
      "no-expected": "no-expected",
    }[activeBucket];

    return (
      <div style={{ padding: "16px 20px" }}>
        <TaskDetailTable
          tasks={slice}
          allTasks={tasks}
          title={
            <span>
              🚨 Overdue Tasks —{" "}
              <span style={{ color: "#dc2626", fontWeight: 700 }}>
                {bucketLabel}
              </span>
            </span>
          }
          onBack={() => setDrillDown(null)}
          filename={`overdue-${filenameSuffix}.csv`}
          editable={true}
          profile={profile}
          onAddTask={onAddTask}
          onPatchTask={onPatchTask}
        />
      </div>
    );
  }
```

- [ ] **Step 5: Run tests to verify pass**

```bash
cd frontend/task-tracker
npm test -- src/__tests__/pages/dashboardPage.expectedDateOverdue.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Run the full frontend test suite to confirm no regressions**

```bash
cd frontend/task-tracker
npm test
```

Expected: PASS — all existing dashboard tests still green (notably `dashboardReportingManager.smoke.test.tsx`).

- [ ] **Step 7: Commit**

```bash
git add frontend/task-tracker/src/pages/DashboardPage.tsx frontend/task-tracker/src/__tests__/pages/dashboardPage.expectedDateOverdue.test.tsx
git commit -m "feat(dashboard): make Overdue card clickable; drill into Per Target view"
```

---

## Task 4: Add tab strip with bucket switching + counts

**Files:**
- Modify: `frontend/task-tracker/src/pages/DashboardPage.tsx` (extend the `drillDown.type === "overdue"` branch added in Task 3)
- Modify: `frontend/task-tracker/src/__tests__/pages/dashboardPage.expectedDateOverdue.test.tsx` (add tab tests)

- [ ] **Step 1: Append failing tests for the tab strip**

At the end of the existing `describe(...)` block in `dashboardPage.expectedDateOverdue.test.tsx`, add:

```typescript
  it("renders three tabs with correct counts", () => {
    render(<DashboardPage tasks={tasks} profile={profile} profiles={[profile]} />);
    fireEvent.click(screen.getByText("Overdue").closest(".dm-stat-card") as HTMLElement);

    expect(screen.getByRole("button", { name: /Per Target.*\(3\)/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Past Expected Date.*\(1\)/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /No Expected Set.*\(1\)/ })).toBeTruthy();
  });

  it("clicking 'Past Expected Date' tab shows only the past-expected row", () => {
    render(<DashboardPage tasks={tasks} profile={profile} profiles={[profile]} />);
    fireEvent.click(screen.getByText("Overdue").closest(".dm-stat-card") as HTMLElement);

    fireEvent.click(screen.getByRole("button", { name: /Past Expected Date/ }));

    const table = screen.getByTestId("task-detail-table");
    expect(within(table).queryByTestId("row-row-no-exp")).toBeNull();
    expect(within(table).getByTestId("row-row-past-exp")).toBeTruthy();
    expect(within(table).queryByTestId("row-row-future-exp")).toBeNull();
  });

  it("clicking 'No Expected Set' tab shows only the no-exp row", () => {
    render(<DashboardPage tasks={tasks} profile={profile} profiles={[profile]} />);
    fireEvent.click(screen.getByText("Overdue").closest(".dm-stat-card") as HTMLElement);

    fireEvent.click(screen.getByRole("button", { name: /No Expected Set/ }));

    const table = screen.getByTestId("task-detail-table");
    expect(within(table).getByTestId("row-row-no-exp")).toBeTruthy();
    expect(within(table).queryByTestId("row-row-past-exp")).toBeNull();
    expect(within(table).queryByTestId("row-row-future-exp")).toBeNull();
  });

  it("active tab is visually highlighted (red background)", () => {
    render(<DashboardPage tasks={tasks} profile={profile} profiles={[profile]} />);
    fireEvent.click(screen.getByText("Overdue").closest(".dm-stat-card") as HTMLElement);

    const perTarget = screen.getByRole("button", { name: /Per Target/ });
    // Active tab uses background #dc2626 (red); inactive uses #f1f5f9 (light gray).
    expect((perTarget as HTMLElement).style.background).toMatch(/#dc2626|rgb\(220,\s*38,\s*38\)/i);

    fireEvent.click(screen.getByRole("button", { name: /Past Expected Date/ }));
    const pastExpected = screen.getByRole("button", { name: /Past Expected Date/ });
    expect((pastExpected as HTMLElement).style.background).toMatch(/#dc2626|rgb\(220,\s*38,\s*38\)/i);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend/task-tracker
npm test -- src/__tests__/pages/dashboardPage.expectedDateOverdue.test.tsx
```

Expected: FAIL — the four new tests fail because no tab buttons exist yet. The first test from Task 3 still passes.

- [ ] **Step 3: Add the tab strip to the drill-down**

In `DashboardPage.tsx`, replace the `title={...}` prop of the `TaskDetailTable` inside the `drillDown.type === "overdue"` branch with a title that embeds the tab strip below the heading:

```tsx
          title={
            <div>
              <div>
                🚨 Overdue Tasks —{" "}
                <span style={{ color: "#dc2626", fontWeight: 700 }}>
                  {bucketLabel}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  marginTop: 10,
                  flexWrap: "wrap",
                }}
              >
                {(
                  [
                    ["target", "Per Target", buckets.target.length],
                    ["expected", "Past Expected Date", buckets.expected.length],
                    ["no-expected", "No Expected Set", buckets["no-expected"].length],
                  ] as const
                ).map(([key, label, count]) => {
                  const isActive = activeBucket === key;
                  return (
                    <button
                      key={key}
                      onClick={() =>
                        setDrillDown({ type: "overdue", value: key })
                      }
                      style={{
                        padding: "4px 12px",
                        borderRadius: 999,
                        border: isActive
                          ? "1px solid #dc2626"
                          : "1px solid #e2e8f0",
                        background: isActive ? "#dc2626" : "#f1f5f9",
                        color: isActive ? "#fff" : "#334155",
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      {label} ({count})
                    </button>
                  );
                })}
              </div>
            </div>
          }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd frontend/task-tracker
npm test -- src/__tests__/pages/dashboardPage.expectedDateOverdue.test.tsx
```

Expected: PASS — all 5 tests in this file green.

- [ ] **Step 5: Run the full frontend test suite**

```bash
cd frontend/task-tracker
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/task-tracker/src/pages/DashboardPage.tsx frontend/task-tracker/src/__tests__/pages/dashboardPage.expectedDateOverdue.test.tsx
git commit -m "feat(dashboard): add overdue bucket tabs (target / past-expected / no-expected)"
```

---

## Task 5: Manual smoke test + pre-commit + push

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

```bash
cd frontend/task-tracker
npm run dev
```

- [ ] **Step 2: Open the dashboard in a browser**

Navigate to the URL printed by Vite (usually http://localhost:5173) and log in as an admin. Open the Dashboard tab.

- [ ] **Step 3: Verify the Overdue card is clickable**

- Hover the red Overdue card → cursor becomes a pointer; title tooltip reads "Click to view overdue tasks".
- Click it → page transitions into the drill-down view.
- The heading reads "🚨 Overdue Tasks — Per Target Date".
- Below the heading, three pill buttons appear: "Per Target (N)", "Past Expected Date (M)", "No Expected Set (K)".
- The active tab is the red-filled "Per Target" pill; the other two have a light gray background.
- The table below shows the same rows as before (the existing Overdue set).

- [ ] **Step 4: Verify tab switching**

- Click "Past Expected Date" → the pill turns red, the heading updates to "Past Expected Date", and the table now shows only rows whose `expectedDate` has lapsed.
- Click "No Expected Set" → the pill turns red, the heading updates, and the table shows only rows whose `expectedDate` is empty (and which are status="Overdue").
- Click "Per Target" → back to the full Per-Target list.

- [ ] **Step 5: Verify the back button**

The existing "← Back" button on `TaskDetailTable` returns to the dashboard root.

- [ ] **Step 6: Verify CSV export filename**

In each tab, click "⬇ Export CSV" inside the `TaskDetailTable` header. The downloaded filename should be `overdue-per-target.csv`, `overdue-past-expected.csv`, or `overdue-no-expected.csv` for the three tabs respectively.

- [ ] **Step 7: Verify other dashboard filters compose**

Back on the dashboard root, pick a Client from the filter bar, then click the Overdue card. The drill-down's tab counts should reflect the client filter (counts may be smaller than before).

- [ ] **Step 8: Run pre-commit and full test suite**

```bash
uv run pre-commit run --all-files
```

Expected: PASS (ruff/format/line-endings/mypy/pyright/eslint/tsc/build all green).

```bash
cd frontend/task-tracker
npm test
```

Expected: PASS.

- [ ] **Step 9: Push the branch**

```bash
git push origin Expect_Date_filter
```

---

## Done criteria

- The red Overdue stat card on the Team Dashboard is clickable.
- Clicking it opens a drill-down identical to today's Overdue list (Per Target default).
- A tab strip above the table offers two more views: "Past Expected Date" (revised ETA has lapsed) and "No Expected Set" (no revised ETA recorded).
- Tab counts match the rows shown.
- Existing dashboard filters (Month, Client, Reporting Manager, Main Category, Main Responsibility, Member) compose with the bucket view.
- All new tests pass; no existing tests break.
- `uv run pre-commit run --all-files` passes.
