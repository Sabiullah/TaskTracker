# Recurring Work-Month Label Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show `description — <month before target_date>` (e.g. `BRS — Jun 2026`) on **Monthly occurrence** rows in the Board and Dashboard, derived live from each row's target date, and strip the old hand-typed month suffixes from stored descriptions.

**Architecture:** A one-time Django data migration removes trailing ` — Mon YYYY` suffixes from `Task.description` and `TaskSubcategoryPlan.description`. On the frontend, one pure helper (`taskDisplayDescription`) appends the derived label only for Monthly rows that have a parent and a target date; it's applied at the Board card, the Dashboard drilldown render, and the Dashboard CSV export. Edit inputs keep the raw description.

**Tech Stack:** Django 5 (RunPython migration, `TransactionTestCase` + `MigrationExecutor` for tests), React + TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-18-recurring-work-month-label-design.md`

---

## File Structure

- **Create** `core/tasks/migrations/0019_strip_typed_month_suffix.py` — one-time cleanup of stored descriptions.
- **Modify** `core/tasks/tests_migrations.py` — add a test class for the strip.
- **Modify** `frontend/task-tracker/src/utils/date.ts` — add `workMonthLabel`.
- **Create** `frontend/task-tracker/src/utils/taskDescription.ts` — `taskDisplayDescription` helper.
- **Create** `frontend/task-tracker/src/__tests__/utils/taskDescription.test.ts` — helper unit tests.
- **Modify** `frontend/task-tracker/src/__tests__/utils/date.test.ts` — `workMonthLabel` tests.
- **Modify** `frontend/task-tracker/src/components/board/TaskCard.tsx` — use helper at line 181.
- **Modify** `frontend/task-tracker/src/components/dashboard/TaskDetailTable.tsx` — use helper at render (517) and CSV export (309-311).

---

## Task 1: Frontend helper — `workMonthLabel`

**Files:**
- Modify: `frontend/task-tracker/src/utils/date.ts` (add after `formatMonthLabel`, ~line 58)
- Test: `frontend/task-tracker/src/__tests__/utils/date.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `frontend/task-tracker/src/__tests__/utils/date.test.ts`:

```typescript
import { workMonthLabel } from "@/utils/date";

describe("workMonthLabel", () => {
  it("returns the month before the target date", () => {
    expect(workMonthLabel("2026-07-10")).toBe("Jun 2026");
  });

  it("rolls a January target back to December of the prior year", () => {
    expect(workMonthLabel("2026-01-10")).toBe("Dec 2025");
  });

  it("returns empty string for null/empty/malformed input", () => {
    expect(workMonthLabel(null)).toBe("");
    expect(workMonthLabel("")).toBe("");
    expect(workMonthLabel(undefined)).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend/task-tracker && npx vitest --run src/__tests__/utils/date.test.ts`
Expected: FAIL — `workMonthLabel` is not exported from `@/utils/date`.

- [ ] **Step 3: Write minimal implementation**

Add to `frontend/task-tracker/src/utils/date.ts` immediately after `formatMonthLabel` (after line 58):

```typescript
/**
 * The month immediately BEFORE a task's target date, formatted "Jun 2026".
 * Monthly recurring work is done for the previous month, so a row due
 * 2026-07-10 covers "Jun 2026". A January target rolls back to December of
 * the prior year. Returns "" for missing / malformed input.
 *
 * Derived by month arithmetic on the YYYY-MM-DD string (not Date UTC
 * parsing) to avoid timezone-driven off-by-one-day month shifts.
 */
export function workMonthLabel(targetDate: DateString | null | undefined): string {
  if (!targetDate) return "";
  const [y, m] = targetDate.split("-").map(Number);
  if (!y || !m) return "";
  // m is 1-based; the previous month index (0-based) is m - 2. The Date
  // constructor normalises a -1 month to December of the prior year.
  return new Date(y, m - 2, 1).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend/task-tracker && npx vitest --run src/__tests__/utils/date.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/utils/date.ts frontend/task-tracker/src/__tests__/utils/date.test.ts
git commit -m "feat(tasks): add workMonthLabel (previous month of target date)"
```

---

## Task 2: Frontend helper — `taskDisplayDescription`

