# Calendar Main-Category Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Main Category" dropdown filter to the Calendar toolbar that scopes the calendar grid to tasks whose main category (parent goal's `category` for subtasks, the task's own `category` for top-level tasks) matches the selected value.

**Architecture:** A new `fMainCategory` state in `CalendarPage` is plumbed through the existing filter pipeline (role-scope → Subtasks-only → recurrence projection → toolbar filters). A `getMainCategory(t)` helper resolves the main category for both subtasks and top-level tasks via the existing `mainsById` map. The `CalendarToolbar` gains a new `<select>` between All Clients and All Members; the Clear (✕) button now also resets this filter.

**Tech Stack:** React + TypeScript (Vite), Vitest + Testing Library.

---

## File Structure

**Files created:**
- `frontend/task-tracker/src/__tests__/pages/calendarPage.mainCategoryFilter.test.tsx` — smoke test for the new filter.

**Files modified:**
- `frontend/task-tracker/src/components/calendar/CalendarToolbar.tsx` — three new props, new `<select>`, widened `filterActive`.
- `frontend/task-tracker/src/pages/CalendarPage.tsx` — state, `getMainCategory` helper, options memo, filter clause, prop wiring, Clear reset.

---

## Task 1: `CalendarToolbar` — Main Category select

**Files:**
- Modify: `frontend/task-tracker/src/components/calendar/CalendarToolbar.tsx`

This task is a pure component change. Functional behavior is exercised in Task 3.

- [ ] **Step 1: Extend the props interface**

Open `frontend/task-tracker/src/components/calendar/CalendarToolbar.tsx`. Replace the existing `CalendarToolbarProps` interface with:

```ts
interface CalendarToolbarProps {
  monthLabel: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;

  layers: CalendarLayers;
  onLayersChange: (v: CalendarLayers) => void;

  subtasksOnly: boolean;
  onSubtasksOnlyChange: (v: boolean) => void;

  clientOptions: string[];
  memberOptions: string[];
  mainCategoryOptions: string[];
  fClient: string;
  fMember: string;
  fMainCategory: string;
  onClientChange: (v: string) => void;
  onMemberChange: (v: string) => void;
  onMainCategoryChange: (v: string) => void;
  onClear: () => void;
}
```

- [ ] **Step 2: Extend the destructure**

Replace the existing `const { ... } = props;` block with:

```ts
  const {
    monthLabel,
    onPrev,
    onNext,
    onToday,
    layers,
    onLayersChange,
    subtasksOnly,
    onSubtasksOnlyChange,
    clientOptions,
    memberOptions,
    mainCategoryOptions,
    fClient,
    fMember,
    fMainCategory,
    onClientChange,
    onMemberChange,
    onMainCategoryChange,
    onClear,
  } = props;
```

- [ ] **Step 3: Widen `filterActive`**

Replace:

```ts
  const filterActive = !!(fClient || fMember);
```

with:

```ts
  const filterActive = !!(fClient || fMember || fMainCategory);
```

- [ ] **Step 4: Insert the new `<select>` between Client and Member**

Find this existing block:

```tsx
      <select
        value={fClient}
        onChange={(e) => onClientChange(e.target.value)}
        style={selectStyle}
        aria-label="Filter by client"
      >
        <option value="">All Clients</option>
        {clientOptions.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <select
        value={fMember}
        onChange={(e) => onMemberChange(e.target.value)}
        style={selectStyle}
        aria-label="Filter by member"
      >
        <option value="">All Members</option>
        {memberOptions.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
```

Replace it with this version (the only change is the new select inserted between the two existing ones):

```tsx
      <select
        value={fClient}
        onChange={(e) => onClientChange(e.target.value)}
        style={selectStyle}
        aria-label="Filter by client"
      >
        <option value="">All Clients</option>
        {clientOptions.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <select
        value={fMainCategory}
        onChange={(e) => onMainCategoryChange(e.target.value)}
        style={selectStyle}
        aria-label="Filter by main category"
      >
        <option value="">All Main Categories</option>
        {mainCategoryOptions.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <select
        value={fMember}
        onChange={(e) => onMemberChange(e.target.value)}
        style={selectStyle}
        aria-label="Filter by member"
      >
        <option value="">All Members</option>
        {memberOptions.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
```

- [ ] **Step 5: Type-check**

Run from `frontend/task-tracker/`:

```
npx tsc --noEmit -p tsconfig.app.json
```

