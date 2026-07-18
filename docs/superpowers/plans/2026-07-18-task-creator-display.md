# Task Creator + Creation-Time Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show who created each task and when — `Created by <name> · 18 Jul 15:42` at the top of the Edit Task modal, and `Created by <name> · 18 Jul` on each Board card.

**Architecture:** Frontend display-only. The backend already records `created_by`/`created_at` and serves them via `created_by_detail`/`created_at` in `TaskSerializer`. We carry the creator's display name onto the domain `Task`, add two date formatters, and render a guarded meta line on the modal and the card.

**Tech Stack:** React + TypeScript (Vite), Vitest + @testing-library, existing `@/utils/date` helpers.

**Working dir for all commands:** `frontend/task-tracker` (run `cd frontend/task-tracker` first).

---

## File Structure

- Modify `src/types/task.ts` — add optional `createdByName` to domain `Task`.
- Modify `src/lib/api/mappers.ts` — populate `createdByName` in `dtoToTask`.
- Modify `src/__tests__/lib/api/mappers.test.ts` — assert the new mapping.
- Modify `src/utils/date.ts` — add `fmtCreatedAt` + `fmtCreatedDate`.
- Create `src/__tests__/utils/date.test.ts` — test the two formatters.
- Modify `src/components/board/TaskCard.tsx` — compact `Created by X · 18 Jul` line.
- Modify `src/components/board/TaskModal.tsx` — full `Created by X · 18 Jul 15:42` line.

---

## Task 1: Carry the creator name onto the domain `Task`

**Files:**
- Modify: `src/types/task.ts` (the `Task` interface, currently ends with `parentId`/`engagement_*`/`planUid`)
- Modify: `src/lib/api/mappers.ts:120-138` (`dtoToTask` return object)
- Test: `src/__tests__/lib/api/mappers.test.ts:196-214` and `:244-251`

**Why optional:** ~13 test files construct `Task` literals directly. Making the field required would break their type-checks for a display-only value. The mapper always sets it to a string, so real data is never `undefined`.

- [ ] **Step 1: Update the mapper test to expect `createdByName`**

In `src/__tests__/lib/api/mappers.test.ts`, in the first `dtoToTask` test, add the field to the `toEqual(...)` object (place it right after `createdBy: "user-uid-2",`):

```ts
      createdBy: "user-uid-2",
      createdByName: "Alice",
      createdAt: "2026-04-10T10:00:00Z",
```

In the second `dtoToTask` test ("falls back to empty strings"), add an assertion next to the existing `createdBy` one:

```ts
    expect(task.createdBy).toBeNull();
    expect(task.createdByName).toBe("");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/lib/api/mappers.test.ts`
Expected: FAIL — first test's `toEqual` reports missing `createdByName`; second test fails because `task.createdByName` is `undefined`, not `""`.

- [ ] **Step 3: Add the field to the domain type**

In `src/types/task.ts`, inside the `Task` interface, add after `createdAt: string | null;`:

```ts
  createdBy: ID | null;
  createdByName?: string;
  createdAt: string | null;
```

- [ ] **Step 4: Populate it in the mapper**

In `src/lib/api/mappers.ts`, in `dtoToTask`'s returned object, add after `createdBy: dto.created_by_detail?.uid ?? null,`:

```ts
    createdBy: dto.created_by_detail?.uid ?? null,
    createdByName: dto.created_by_detail?.full_name ?? "",
    createdAt: dto.created_at,
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/lib/api/mappers.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types/task.ts src/lib/api/mappers.ts src/__tests__/lib/api/mappers.test.ts
git commit -m "feat(tasks): carry creator display name onto domain Task"
```

---

## Task 2: Date formatters for the creation line

**Files:**
- Modify: `src/utils/date.ts` (add two exports after `fmtFull`)
- Test: `src/__tests__/utils/date.test.ts` (new file)

Formatters compose from `toLocaleDateString`/`toLocaleTimeString` parts so the output is exactly `18 Jul 15:42` (no comma) and `18 Jul`. Tests use a **local** ISO string (no `Z`) so the asserted time is timezone-independent across dev machines and CI.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/utils/date.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fmtCreatedAt, fmtCreatedDate } from "@/utils/date";

// Local (no "Z") input → parsed as local time, so the rendered time is
// deterministic regardless of the runner's timezone.
const LOCAL = "2026-07-18T15:42:00";

describe("fmtCreatedAt", () => {
  it("formats day, short month, and 24h time with no year", () => {
    expect(fmtCreatedAt(LOCAL)).toBe("18 Jul 15:42");
  });

  it("returns empty string for null/empty", () => {
    expect(fmtCreatedAt(null)).toBe("");
    expect(fmtCreatedAt("")).toBe("");
    expect(fmtCreatedAt(undefined)).toBe("");
  });
});