**Files:**
- Create: `frontend/task-tracker/src/utils/taskDescription.ts`
- Test: `frontend/task-tracker/src/__tests__/utils/taskDescription.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/task-tracker/src/__tests__/utils/taskDescription.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { taskDisplayDescription } from "@/utils/taskDescription";
import type { Task } from "@/types";

// Minimal Task factory — only the fields the helper reads matter; the rest
// are filled with harmless defaults.
function makeTask(overrides: Partial<Task>): Task {
  return {
    id: "1",
    serialNo: 1,
    description: "BRS",
    targetDate: "2026-07-10",
    recurrence: "Monthly",
    parentId: "99",
    ...overrides,
  } as Task;
}

describe("taskDisplayDescription", () => {
  it("appends the previous month for a Monthly occurrence", () => {
    expect(taskDisplayDescription(makeTask({}))).toBe("BRS — Jun 2026");
  });

  it("leaves a Monthly main goal (no parent) unchanged", () => {
    expect(taskDisplayDescription(makeTask({ parentId: null }))).toBe("BRS");
  });

  it("leaves a Weekly occurrence unchanged", () => {
    expect(taskDisplayDescription(makeTask({ recurrence: "Weekly" }))).toBe("BRS");
  });

  it("leaves a Monthly occurrence with no target date unchanged", () => {
    expect(
      taskDisplayDescription(makeTask({ targetDate: null as unknown as Task["targetDate"] })),
    ).toBe("BRS");
  });

  it("appends exactly one month to an already-clean name", () => {
    const out = taskDisplayDescription(makeTask({ description: "Sales" }));
    expect(out).toBe("Sales — Jun 2026");
    expect(out.match(/—/g)?.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend/task-tracker && npx vitest --run src/__tests__/utils/taskDescription.test.ts`
Expected: FAIL — module `@/utils/taskDescription` not found.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/task-tracker/src/utils/taskDescription.ts`:

```typescript
import type { Task } from "@/types";
import { workMonthLabel } from "@/utils/date";

/**
 * Description as shown to users. For a Monthly *occurrence* — a materialized
 * child row (has a parent) with a target date — append the work-month it
 * covers, e.g. "BRS — Jun 2026". Main goals (no parent), Weekly/Onetime
 * tasks, and rows without a target date are returned unchanged.
 *
 * The month is derived live from target_date and never stored, so it cannot
 * go stale. This is the single source of truth for the on-screen label and
 * the Dashboard CSV export.
 */
