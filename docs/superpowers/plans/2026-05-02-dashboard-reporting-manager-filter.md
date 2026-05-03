# Dashboard — Reporting Manager filter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Reporting Manager dropdown to the Team Dashboard filter bar that scopes all dashboard content to the selected manager's reporting sub-tree (manager + direct + indirect reports).

**Architecture:** Pure client-side filter, mirrors the existing Month / Client / Member filter pattern in `DashboardPage.tsx`. A new helper module exposes three pure functions over the `profiles` array (`actualManagers`, `subTreeManagers`, `subTreeNames`) which are used both to populate the dropdown options and to filter `tasks` inside the existing `filteredTasks` useMemo. No backend or API changes.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-05-02-dashboard-reporting-manager-filter-design.md`

**File map:**

- Create: `frontend/task-tracker/src/components/dashboard/reportingManager.ts` — pure helpers
- Create: `frontend/task-tracker/src/__tests__/components/dashboard/reportingManager.test.ts` — helper unit tests
- Create: `frontend/task-tracker/src/__tests__/components/dashboard/dashboardReportingManager.smoke.test.tsx` — page-level smoke test
- Modify: `frontend/task-tracker/src/pages/DashboardPage.tsx` — state, dropdown options memo, filter pipeline, UI

---

## Task 1: Helpers module (TDD)

**Files:**
- Create: `frontend/task-tracker/src/components/dashboard/reportingManager.ts`
- Test: `frontend/task-tracker/src/__tests__/components/dashboard/reportingManager.test.ts`

The helpers operate on a minimal `Profile`-shaped object so they don't depend on the full Profile type and are easy to test with hand-crafted fixtures.

- [ ] **Step 1: Write the failing test file**

Create `frontend/task-tracker/src/__tests__/components/dashboard/reportingManager.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  actualManagers,
  subTreeManagers,
  subTreeNames,
} from "@/components/dashboard/reportingManager";

type P = {
  id: string;
  full_name: string;
  manager_ids: string[] | null;
};

const mk = (id: string, full_name: string, manager_ids: string[] | null = null): P => ({
  id,
  full_name,
  manager_ids,
});

describe("actualManagers", () => {
  it("returns empty when no profile references any manager", () => {
    const profiles: P[] = [mk("1", "Alice"), mk("2", "Bob")];
    expect(actualManagers(profiles)).toEqual([]);
  });

  it("returns profiles that appear in another profile's manager_ids", () => {
    const profiles: P[] = [
      mk("1", "Alice"),
      mk("2", "Bob", ["1"]),
      mk("3", "Carol", ["1"]),
    ];
    expect(actualManagers(profiles).map((p) => p.id)).toEqual(["1"]);
  });

  it("does not duplicate a manager referenced by multiple reports", () => {
    const profiles: P[] = [
      mk("1", "Alice"),
      mk("2", "Bob", ["1"]),
      mk("3", "Carol", ["1"]),
      mk("4", "Dave", ["1"]),
    ];
    expect(actualManagers(profiles)).toHaveLength(1);
  });

  it("treats null manager_ids as empty", () => {
    const profiles: P[] = [mk("1", "Alice", null), mk("2", "Bob", null)];
    expect(actualManagers(profiles)).toEqual([]);
  });
});

describe("subTreeNames", () => {
  it("returns just the root's name when they have no reports", () => {
    const profiles: P[] = [mk("1", "Alice"), mk("2", "Bob")];
    expect([...subTreeNames("1", profiles)]).toEqual(["Alice"]);
  });

  it("includes root + direct reports", () => {
    const profiles: P[] = [
      mk("1", "Alice"),
      mk("2", "Bob", ["1"]),
      mk("3", "Carol", ["1"]),
      mk("4", "Dave"),
    ];
    expect(new Set(subTreeNames("1", profiles))).toEqual(
      new Set(["Alice", "Bob", "Carol"]),
    );
  });

  it("includes indirect reports across 3 levels", () => {
    const profiles: P[] = [
      mk("1", "Alice"),
      mk("2", "Bob", ["1"]),
      mk("3", "Carol", ["2"]),
      mk("4", "Dave", ["3"]),
      mk("5", "Eve"),
    ];
    expect(new Set(subTreeNames("1", profiles))).toEqual(
      new Set(["Alice", "Bob", "Carol", "Dave"]),
    );
  });

  it("terminates on a cycle (A manages B, B manages A)", () => {
    const profiles: P[] = [
      mk("1", "Alice", ["2"]),
      mk("2", "Bob", ["1"]),
    ];
    expect(new Set(subTreeNames("1", profiles))).toEqual(
      new Set(["Alice", "Bob"]),
    );
  });

  it("returns an empty set when rootId is unknown", () => {
    const profiles: P[] = [mk("1", "Alice")];
    expect([...subTreeNames("999", profiles)]).toEqual([]);
  });
});