Expected: a single error in `CalendarPage.tsx` complaining that the `<CalendarToolbar ...>` mount is missing the three new required props (`mainCategoryOptions`, `fMainCategory`, `onMainCategoryChange`). This is expected — Task 2 fixes it.

- [ ] **Step 6: Commit**

```
git add frontend/task-tracker/src/components/calendar/CalendarToolbar.tsx
git commit -m "feat(calendar): add Main Category select to toolbar"
```

---

## Task 2: `CalendarPage` — wire the filter

**Files:**
- Modify: `frontend/task-tracker/src/pages/CalendarPage.tsx`

- [ ] **Step 1: Add `fMainCategory` state**

Find this block (the existing client/member state):

```ts
  const [fClient, setFClient] = useState("");
  const [fMember, setFMember] = useState("");
```

Replace it with:

```ts
  const [fClient, setFClient] = useState("");
  const [fMember, setFMember] = useState("");
  const [fMainCategory, setFMainCategory] = useState("");
```

- [ ] **Step 2: Add the `getMainCategory` helper and `mainCategoryOptions` memo**

Find the existing `clientOptions` / `memberOptions` block:

```ts
  // --- Filter option lists are union of tasks + plans (pre-filter). ---
  const clientOptions = useMemo(
    () =>
      [
        ...new Set(
          [
            ...visibleTasks.map((t) => t.client || ""),
            ...visiblePlans.map((p) => p.client || ""),
          ].filter(Boolean),
        ),
      ].sort(),
    [visibleTasks, visiblePlans],
  );
  const memberOptions = useMemo(
    () =>
      [
        ...new Set(
          [
            ...visibleTasks.map((t) => t.responsible || ""),
            ...visiblePlans.map((p) => p.name || ""),
          ].filter(Boolean),
        ),
      ].sort(),
    [visibleTasks, visiblePlans],
  );
```

Immediately AFTER that block, insert:

```ts
  const getMainCategory = (t: Task): string => {
    if (!t.parentId) return t.category || "";
    return mainsById.get(t.parentId)?.category || "";
  };

  const mainCategoryOptions = useMemo(
    () =>
      [
        ...new Set(visibleTasks.map((t) => getMainCategory(t)).filter(Boolean)),
      ].sort(),
    // getMainCategory closes over `mainsById`; include it explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleTasks, mainsById],
  );
```

- [ ] **Step 3: Add the filter clause to `filteredMonthTasks`**

Find the existing `filteredMonthTasks` memo:

```ts
  const filteredMonthTasks = useMemo(
    () =>
      monthTasks.filter(
        (t) =>
          (!fClient || t.client === fClient) &&
          (!fMember || t.responsible === fMember),
      ),
    [monthTasks, fClient, fMember],
  );
```

Replace it with:

```ts
  const filteredMonthTasks = useMemo(
    () =>
      monthTasks.filter(
        (t) =>
          (!fClient || t.client === fClient) &&
          (!fMember || t.responsible === fMember) &&
          (!fMainCategory || getMainCategory(t) === fMainCategory),
      ),
    // getMainCategory closes over `mainsById`; include it explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [monthTasks, fClient, fMember, fMainCategory, mainsById],
  );
```

- [ ] **Step 4: Wire the toolbar props and Clear reset**

Find the existing `<CalendarToolbar ...>` mount in the JSX. Replace the whole block with:

```tsx
      <CalendarToolbar
        monthLabel={`${MONTHS[month]} ${year}`}
        onPrev={prevMonth}
        onNext={nextMonth}
        onToday={goToday}
        layers={layers}
        onLayersChange={(v) => {
          setLayers(v);
          setExpandDay(null);
        }}
        subtasksOnly={subtasksOnly}
        onSubtasksOnlyChange={(v) => {
          setSubtasksOnly(v);
          setExpandDay(null);
        }}
        clientOptions={clientOptions}
        memberOptions={memberOptions}
        mainCategoryOptions={mainCategoryOptions}
        fClient={fClient}
        fMember={fMember}
        fMainCategory={fMainCategory}
        onClientChange={(v) => {
          setFClient(v);
          setExpandDay(null);
        }}
        onMemberChange={(v) => {
          setFMember(v);
          setExpandDay(null);
        }}
        onMainCategoryChange={(v) => {
          setFMainCategory(v);
          setExpandDay(null);
        }}
        onClear={() => {
          setFClient("");
          setFMember("");
          setFMainCategory("");
          setExpandDay(null);
        }}
      />
```