describe("fmtCreatedDate", () => {
  it("formats day and short month only", () => {
    expect(fmtCreatedDate(LOCAL)).toBe("18 Jul");
  });

  it("returns empty string for null/empty", () => {
    expect(fmtCreatedDate(null)).toBe("");
    expect(fmtCreatedDate("")).toBe("");
    expect(fmtCreatedDate(undefined)).toBe("");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/utils/date.test.ts`
Expected: FAIL — `fmtCreatedAt`/`fmtCreatedDate` are not exported from `@/utils/date`.

- [ ] **Step 3: Add the formatters**

In `src/utils/date.ts`, add after the `fmtFull` function (around line 87):

```ts
/**
 * Format a creation datetime as "18 Jul 15:42" — day, short month, 24-hour
 * time, no year, no comma. Empty string for null/empty. Rendered in the
 * viewer's local timezone.
 */
export function fmtCreatedAt(d: string | null | undefined): string {
  if (!d) return "";
  const dt = new Date(d);
  const date = dt.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const time = dt.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${date} ${time}`;
}

/**
 * Format a creation datetime as "18 Jul" — day and short month only.
 * Empty string for null/empty. Local timezone.
 */
export function fmtCreatedDate(d: string | null | undefined): string {
  if (!d) return "";
  return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/utils/date.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/date.ts src/__tests__/utils/date.test.ts
git commit -m "feat(tasks): add fmtCreatedAt/fmtCreatedDate formatters"
```

---

## Task 3: Compact creator line on Board cards

**Files:**
- Modify: `src/components/board/TaskCard.tsx` (import at line 5; add block after the `card-footer` div ends at line 222, before the S.No badge)

No render test — `TaskCard` depends on dnd-kit's `useSortable` context and is not unit-rendered anywhere in this codebase. The formatting logic is already covered by Task 2; visual wiring is verified by build + running the app (Task 5).

- [ ] **Step 1: Import the formatter**

In `src/components/board/TaskCard.tsx`, change the date import (line 5) from:

```ts
import { fmtDate } from "@/utils/date";
```

to:

```ts
import { fmtDate, fmtCreatedDate } from "@/utils/date";
```

- [ ] **Step 2: Render the compact line**

In `src/components/board/TaskCard.tsx`, immediately after the closing `</div>` of the `card-footer` block (currently line 222) and before the `{/* S.No badge */}` comment, add:

```tsx
      {task.createdByName && task.createdAt && (
        <div
          style={{
            fontSize: 10,
            color: "var(--txt3)",
            marginTop: 4,
          }}
          title={`Created by ${task.createdByName}`}
        >
          Created by {task.createdByName} · {fmtCreatedDate(task.createdAt)}
        </div>
      )}
```

- [ ] **Step 3: Type-check to verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/board/TaskCard.tsx
git commit -m "feat(tasks): show creator + date on Board cards"
```

---

## Task 4: Full creator line at the top of the Edit Task modal

**Files:**
- Modify: `src/components/board/TaskModal.tsx` (add import; add block after the `modal-head` div at line ~1010)

`task` is `Partial<Task> | null` and `isCreate = !task` (line 399). Show the line only when editing (`!isCreate`) and a creator is present — never on the "Add New Task" form.

- [ ] **Step 1: Import the formatter**

In `src/components/board/TaskModal.tsx`, add an import for the date helper (place it near the other `@/utils` imports at the top of the file):

```ts
import { fmtCreatedAt } from "@/utils/date";
```

- [ ] **Step 2: Render the meta line under the modal header**

In `src/components/board/TaskModal.tsx`, immediately after the `modal-head` block:

```tsx
        <div className="modal-head">
          <span className="modal-title">{headerLabel}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
```

insert:

```tsx
        {!isCreate && task?.createdByName && task?.createdAt && (
          <div
            style={{
              padding: "4px 0 8px",
              fontSize: 12,
              color: "var(--txt3)",
            }}
          >
            Created by <strong>{task.createdByName}</strong> ·{" "}
            {fmtCreatedAt(task.createdAt)}
          </div>
        )}
```

- [ ] **Step 3: Type-check to verify it compiles**

Run: `npx tsc --noEmit -p tsconfig.app.json`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/board/TaskModal.tsx
git commit -m "feat(tasks): show creator + timestamp atop Edit Task modal"
```

---

## Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full frontend test suite**

Run: `npx vitest run`
Expected: PASS (no regressions).

- [ ] **Step 2: Run pre-commit (ruff/format/line-endings/mypy/pyright/eslint/tsc/build)**

From the repo root (`cd ../..`):

Run: `uv run pre-commit run --all-files`
Expected: all hooks pass. (This is the gate CI uses; tests alone miss eslint/tsc/build.)

- [ ] **Step 3: Verify in the running app**

Use the `verify` skill (or `/run`) to launch the frontend, open the Board, and confirm:
- Each task card shows `Created by <name> · <DD Mon>`.
- Opening an existing task (Edit Goal #N) shows `Created by <name> · <DD Mon HH:MM>` under the title.
- The "Add New Task" form shows **no** creation line.
- A legacy task with no creator shows no line (graceful omission).

- [ ] **Step 4: Final commit (if pre-commit reformatted anything)**

```bash
git add -A
git commit -m "chore(tasks): pre-commit fixups for creator display"
```

---

## Self-Review Notes

- **Spec coverage:** domain name mapping (T1), formatters `18 Jul 15:42` / `18 Jul` (T2), card line (T3), modal line + add-form/legacy omission (T4), tests + build + app verify (T1/T2/T5). All spec sections mapped.
- **Deviation from spec:** `createdByName` is `?: string` (optional) rather than required, to avoid breaking ~13 existing `Task` fixtures; the mapper always sets it. Component tests are replaced by pure-function tests + build/app verification because `TaskCard`/`TaskModal` are not unit-rendered in this codebase.
- **Type consistency:** `createdByName` / `createdAt` names match across type, mapper, formatters, and both components. `fmtCreatedAt`/`fmtCreatedDate` signatures identical everywhere.