describe("subTreeManagers", () => {
  it("returns sub-managers under root, excluding root", () => {
    const profiles: P[] = [
      mk("1", "Alice"),
      mk("2", "Bob", ["1"]),
      mk("3", "Carol", ["2"]),
      mk("4", "Dave", ["3"]),
    ];
    // Bob has Carol under him → Bob is a manager
    // Carol has Dave under her → Carol is a manager
    // Dave has no reports → not a manager
    const out = subTreeManagers("1", profiles).map((p) => p.id).sort();
    expect(out).toEqual(["2", "3"]);
  });

  it("does not include peers or seniors of root", () => {
    const profiles: P[] = [
      mk("1", "Alice"),       // CEO
      mk("2", "Bob", ["1"]),  // VP A
      mk("3", "Carol", ["1"]),// VP B (peer of Bob)
      mk("4", "Dave", ["2"]), // under Bob
      mk("5", "Eve", ["4"]),  // under Dave
    ];
    // From Bob's perspective, sub-managers should only be Dave (manager of Eve)
    const out = subTreeManagers("2", profiles).map((p) => p.id);
    expect(out).toEqual(["4"]);
  });

  it("returns empty when root has no sub-managers (only IC reports)", () => {
    const profiles: P[] = [
      mk("1", "Alice"),
      mk("2", "Bob", ["1"]),
      mk("3", "Carol", ["1"]),
    ];
    // Both Bob and Carol are ICs under Alice — no sub-managers
    expect(subTreeManagers("1", profiles)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend/task-tracker && npm test -- reportingManager`
Expected: FAIL with "Failed to resolve import @/components/dashboard/reportingManager".

- [ ] **Step 3: Implement the helpers**

Create `frontend/task-tracker/src/components/dashboard/reportingManager.ts`:

```ts
interface MinimalProfile {
  id: string;
  full_name: string;
  manager_ids: readonly string[] | null;
}

export function actualManagers<P extends MinimalProfile>(
  profiles: readonly P[],
): P[] {
  const ids = new Set<string>();
  for (const p of profiles) {
    for (const id of p.manager_ids ?? []) ids.add(id);
  }
  return profiles.filter((p) => ids.has(p.id));
}

export function subTreeNames<P extends MinimalProfile>(
  rootId: string,
  profiles: readonly P[],
): Set<string> {
  const ids = subTreeIdSet(rootId, profiles);
  if (ids.size === 0) return new Set();
  const names = new Set<string>();
  for (const p of profiles) {
    if (ids.has(p.id) && p.full_name) names.add(p.full_name);
  }
  return names;
}

export function subTreeManagers<P extends MinimalProfile>(
  rootId: string,
  profiles: readonly P[],
): P[] {
  const managerIds = new Set(actualManagers(profiles).map((p) => p.id));
  const subTreeIds = subTreeIdSet(rootId, profiles);
  subTreeIds.delete(rootId);
  return profiles.filter((p) => subTreeIds.has(p.id) && managerIds.has(p.id));
}

function subTreeIdSet<P extends MinimalProfile>(
  rootId: string,
  profiles: readonly P[],
): Set<string> {
  const rootExists = profiles.some((p) => p.id === rootId);
  if (!rootExists) return new Set();
  const visited = new Set<string>([rootId]);
  const queue: string[] = [rootId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const p of profiles) {
      if (visited.has(p.id)) continue;
      if ((p.manager_ids ?? []).includes(cur)) {
        visited.add(p.id);
        queue.push(p.id);
      }
    }
  }
  return visited;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend/task-tracker && npm test -- reportingManager`
Expected: PASS for all describe blocks.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/components/dashboard/reportingManager.ts \
        frontend/task-tracker/src/__tests__/components/dashboard/reportingManager.test.ts
git commit -m "feat(dashboard): add reportingManager sub-tree helpers"
```

---

## Task 2: Wire helpers into DashboardPage state and filter pipeline

**Files:**
- Modify: `frontend/task-tracker/src/pages/DashboardPage.tsx`

This task adds the state, the dropdown-options memo, and the filter-pipeline edit. No UI changes yet — those come in Task 3. After this task, the filter is reachable but invisible; behavior is exercised by the smoke test in Task 4.

- [ ] **Step 1: Add the helper import**

Open `frontend/task-tracker/src/pages/DashboardPage.tsx`. After the existing imports (around line 12, just before the `import type { Task, ... }` line), add:

```ts
import {
  actualManagers,
  subTreeManagers,
  subTreeNames,
} from "@/components/dashboard/reportingManager";
```

- [ ] **Step 2: Add state**

In the component body, immediately after the existing `const [fMember, setFMember] = useState("");` line (around line 38), add:

```ts
const [fReportingManager, setFReportingManager] = useState<string>("");
```

- [ ] **Step 3: Add dropdown-options memo**

Immediately after the existing `allMembers` useMemo (around line 64), add:

```ts
const rmDropdownOptions = useMemo(() => {
  if (isAdmin) return actualManagers(profiles);
  if (isManager && profile) return subTreeManagers(profile.id, profiles);
  return [];
}, [isAdmin, isManager, profile, profiles]);
```

- [ ] **Step 4: Update the filter pipeline**

Two edits in `filteredTasks` useMemo.

**4a.** Find the role-gating block (currently lines 142–154):

```ts
    if (!isAdmin) {
      if (isManager && profile) {
        const managedNames = profiles
          .filter((p) => (p.manager_ids ?? []).includes(profile.id))
          .map((p) => p.full_name || "");
        src = src.filter(
          (t) =>
            t.responsible === myName || managedNames.includes(t.responsible),
        );
      } else {
        src = src.filter((t) => t.responsible === myName);
      }
    }
```

Change the outer condition to also bypass when an RM is selected (the RM
filter is a tighter scope and the dropdown already restricts managers to
in-sub-tree managers, so this is safe):

```ts
    if (!isAdmin && !fReportingManager) {
      if (isManager && profile) {
        const managedNames = profiles
          .filter((p) => (p.manager_ids ?? []).includes(profile.id))
          .map((p) => p.full_name || "");
        src = src.filter(
          (t) =>
            t.responsible === myName || managedNames.includes(t.responsible),
        );
      } else {
        src = src.filter((t) => t.responsible === myName);
      }
    }
```

**4b.** Find the Client/Member block (currently lines 156–157):

```ts
    if (fClient) src = src.filter((t) => t.client === fClient);
    if (fMember) src = src.filter((t) => t.responsible === fMember);
```

Replace it with:

```ts
    if (fReportingManager) {
      const names = subTreeNames(fReportingManager, profiles);
      src = src.filter((t) => names.has(t.responsible));
    }
    if (fClient) src = src.filter((t) => t.client === fClient);
    if (fMember && !fReportingManager) {
      src = src.filter((t) => t.responsible === fMember);
    }
```

- [ ] **Step 5: Update useMemo dependency array**

The `filteredTasks` useMemo dependency array currently ends with `profile,]` (around line 169). Add `fReportingManager` to it. The final array should be:

```ts
[
  tasks,
  period,
  fClient,
  fMember,
  fReportingManager,
  isAdmin,
  isManager,
  myName,
  profiles,
  profile,
]
```

- [ ] **Step 6: Verify tsc still builds**

Run: `cd frontend/task-tracker && npx tsc -b`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/task-tracker/src/pages/DashboardPage.tsx
git commit -m "feat(dashboard): wire reporting-manager state and filter pipeline"
```

---

## Task 3: Add the Reporting Manager dropdown to the filter bar UI

**Files:**
- Modify: `frontend/task-tracker/src/pages/DashboardPage.tsx`

Add the new `<select>` between the Client and Member selects, hidden when `rmDropdownOptions.length === 0`. Wire the Member select to be disabled when an RM is active, and update the Clear button to include the RM filter.

- [ ] **Step 1: Insert the RM select before the Member select**

Find the section that renders the Member select. It starts with the comment-less `<span style={{ color: "#cbd5e1", fontSize: 18, flexShrink: 0 }}>|</span>` at line 502 (the divider before the 👤 icon). Immediately **before** that divider line, insert:

```tsx
{rmDropdownOptions.length > 0 && (
  <>
    <span style={{ color: "#cbd5e1", fontSize: 18, flexShrink: 0 }}>|</span>
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: "#64748b",
        whiteSpace: "nowrap",
      }}
    >
      👔
    </span>
    <select
      value={fReportingManager}
      onChange={(e) => {
        setFReportingManager(e.target.value);
        setFMember("");
        setDrillDown(null);
      }}
      style={{
        padding: "5px 8px",
        border: "1px solid #e2e8f0",
        borderRadius: 6,
        fontSize: 12,
        minWidth: 110,
        maxWidth: 170,
      }}
    >
      <option value="">All Reporting Managers</option>
      {rmDropdownOptions.map((m) => (
        <option key={m.id} value={m.id}>
          {m.full_name}
        </option>
      ))}
    </select>
  </>
)}
```

- [ ] **Step 2: Disable the Member select when an RM is active**

Find the Member `<select>` (around line 513). Replace the existing element with one that adds `disabled` and a muted background when an RM is set:

```tsx
<select
  value={fMember}
  onChange={(e) => {
    setFMember(e.target.value);
    setDrillDown(null);
  }}
  disabled={!!fReportingManager}
  title={fReportingManager ? "Cleared by Reporting Manager filter" : undefined}
  style={{
    padding: "5px 8px",
    border: "1px solid #e2e8f0",
    borderRadius: 6,
    fontSize: 12,
    minWidth: 110,
    maxWidth: 150,
    background: fReportingManager ? "#f1f5f9" : "#fff",
    color: fReportingManager ? "#94a3b8" : "inherit",
    cursor: fReportingManager ? "not-allowed" : "auto",
  }}
>
  <option value="">All Members</option>
  {allMembers.map((m) => (
    <option key={m} value={m}>
      {m}
    </option>
  ))}
</select>
```

- [ ] **Step 3: Update the Clear button**

Find the Clear button block (around line 535):

```tsx
{(period || fClient || fMember) && (
  <button
    onClick={() => {
      setPeriod("");
      setFClient("");
      setFMember("");
      setDrillDown(null);
    }}
    ...
```

Replace its visibility condition and click handler so it also clears `fReportingManager`:

```tsx
{(period || fClient || fMember || fReportingManager) && (
  <button
    onClick={() => {
      setPeriod("");
      setFClient("");
      setFMember("");
      setFReportingManager("");
      setDrillDown(null);
    }}
    ...
```

(Leave the rest of the button — `style`, label, etc. — untouched.)

- [ ] **Step 4: Verify tsc still builds**

Run: `cd frontend/task-tracker && npx tsc -b`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/pages/DashboardPage.tsx
git commit -m "feat(dashboard): add Reporting Manager dropdown to filter bar"
```

---

## Task 4: Page-level smoke test

**Files:**
- Create: `frontend/task-tracker/src/__tests__/components/dashboard/dashboardReportingManager.smoke.test.tsx`

Mocks `useAuth` and the heavy child tables to keep the test focused on the filter bar. Verifies admin sees the dropdown, picking an RM disables Member and filters the team list, and a manager with no sub-managers does not see the dropdown.

- [ ] **Step 1: Write the failing test**

Create `frontend/task-tracker/src/__tests__/components/dashboard/dashboardReportingManager.smoke.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import type { Task, Profile } from "@/types";

const mockUseAuth = vi.fn();
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => mockUseAuth(),
}));

// Stub heavy children — they query data we don't care about for filter-bar tests.
vi.mock("@/components/dashboard/TeamTable", () => ({
  default: ({ teamNames }: { teamNames: string[] }) => (
    <div data-testid="team-table">{teamNames.join(",")}</div>
  ),
}));
vi.mock("@/components/dashboard/ClientTable", () => ({
  default: () => <div data-testid="client-table" />,
}));
vi.mock("@/components/dashboard/StatusDist", () => ({
  default: () => <div data-testid="status-dist" />,
}));
vi.mock("@/components/dashboard/TaskDetailTable", () => ({
  default: () => <div data-testid="task-detail-table" />,
}));
vi.mock("@/components/dashboard/RecentCompletions", () => ({
  default: () => <div data-testid="recent-completions" />,
}));
vi.mock("@/components/dashboard/ReportView", () => ({
  default: () => <div data-testid="report-view" />,
}));

import DashboardPage from "@/pages/DashboardPage";

function setRole(role: "admin" | "manager" | "user") {
  mockUseAuth.mockReturnValue({
    isAdminInAny: () => role === "admin",
    isManagerInAny: () => role === "admin" || role === "manager",
  });
}

const profile = (
  id: string,
  full_name: string,
  manager_ids: string[] | null = null,
): Profile =>
  ({
    id,
    username: full_name.toLowerCase(),
    email: `${full_name.toLowerCase()}@x.com`,
    full_name,
    manager_ids,
    avatar_color: null,
    orgs: [],
    highest_role: "employee",
  }) as unknown as Profile;

const task = (responsible: string, id = `t-${responsible}`): Task =>
  ({
    id,
    serialNo: 1,
    client: "Acme",
    category: "Audit",
    description: "x",
    status: "Pending",
    targetDate: "",
    expectedDate: "",
    completedDate: "",
    responsible,
    reportingManager: "",
    remarks: "",
    recurrence: "Onetime",
    organization: "org-1",
    createdBy: null,
    createdAt: null,
  }) as unknown as Task;

beforeEach(() => {
  cleanup();
  mockUseAuth.mockReset();
});

describe("DashboardPage — Reporting Manager filter", () => {
  it("admin sees the Reporting Manager dropdown when at least one manager exists", () => {
    setRole("admin");
    const profiles = [
      profile("1", "Alice"),
      profile("2", "Bob", ["1"]),
    ];
    render(
      <DashboardPage
        tasks={[task("Alice"), task("Bob")]}
        profile={profiles[0]}
        profiles={profiles}
      />,
    );
    expect(screen.getByDisplayValue("All Reporting Managers")).toBeTruthy();
  });

  it("admin does not see the dropdown when no profile has manager_ids", () => {
    setRole("admin");
    const profiles = [profile("1", "Alice"), profile("2", "Bob")];
    render(
      <DashboardPage
        tasks={[task("Alice")]}
        profile={profiles[0]}
        profiles={profiles}
      />,
    );
    expect(screen.queryByDisplayValue("All Reporting Managers")).toBeNull();
  });

  it("picking a Reporting Manager filters TeamTable to the sub-tree and disables Member", () => {
    setRole("admin");
    const profiles = [
      profile("1", "Alice"),
      profile("2", "Bob", ["1"]),     // reports to Alice
      profile("3", "Carol", ["1"]),   // reports to Alice
      profile("4", "Dave"),           // unrelated
    ];
    render(
      <DashboardPage
        tasks={[task("Alice"), task("Bob"), task("Carol"), task("Dave")]}
        profile={profiles[0]}
        profiles={profiles}
      />,
    );
    const rmSelect = screen.getByDisplayValue("All Reporting Managers") as HTMLSelectElement;
    fireEvent.change(rmSelect, { target: { value: "1" } });

    // TeamTable should now only see Alice's sub-tree
    const team = screen.getByTestId("team-table").textContent ?? "";
    const names = new Set(team.split(",").filter(Boolean));
    expect(names.has("Alice")).toBe(true);
    expect(names.has("Bob")).toBe(true);
    expect(names.has("Carol")).toBe(true);
    expect(names.has("Dave")).toBe(false);

    // Member dropdown is disabled
    const memberSelect = screen.getByDisplayValue("All Members") as HTMLSelectElement;
    expect(memberSelect.disabled).toBe(true);
  });

  it("clearing the RM re-enables the Member dropdown", () => {
    setRole("admin");
    const profiles = [profile("1", "Alice"), profile("2", "Bob", ["1"])];
    render(
      <DashboardPage
        tasks={[task("Alice"), task("Bob")]}
        profile={profiles[0]}
        profiles={profiles}
      />,
    );
    const rmSelect = screen.getByDisplayValue("All Reporting Managers") as HTMLSelectElement;
    fireEvent.change(rmSelect, { target: { value: "1" } });
    fireEvent.change(rmSelect, { target: { value: "" } });
    const memberSelect = screen.getByDisplayValue("All Members") as HTMLSelectElement;
    expect(memberSelect.disabled).toBe(false);
  });

  it("manager logged in with no sub-managers does not see the dropdown", () => {
    setRole("manager");
    const profiles = [
      profile("1", "Alice"),               // the logged-in manager
      profile("2", "Bob", ["1"]),          // IC reporting to Alice
      profile("3", "Carol", ["1"]),        // IC reporting to Alice
    ];
    render(
      <DashboardPage
        tasks={[task("Alice"), task("Bob"), task("Carol")]}
        profile={profiles[0]}
        profiles={profiles}
      />,
    );
    expect(screen.queryByDisplayValue("All Reporting Managers")).toBeNull();
  });

  it("manager picking a sub-manager sees the sub-manager's full sub-tree (incl. indirect reports)", () => {
    // Alice is the logged-in manager. Bob is her direct report and a sub-manager.
    // Carol reports to Bob (indirect report of Alice).
    // The default manager view restricts Alice to her direct reports — without
    // bypassing role-gating when an RM is set, Carol's tasks would be hidden.
    setRole("manager");
    const profiles = [
      profile("1", "Alice"),
      profile("2", "Bob", ["1"]),
      profile("3", "Carol", ["2"]),
      profile("4", "Dave"), // unrelated peer
    ];
    render(
      <DashboardPage
        tasks={[task("Alice"), task("Bob"), task("Carol"), task("Dave")]}
        profile={profiles[0]}
        profiles={profiles}
      />,
    );
    const rmSelect = screen.getByDisplayValue("All Reporting Managers") as HTMLSelectElement;
    // Bob (id 2) is the only sub-manager under Alice — picking Bob should
    // expand the dashboard to Bob's sub-tree (Bob + Carol).
    fireEvent.change(rmSelect, { target: { value: "2" } });

    const team = screen.getByTestId("team-table").textContent ?? "";
    const names = new Set(team.split(",").filter(Boolean));
    expect(names.has("Bob")).toBe(true);
    expect(names.has("Carol")).toBe(true);
    expect(names.has("Alice")).toBe(false);
    expect(names.has("Dave")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify behavior**

Run: `cd frontend/task-tracker && npm test -- dashboardReportingManager`
Expected: all 5 cases PASS.

If the assertion `screen.getByDisplayValue("All Reporting Managers")` fails because the option `<option value="">All Reporting Managers</option>` is not selected by default, the issue is most likely a typo in the option label between Task 3 step 1 and the test — fix the implementation, not the test (the spec specifies "All Reporting Managers" exactly).

- [ ] **Step 3: Commit**

```bash
git add frontend/task-tracker/src/__tests__/components/dashboard/dashboardReportingManager.smoke.test.tsx
git commit -m "test(dashboard): smoke test for Reporting Manager filter"
```

---

## Task 5: Final verification

**Files:** none.

- [ ] **Step 1: Run the full test suite**

Run: `cd frontend/task-tracker && npm test`
Expected: all tests pass. If any unrelated tests fail, those are pre-existing on this branch — note them but do not fix as part of this plan.

- [ ] **Step 2: Run the type checker**

Run: `cd frontend/task-tracker && npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Run the linter**

Run: `cd frontend/task-tracker && npm run lint`
Expected: no errors in the files touched by this plan (DashboardPage.tsx, reportingManager.ts, the two test files).

- [ ] **Step 4: Manual verification in the browser**

Start the dev server (`cd frontend/task-tracker && npm run dev`) and open the Team Dashboard as an admin user.

Verify:
- The 👔 Reporting Manager dropdown appears between Clients and Members (only if at least one manager exists in profiles).
- Default option reads "All Reporting Managers".
- Picking a manager: stat cards, Team Performance, By Client, and Status Distribution all narrow to that manager's sub-tree.
- The Members dropdown becomes greyed out and unclickable while a manager is selected.
- Clearing the RM re-enables Members.
- The ✕ Clear button clears the RM along with the other filters.
- Log in as a manager who has sub-managers under them: dropdown appears, lists only sub-managers.
- Log in as a manager whose reports are all ICs: dropdown is hidden.
- Log in as a regular member: dropdown is hidden.

- [ ] **Step 5: Final commit (if any leftover changes)**

If any of the verification steps surfaced a small fix, commit it now with a `fix(dashboard): ...` message. Otherwise nothing to do.