- [ ] **Step 5: Type-check + existing tests**

Run from `frontend/task-tracker/`:

```
npx tsc --noEmit -p tsconfig.app.json
```

Expected: no errors.

Then run the existing calendar tests:

```
npx vitest run src/__tests__/pages/calendarPage.subtasksOnly.test.tsx src/__tests__/utils/calendarLayers.test.ts
```

Expected: all pass (sanity check that we did not break the Subtasks-only filter or the layer helpers).

- [ ] **Step 6: Commit**

```
git add frontend/task-tracker/src/pages/CalendarPage.tsx
git commit -m "feat(calendar): wire Main Category filter end-to-end"
```

---

## Task 3: Smoke test for the filter

**Files:**
- Create: `frontend/task-tracker/src/__tests__/pages/calendarPage.mainCategoryFilter.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/task-tracker/src/__tests__/pages/calendarPage.mainCategoryFilter.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Profile } from "@/types/auth";
import type { Task } from "@/types";
import type { ID } from "@/types/common";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    isAdminInAny: () => true,
    isManagerInAny: () => false,
  }),
}));

vi.mock("@/hooks/useWorkPlans", () => ({
  useWorkPlans: () => ({ plans: [] }),
}));

import CalendarPage from "@/pages/CalendarPage";

const profile: Profile = {
  id: "p1",
  username: "alice",
  full_name: "Alice",
  email: "a@x.com",
  manager_ids: null,
  avatar_color: null,
  orgs: [],
  highest_role: "admin",
};

const now = new Date();
const yyyy = now.getFullYear();
const mm = String(now.getMonth() + 1).padStart(2, "0");
const monthPrefix = `${yyyy}-${mm}`;

const dbParent: Task = {
  id: "goal-db" as ID,
  serialNo: 1,
  client: "Acme",
  category: "DB Update",
  description: "DB Update Goal",
  status: "Pending",
  targetDate: `${monthPrefix}-05`,
  expectedDate: "",
  completedDate: "",
  responsible: "Alice",
  reportingManager: "",
  remarks: "",
  recurrence: "Onetime",
  organization: "",
  createdBy: null,
  createdAt: null,
  parentId: null,
};

const dbSub: Task = {
  ...dbParent,
  id: "sub-db" as ID,
  serialNo: 2,
  category: "Report Submission",
  description: "Report submission",
  targetDate: `${monthPrefix}-10`,
  parentId: "goal-db" as ID,
  planUid: "plan-db",
};

const cashflowTask: Task = {
  ...dbParent,
  id: "task-cf" as ID,
  serialNo: 3,
  category: "Cash flow",
  description: "Cashflow Standalone",
  targetDate: `${monthPrefix}-15`,
  parentId: null,
};

const tasks: Task[] = [dbParent, dbSub, cashflowTask];

const mainsById = new Map<
  ID,
  { category: string; responsible: string; description: string }
>([
  [
    "goal-db" as ID,
    {
      category: "DB Update",
      responsible: "Alice",
      description: "DB Update Goal",
    },
  ],
]);

beforeEach(() => {
  cleanup();
  localStorage.clear();
});

describe("CalendarPage — Main Category filter", () => {
  it("lists both parent-derived and own categories in the dropdown", () => {
    render(
      <CalendarPage
        tasks={tasks}
        profile={profile}
        profiles={[]}
        mainsById={mainsById}
      />,
    );

    const select = screen.getByLabelText(/filter by main category/i) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toContain("");
    expect(options).toContain("DB Update");
    expect(options).toContain("Cash flow");
    expect(options).not.toContain("Report Submission"); // sub-cat must not surface
  });

  it("filters the grid by selected main category", () => {
    render(
      <CalendarPage
        tasks={tasks}
        profile={profile}
        profiles={[]}
        mainsById={mainsById}
      />,
    );

    // Default state: all three rows present.
    expect(screen.queryAllByText(/DB Update Goal/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/Report submission/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/Cashflow Standalone/).length).toBeGreaterThan(0);

    const select = screen.getByLabelText(/filter by main category/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "DB Update" } });

    // Cashflow gone, DB rows still present (parent + sub via parent's category).
    expect(screen.queryAllByText(/Cashflow Standalone/).length).toBe(0);
    expect(screen.queryAllByText(/DB Update Goal/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/Report submission/).length).toBeGreaterThan(0);

    fireEvent.change(select, { target: { value: "Cash flow" } });

    // Only the cashflow row remains.
    expect(screen.queryAllByText(/Cashflow Standalone/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/DB Update Goal/).length).toBe(0);
    expect(screen.queryAllByText(/Report submission/).length).toBe(0);
  });

  it("Clear (✕) button resets the dropdown along with the others", () => {
    render(
      <CalendarPage
        tasks={tasks}
        profile={profile}
        profiles={[]}
        mainsById={mainsById}
      />,
    );

    const select = screen.getByLabelText(/filter by main category/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "DB Update" } });
    expect(select.value).toBe("DB Update");

    const clear = screen.getByRole("button", { name: /clear/i });
    fireEvent.click(clear);

    expect(select.value).toBe("");
    // All rows visible again.
    expect(screen.queryAllByText(/Cashflow Standalone/).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/DB Update Goal/).length).toBeGreaterThan(0);
  });

  it("options list narrows with Subtasks-only ON (top-level-only category disappears)", () => {
    render(
      <CalendarPage
        tasks={tasks}
        profile={profile}
        profiles={[]}
        mainsById={mainsById}
      />,
    );

    const pill = screen.getByRole("button", { name: /show subtasks only/i });
    fireEvent.click(pill);

    const select = screen.getByLabelText(/filter by main category/i) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);

    // With only subtasks visible, "Cash flow" (contributed by the top-level
    // task with no children) should not appear; "DB Update" still does
    // because its subtask inherits it via mainsById.
    expect(options).toContain("DB Update");
    expect(options).not.toContain("Cash flow");
  });
});
```