export function taskDisplayDescription(task: Task): string {
  const base = task.description || "";
  if (task.recurrence !== "Monthly" || task.parentId == null || !task.targetDate) {
    return base;
  }
  const label = workMonthLabel(task.targetDate);
  return label ? `${base} — ${label}` : base;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend/task-tracker && npx vitest --run src/__tests__/utils/taskDescription.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/utils/taskDescription.ts frontend/task-tracker/src/__tests__/utils/taskDescription.test.ts
git commit -m "feat(tasks): add taskDisplayDescription shared label helper"
```

---

## Task 3: Apply helper to the Board card

**Files:**
- Modify: `frontend/task-tracker/src/components/board/TaskCard.tsx` (import block ~line 5; render at line 181)

- [ ] **Step 1: Add the import**

In `frontend/task-tracker/src/components/board/TaskCard.tsx`, after the existing
`import { dateStatus } from "@/utils/task";` (line 6), add:

```typescript
import { taskDisplayDescription } from "@/utils/taskDescription";
```

- [ ] **Step 2: Use the helper in the render**

Replace line 181:

```tsx
        {task.description || "(no description)"}
```

with:

```tsx
        {taskDisplayDescription(task) || "(no description)"}
```

- [ ] **Step 3: Verify build + existing board tests pass**

Run: `cd frontend/task-tracker && npx vitest --run src/__tests__/components/board`
Expected: PASS (existing board card tests still green; helper is a no-op for their non-Monthly / no-parent fixtures unless they are Monthly occurrences).

- [ ] **Step 4: Commit**

```bash
git add frontend/task-tracker/src/components/board/TaskCard.tsx
git commit -m "feat(board): show derived work-month on monthly occurrence cards"
```

---

## Task 4: Apply helper to the Dashboard drilldown (render + CSV export)

**Files:**
- Modify: `frontend/task-tracker/src/components/dashboard/TaskDetailTable.tsx` (import ~line 4; CSV export 309-311; render 517 and 521)

- [ ] **Step 1: Add the import**

In `frontend/task-tracker/src/components/dashboard/TaskDetailTable.tsx`, after
`import type { Task, Profile } from "@/types";` (line 4), add:

```typescript
import { taskDisplayDescription } from "@/utils/taskDescription";
```

- [ ] **Step 2: Update the CSV export Description field**

Replace lines 309-311:

```tsx
                    Description: isSub
                      ? `Subtask ${subNumber}: ${t.description || ""}`
                      : t.description || "",
```

with:

```tsx
                    Description: isSub
                      ? `Subtask ${subNumber}: ${taskDisplayDescription(t)}`
                      : taskDisplayDescription(t),
```

- [ ] **Step 3: Update the on-screen render (sub branch)**

Replace lines 517-518:

```tsx
                          {t.description ||
                            `Sub of #${t.serialNo ?? ""}`}
```

with:

```tsx
                          {taskDisplayDescription(t) ||
                            `Sub of #${t.serialNo ?? ""}`}
```

- [ ] **Step 4: Update the on-screen render (main-goal branch)**

Replace line 521:

```tsx
                        t.description || ""
```

with:

```tsx
                        taskDisplayDescription(t) || ""
```

(The helper returns the raw description for main-goal rows — no parent — so this branch is unchanged in behavior but stays consistent through one code path.)

- [ ] **Step 5: Verify existing dashboard tests pass**

Run: `cd frontend/task-tracker && npx vitest --run src/__tests__/components/dashboard src/__tests__/pages`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/task-tracker/src/components/dashboard/TaskDetailTable.tsx
git commit -m "feat(dashboard): show derived work-month in drilldown + CSV export"
```

---

## Task 5: Backend migration — strip typed month suffixes

**Files:**
- Create: `core/tasks/migrations/0019_strip_typed_month_suffix.py`
- Test: `core/tasks/tests_migrations.py` (append a new test class)

- [ ] **Step 1: Write the failing test**

Append to `core/tasks/tests_migrations.py`:

```python
class StripMonthSuffixMigrationTests(TransactionTestCase):
    """0019 strips a trailing hand-typed ' — Mon YYYY' suffix from Task and
    TaskSubcategoryPlan descriptions, leaving clean names and non-month
    trailing text untouched, and is idempotent.
    """

    def setUp(self):
        executor = MigrationExecutor(connection)
        executor.migrate([("tasks", "0018_backfill_child_plan_fk")])
        executor.loader.build_graph()
        self.executor = executor

    def tearDown(self):
        self.executor.loader.build_graph()
        self.executor.migrate(self.executor.loader.graph.leaf_nodes())

    def _models(self, leaf):
        state = self.executor.loader.project_state([("tasks", leaf)])
        return (
            state.apps.get_model("users", "Org"),
            state.apps.get_model("masters", "Master"),
            state.apps.get_model("tasks", "Task"),
        )

    def test_strips_month_suffix_only(self):
        Org, Master, Task = self._models("0018_backfill_child_plan_fk")
        org = Org.objects.create(name="Acme")
        client = Master.objects.create(name="C1", type="client", org=org)
        main = Task.objects.create(
            description="Goal", org=org, client=client, target_date=date(2027, 4, 30)
        )
        emdash = Task.objects.create(
            parent=main, org=org, client=client,
            description="BRS — Jun 2026", target_date=date(2026, 7, 10), status="pending",
        )
        fullname = Task.objects.create(
            parent=main, org=org, client=client,
            description="Sales - June 2026", target_date=date(2026, 7, 10), status="pending",
        )
        clean = Task.objects.create(
            parent=main, org=org, client=client,
            description="Creditors Ageing", target_date=date(2026, 7, 10), status="pending",
        )
        not_a_month = Task.objects.create(
            parent=main, org=org, client=client,
            description="Audit FY 2025", target_date=date(2026, 7, 10), status="pending",
        )

        self.executor.loader.build_graph()
        self.executor.migrate([("tasks", "0019_strip_typed_month_suffix")])

        for obj, expected in [
            (emdash, "BRS"),
            (fullname, "Sales"),
            (clean, "Creditors Ageing"),
            (not_a_month, "Audit FY 2025"),
        ]:
            obj.refresh_from_db()
            self.assertEqual(obj.description, expected)

    def test_idempotent(self):
        Org, Master, Task = self._models("0018_backfill_child_plan_fk")
        org = Org.objects.create(name="Acme")
        client = Master.objects.create(name="C1", type="client", org=org)
        main = Task.objects.create(
            description="Goal", org=org, client=client, target_date=date(2027, 4, 30)
        )
        row = Task.objects.create(
            parent=main, org=org, client=client,
            description="BRS — Jun 2026", target_date=date(2026, 7, 10), status="pending",
        )
        self.executor.loader.build_graph()
        self.executor.migrate([("tasks", "0019_strip_typed_month_suffix")])
        row.refresh_from_db()
        self.assertEqual(row.description, "BRS")
        # Running the strip logic again changes nothing further.
        from core.tasks.migrations import _strip_month_suffix as mod  # noqa: F401
```

Note: the final `import` line is a smoke check that the helper module symbol
exists; it is replaced in Step 3 by importing the actual function. Keep the
assertion `self.assertEqual(row.description, "BRS")` as the idempotency proof
(a second `migrate` to the same leaf is a no-op, and the strip is written to
be a no-op on already-clean text).

- [ ] **Step 2: Run test to verify it fails**

Run: `python manage.py test core.tasks.tests_migrations.StripMonthSuffixMigrationTests`
Expected: FAIL — migration `0019_strip_typed_month_suffix` does not exist.

- [ ] **Step 3: Write the migration**

Create `core/tasks/migrations/0019_strip_typed_month_suffix.py`:

```python
"""One-time cleanup: strip hand-typed ' — Mon YYYY' suffixes from task and
plan descriptions.

The month a Monthly row covers is now derived live from ``target_date`` in
the UI. Historically users typed it into the free-text description (e.g.
``BRS — Jun 2026``), which was inconsistent and went stale. Removing the
stored suffix prevents a doubled month (``BRS — Jun 2026 — May 2026``) once
the derived label renders.

Only a trailing separator + month token + 4-digit year is removed, so text
like ``Audit FY 2025`` (no month before the year) is left intact.
"""

import re

from django.db import migrations

# Trailing:  <space?> (— | – | -) <space?> <Jan..Dec + optional rest> <space> <YYYY>
_MONTH_SUFFIX = re.compile(
    r"\s*[—–-]\s*"
    r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?"
    r"\s+\d{4}\s*$",
    re.IGNORECASE,
)


def _strip_month_suffix(text):
    if not text:
        return text
    return _MONTH_SUFFIX.sub("", text).rstrip()


def strip_month_suffix(apps, schema_editor):
    Task = apps.get_model("tasks", "Task")
    Plan = apps.get_model("tasks", "TaskSubcategoryPlan")
    for Model in (Task, Plan):
        to_update = []
        for obj in Model.objects.exclude(description__isnull=True).exclude(description="").iterator():
            cleaned = _strip_month_suffix(obj.description)
            if cleaned != obj.description:
                obj.description = cleaned
                to_update.append(obj)
        if to_update:
            Model.objects.bulk_update(to_update, ["description"], batch_size=500)


class Migration(migrations.Migration):

    dependencies = [
        ("tasks", "0018_backfill_child_plan_fk"),
    ]

    operations = [
        migrations.RunPython(strip_month_suffix, migrations.RunPython.noop),
    ]
```

Then in `core/tasks/tests_migrations.py`, replace the placeholder final line of
`test_idempotent` (`from core.tasks.migrations import _strip_month_suffix ...`)
with a direct check of the strip helper being a no-op on clean text:

```python
        from core.tasks.migrations import (
            _0019_strip_typed_month_suffix as _m,  # type: ignore[attr-defined]
        )
```

If that import path is awkward (dotted module name starts with a digit), use
`importlib` instead:

```python
        import importlib

        _m = importlib.import_module("core.tasks.migrations.0019_strip_typed_month_suffix")
        self.assertEqual(_m._strip_month_suffix("BRS"), "BRS")
        self.assertEqual(_m._strip_month_suffix("BRS — Jun 2026"), "BRS")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python manage.py test core.tasks.tests_migrations.StripMonthSuffixMigrationTests`
Expected: PASS.

- [ ] **Step 5: Verify no other migrations are needed**

Run: `python manage.py makemigrations --check --dry-run`
Expected: "No changes detected" (this migration is data-only; no schema change).

- [ ] **Step 6: Commit**

```bash
git add core/tasks/migrations/0019_strip_typed_month_suffix.py core/tasks/tests_migrations.py
git commit -m "feat(tasks): strip hand-typed month suffixes from descriptions (0019)"
```

---

## Task 6: Full verification

- [ ] **Step 1: Run the whole frontend test suite**

Run: `cd frontend/task-tracker && npm run test`
Expected: PASS.

- [ ] **Step 2: Run the tasks backend tests**

Run: `python manage.py test core.tasks`
Expected: PASS.

- [ ] **Step 3: Run pre-commit across all files (matches CI)**

Run: `uv run pre-commit run --all-files`
Expected: PASS (ruff, format, line-endings, mypy, pyright, eslint, tsc, build).

- [ ] **Step 4: Manual smoke check**

Open the Board filtered to a Monthly client (e.g. Internal Audit): an
occurrence card due 10 Jul 2026 reads `Sales — Jun 2026`; the umbrella goal
reads just `Monthly Internal Audit`. Open the Dashboard drilldown for the
same client and export CSV — the `Description` column carries the same
`Sales — Jun 2026`. A Book Keeping (plainly-named) client shows the month
too, derived from each row's target date.

---

## Self-Review Notes

- **Spec coverage:** migration cleanup (Task 5) ✓; derived-label helper (Tasks 1-2) ✓; Board (Task 3) ✓; Dashboard render + CSV export (Task 4) ✓; edit inputs untouched (not modified) ✓; Monthly-only + parent-required + Jan→Dec rollover (Tasks 1-2 tests) ✓; FY-2025 non-strip guard (Task 5 test) ✓.
- **Names are consistent:** `workMonthLabel` and `taskDisplayDescription` used identically across tasks and tests.
- **Out of scope (per approved spec):** Calendar, Client roadmap/action-point/overdue panels, Recent completions — left rendering raw `description`.