- [ ] **Step 2: Run the test**

```
cd frontend/task-tracker && npx vitest run src/__tests__/pages/calendarPage.mainCategoryFilter.test.tsx
```

Expected: all four tests pass.

- [ ] **Step 3: Commit**

```
git add frontend/task-tracker/src/__tests__/pages/calendarPage.mainCategoryFilter.test.tsx
git commit -m "test(calendar): smoke test for Main Category filter"
```

---

## Task 4: Final verification

- [ ] **Step 1: Run the full frontend test suite**

```
cd frontend/task-tracker && npx vitest run
```

Expected: all tests pass (the previous Subtasks-only smoke test and the new Main Category smoke test both green).

- [ ] **Step 2: Run the type-checker**

```
cd frontend/task-tracker && npx tsc --noEmit -p tsconfig.app.json
```

Expected: no errors.

- [ ] **Step 3: Run pre-commit on the whole tree**

From the repo root:

```
uv run pre-commit run --all-files
```

Expected: all hooks pass (ruff, ruff-format, mypy, pyright, eslint, tsc, build). If a hook fails, fix the underlying issue (do NOT pass `--no-verify`).

- [ ] **Step 4: Manual smoke test in the browser**

```
cd frontend/task-tracker && npm run dev
```

Visit the Calendar page and verify:
1. The toolbar shows a new "All Main Categories" dropdown between All Clients and All Members.
2. The dropdown lists the distinct main categories visible to the current user.
3. Selecting a category narrows the grid; the day modal also only shows rows under that category.
4. The Clear (✕) button resets the new dropdown along with the others, and appears whenever any of Client / Member / Main Category is set.
5. Toggling Subtasks-only ON shrinks the dropdown options to categories derivable from subtasks via their parent goal.
6. Switching months keeps the selected category active.

- [ ] **Step 5: Push**

```
git push
```

(Upstream is already set; no `--set-upstream` needed.)

---

## Self-review notes

**Spec coverage check:**

- New `All Main Categories` dropdown between All Clients and All Members — Task 1 (toolbar), Task 2 (page wiring).
- `getMainCategory(t)` helper with the Dashboard's definition — Task 2.
- Clear (✕) button resets the new filter — Task 1 (`filterActive` widening) + Task 2 (`onClear` extension).
- Options list narrows with Subtasks-only ON — covered by deriving from `visibleTasks` in Task 2; verified in Task 3 test #4.
- Smoke test covering options, filtering, clearing, Subtasks-only interaction — Task 3.
- Final verification (tests + tsc + pre-commit + manual smoke) — Task 4.

All spec requirements trace to at least one task. No placeholders. Names are consistent across tasks: `fMainCategory`, `setFMainCategory`, `getMainCategory`, `mainCategoryOptions`, `onMainCategoryChange`.
