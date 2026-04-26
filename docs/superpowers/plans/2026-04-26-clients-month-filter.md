# Clients Month Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a month-year filter to the Clients → Road Map and Clients → MOM tabs so users can see what is deliverable in any chosen calendar month, based on `target_date`.

**Architecture:** Pure client-side filter. A small shared helper (`monthFilter.ts`) returns whether a given ISO date string falls inside a `"YYYY-MM"` month, with empty filter and null dates both treated as visible. Three components consume it: `ClientRoadmapTab`, `ClientMOMAllView`, and `ClientMOMSingleView`. Each owns its own `targetMonth` state — no cross-tab sync. The MOM views additionally filter the in-meeting action point list down to those matching the month so users see exactly the deliverables to plan around.

**Tech Stack:** React 19, TypeScript, Vite, Vitest. UI control is the native `<input type="month">`.

**Spec:** [docs/superpowers/specs/2026-04-26-clients-month-filter-design.md](../specs/2026-04-26-clients-month-filter-design.md)

---

## File Structure

| File | Purpose | Action |
|------|---------|--------|
| `frontend/task-tracker/src/components/clients/monthFilter.ts` | Shared `matchesMonth(dateStr, month)` helper | **Create** |
| `frontend/task-tracker/src/__tests__/components/clients/monthFilter.test.ts` | Vitest unit tests for the helper | **Create** |
| `frontend/task-tracker/src/components/clients/ClientRoadmapTab.tsx` | Add month picker + filter call inside `filtered` `useMemo` | **Modify** |
| `frontend/task-tracker/src/components/clients/ClientMOMAllView.tsx` | Add month picker, compute `visibleActionPoints`, filter meeting list, update `# AP` cell | **Modify** |
| `frontend/task-tracker/src/components/clients/ClientMOMSingleView.tsx` | Same as above for the single-client 2-column layout | **Modify** |

---

## Task 1: Shared `matchesMonth` helper (TDD)

**Files:**
- Create: `frontend/task-tracker/src/components/clients/monthFilter.ts`
- Test: `frontend/task-tracker/src/__tests__/components/clients/monthFilter.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/task-tracker/src/__tests__/components/clients/monthFilter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { matchesMonth } from "@/components/clients/monthFilter";

describe("matchesMonth", () => {
  it("returns true when month filter is empty (no filter active)", () => {
    expect(matchesMonth("2026-04-15", "")).toBe(true);
    expect(matchesMonth(null, "")).toBe(true);
  });

  it("returns true when dateStr is null regardless of month", () => {
    expect(matchesMonth(null, "2026-04")).toBe(true);
  });

  it("returns true when dateStr falls in the selected month", () => {
    expect(matchesMonth("2026-04-01", "2026-04")).toBe(true);
    expect(matchesMonth("2026-04-30", "2026-04")).toBe(true);
  });

  it("returns false when dateStr is in a different month", () => {
    expect(matchesMonth("2026-03-31", "2026-04")).toBe(false);
    expect(matchesMonth("2026-05-01", "2026-04")).toBe(false);
  });

  it("respects year boundaries", () => {
    expect(matchesMonth("2026-12-31", "2026-12")).toBe(true);
    expect(matchesMonth("2027-01-01", "2026-12")).toBe(false);
    expect(matchesMonth("2025-12-31", "2026-01")).toBe(false);
  });

  it("returns false when dateStr is in a different year but same month number", () => {
    expect(matchesMonth("2025-04-15", "2026-04")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd D:/TaskTracker/frontend/task-tracker && npx vitest --run src/__tests__/components/clients/monthFilter.test.ts`
Expected: FAIL — module `@/components/clients/monthFilter` cannot be resolved.

- [ ] **Step 3: Create the helper**

Create `frontend/task-tracker/src/components/clients/monthFilter.ts`:

```ts
/**
 * True when the given ISO-date string falls in the selected `YYYY-MM` month.
 *
 * Empty filter (`month === ""`) and null dates both return true so unplanned
 * items remain visible regardless of the active month.
 */
export function matchesMonth(dateStr: string | null, month: string): boolean {
  if (month === "") return true;
  if (dateStr === null) return true;
  return dateStr.startsWith(month);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd D:/TaskTracker/frontend/task-tracker && npx vitest --run src/__tests__/components/clients/monthFilter.test.ts`
Expected: PASS — all 6 cases.

- [ ] **Step 5: Commit**

```bash
git -C D:/TaskTracker add frontend/task-tracker/src/components/clients/monthFilter.ts frontend/task-tracker/src/__tests__/components/clients/monthFilter.test.ts
git -C D:/TaskTracker commit -m "feat(clients): add matchesMonth helper for month-based filtering"
```

---

## Task 2: Roadmap tab — month filter

**Files:**
- Modify: `frontend/task-tracker/src/components/clients/ClientRoadmapTab.tsx`

- [ ] **Step 1: Import the helper**

In `ClientRoadmapTab.tsx`, add the import alongside the existing imports near the top:

```ts
import { matchesMonth } from "./monthFilter";
```

- [ ] **Step 2: Add state for the selected month**

Inside the `ClientRoadmapTab` component, alongside the existing `useState` calls (e.g. near `const [overdueOnly, setOverdueOnly] = useState(false);`), add:

```ts
const [targetMonth, setTargetMonth] = useState<string>("");
```

- [ ] **Step 3: Apply the filter inside the `filtered` `useMemo`**

In `ClientRoadmapTab.tsx` around lines 156-172, the existing `filtered` `useMemo` looks like:

```tsx
const filtered = useMemo(() => {
  return items.filter((r) => {
    // …existing scope + status + priority + owner + overdueOnly checks…
    if (overdueOnly && derived !== "Overdue") return false;
    return true;
  });
}, [items, clientUid, selectedOrg, statusFilter, priorityFilter, ownerFilter, overdueOnly]);
```

Add a `matchesMonth` check before the final `return true;`, and add `targetMonth` to the dependency array:

```tsx
const filtered = useMemo(() => {
  return items.filter((r) => {
    // …existing checks unchanged…
    if (overdueOnly && derived !== "Overdue") return false;
    if (!matchesMonth(r.target_date, targetMonth)) return false;
    return true;
  });
}, [items, clientUid, selectedOrg, statusFilter, priorityFilter, ownerFilter, overdueOnly, targetMonth]);
```

- [ ] **Step 4: Add the month picker to the filter row**

In the JSX filter row (the `<div>` block starting near line 227 with `display: "flex"`, `alignItems: "flex-end"`), insert this block immediately **after** the Owner `<MultiSelect>` and **before** the "Overdue only" `<label>`:

```tsx
<label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 600, color: "#475569" }}>
  TARGET MONTH
  <input
    type="month"
    value={targetMonth}
    onChange={(e) => setTargetMonth(e.target.value)}
    style={filterStyle}
  />
</label>
```

(`filterStyle` is the existing local style constant defined later in the same file — no new style needed.)

- [ ] **Step 5: Type-check + lint**

Run:

```bash
cd D:/TaskTracker/frontend/task-tracker && npx tsc -b && npx eslint src/components/clients/ClientRoadmapTab.tsx
```

Expected: no errors.

- [ ] **Step 6: Run all tests**

Run: `cd D:/TaskTracker/frontend/task-tracker && npm test`
Expected: PASS (existing tests still green, new `matchesMonth` tests still green).

- [ ] **Step 7: Manual verification**

Start the dev server: `cd D:/TaskTracker/frontend/task-tracker && npm run dev`. Open the Clients tab, switch to Road Map, and confirm:

1. The "TARGET MONTH" picker appears between "Owner" and "Overdue only".
2. With the picker empty, all items show as before.
3. Pick the current month (e.g. April 2026) — only items with `target_date` in April 2026 plus items with no `target_date` remain. Per-client counts shrink accordingly.
4. Switch to a future month with no items — only items with no `target_date` remain (they are not hidden).
5. Clear the picker — everything returns.

- [ ] **Step 8: Commit**

```bash
git -C D:/TaskTracker add frontend/task-tracker/src/components/clients/ClientRoadmapTab.tsx
git -C D:/TaskTracker commit -m "feat(clients): add target month filter to Road Map tab"
```

---

## Task 3: MOM All view — month filter

**Files:**
- Modify: `frontend/task-tracker/src/components/clients/ClientMOMAllView.tsx`

- [ ] **Step 1: Import the helper**

In `ClientMOMAllView.tsx`, add to the imports near the top:

```ts
import { matchesMonth } from "./monthFilter";
```

- [ ] **Step 2: Add state for the selected month**

Inside `ClientMOMAllView`, alongside the existing `useState` calls (near `const [modalClientUid, setModalClientUid] = useState<string>("");`), add:

```ts
const [targetMonth, setTargetMonth] = useState<string>("");
```

- [ ] **Step 3: Compute filtered groups**

Below the existing `groups` `useMemo` (around line 46), add:

```tsx
const filteredGroups = useMemo(() => {
  if (targetMonth === "") return groups;
  return groups
    .map((g) => ({
      ...g,
      meetings: g.meetings.filter((m) =>
        m.action_points.some((ap) => matchesMonth(ap.target_date, targetMonth)),
      ),
    }))
    .filter((g) => g.meetings.length > 0);
}, [groups, targetMonth]);
```

Then replace the single use of `groups.map((g) => …)` in the JSX (around line 90) with `filteredGroups.map((g) => …)`. Also replace the early-return `if (groups.length === 0)` check (around line 84) with `if (filteredGroups.length === 0)`.

- [ ] **Step 4: Add the month picker above the groups list**

Immediately inside the outer `return ( <div> …` (around line 88), and before the first `{filteredGroups.map(...)}` block, insert:

```tsx
<div style={{ display: "flex", alignItems: "flex-end", gap: 10, marginBottom: 10 }}>
  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 600, color: "#475569" }}>
    AP TARGET MONTH
    <input
      type="month"
      value={targetMonth}
      onChange={(e) => setTargetMonth(e.target.value)}
      style={{ padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13 }}
    />
  </label>
</div>
```

- [ ] **Step 5: Filter the action points passed to the table**

Inside the meeting-row rendering loop (around lines 173-281), wherever `m.action_points` is referenced, derive a filtered list once at the top of the inner block. Add this immediately after `const meetingOpen = expandedMeetings.has(m.uid);` (around line 174):

```tsx
const visibleAPs =
  targetMonth === ""
    ? m.action_points
    : m.action_points.filter((ap) => matchesMonth(ap.target_date, targetMonth));
```

Then change the `# AP` cell (around line 193):

```tsx
<td style={tdStyle}>
  {targetMonth === ""
    ? m.action_points.length
    : `${visibleAPs.length} of ${m.action_points.length}`}
</td>
```

And change the `actionPoints={m.action_points}` prop on `<ClientActionPointsTable>` (around line 267) to:

```tsx
actionPoints={visibleAPs}
```

- [ ] **Step 6: Update the per-client meeting badge to reflect filtering**

The badge near line 130 currently reads:

```tsx
<span style={{ color: "#64748b", fontWeight: 400 }}>
  ({g.meetings.length} meeting{g.meetings.length === 1 ? "" : "s"})
</span>
```

Because `g` now comes from `filteredGroups`, `g.meetings.length` already reflects the filtered count — no further change needed. (Confirm during manual verification.)

- [ ] **Step 7: Type-check + lint**

Run:

```bash
cd D:/TaskTracker/frontend/task-tracker && npx tsc -b && npx eslint src/components/clients/ClientMOMAllView.tsx
```

Expected: no errors.

- [ ] **Step 8: Run all tests**

Run: `cd D:/TaskTracker/frontend/task-tracker && npm test`
Expected: PASS (no test changes; existing groupMeetingsByClient tests still green).

- [ ] **Step 9: Manual verification**

In the dev server, open Clients → MOM (with no client selected so the All view renders) and confirm:

1. "AP TARGET MONTH" picker appears above the client groups.
2. With the picker empty, the view matches the previous behavior.
3. Pick a month with known APs — only meetings whose action points include at least one in that month remain. Per-client meeting badges shrink to the filtered count.
4. Expand a remaining meeting — the action point table shows only APs in the selected month. The `# AP` column shows `X of Y`.
5. Pick a month with no matching APs anywhere — the empty state ("No meetings yet.") appears.
6. Clear the picker — everything returns.

- [ ] **Step 10: Commit**

```bash
git -C D:/TaskTracker add frontend/task-tracker/src/components/clients/ClientMOMAllView.tsx
git -C D:/TaskTracker commit -m "feat(clients): add AP target month filter to MOM All view"
```

---

## Task 4: MOM Single view — month filter

**Files:**
- Modify: `frontend/task-tracker/src/components/clients/ClientMOMSingleView.tsx`

- [ ] **Step 1: Import the helper and `useMemo`**

In `ClientMOMSingleView.tsx`, the existing first line is:

```ts
import { useState } from "react";
```

Replace it with:

```ts
import { useMemo, useState } from "react";
```

Then add the helper import alongside the other `./` imports:

```ts
import { matchesMonth } from "./monthFilter";
```

- [ ] **Step 2: Add state for the selected month**

Inside `ClientMOMSingleView`, alongside the existing `useState` calls (near `const [selectedUid, setSelectedUid] = useState<string>("");`), add:

```ts
const [targetMonth, setTargetMonth] = useState<string>("");
```

- [ ] **Step 3: Derive `filteredMeetings` and `visibleAPs`**

Just below the existing `useState` calls and above the wrapper functions (`safeAddActionPoint`, etc.), add:

```ts
const filteredMeetings = useMemo(() => {
  if (targetMonth === "") return meetings;
  return meetings.filter((m) =>
    m.action_points.some((ap) => matchesMonth(ap.target_date, targetMonth)),
  );
}, [meetings, targetMonth]);
```

- [ ] **Step 4: Use `filteredMeetings` for selection + list rendering**

Around line 92 the existing code does:

```tsx
const selected = meetings.find((m) => m.uid === selectedUid) ?? meetings[0];
```

Replace with:

```tsx
const selected =
  filteredMeetings.find((m) => m.uid === selectedUid) ?? filteredMeetings[0];
```

Around line 110, the meeting list iterates `meetings.map((m) => …)` and the empty state uses `meetings.length === 0`. Replace both with `filteredMeetings`:

```tsx
{filteredMeetings.length === 0 && <li style={{ color: "#64748b" }}>No meetings yet.</li>}
{filteredMeetings.map((m) => {
  // …unchanged…
})}
```

- [ ] **Step 5: Compute visible action points for the selected meeting**

Just below the `selected` declaration, add:

```ts
const visibleAPs =
  selected
    ? targetMonth === ""
      ? selected.action_points
      : selected.action_points.filter((ap) => matchesMonth(ap.target_date, targetMonth))
    : [];
```

Then change the `<ClientActionPointsTable actionPoints={selected.action_points} … />` prop (around line 207) to:

```tsx
actionPoints={visibleAPs}
```

- [ ] **Step 6: Add the month picker above the two-column grid**

The current return wraps content in `<div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 12 }}>`. Wrap that grid in a fragment with the picker on top:

```tsx
return (
  <div>
    <div style={{ display: "flex", alignItems: "flex-end", gap: 10, marginBottom: 10 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 600, color: "#475569" }}>
        AP TARGET MONTH
        <input
          type="month"
          value={targetMonth}
          onChange={(e) => setTargetMonth(e.target.value)}
          style={{ padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13 }}
        />
      </label>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 12 }}>
      {/* …existing grid contents unchanged… */}
    </div>
  </div>
);
```

- [ ] **Step 7: Type-check + lint**

Run:

```bash
cd D:/TaskTracker/frontend/task-tracker && npx tsc -b && npx eslint src/components/clients/ClientMOMSingleView.tsx
```

Expected: no errors.

- [ ] **Step 8: Run all tests**

Run: `cd D:/TaskTracker/frontend/task-tracker && npm test`
Expected: PASS.

- [ ] **Step 9: Manual verification**

In the dev server, pick a specific client from the Clients page selector (so MOM Single view renders), then:

1. "AP TARGET MONTH" picker appears above the two-column layout.
2. With the picker empty, behavior matches before — full meeting list, full AP table.
3. Pick a month with at least one matching AP — only meetings with matching APs appear in the left list. Right-side AP table shows only matching APs.
4. Pick a month where the previously-selected meeting no longer matches — selection falls back to the first remaining meeting.
5. Pick a month with no matching APs at all — left list shows "No meetings yet." and the right pane shows "No meeting selected."
6. Clear the picker — everything returns.

- [ ] **Step 10: Commit**

```bash
git -C D:/TaskTracker add frontend/task-tracker/src/components/clients/ClientMOMSingleView.tsx
git -C D:/TaskTracker commit -m "feat(clients): add AP target month filter to MOM Single view"
```

---

## Task 5: Final cross-cutting verification

- [ ] **Step 1: Full test + type + lint pass**

Run:

```bash
cd D:/TaskTracker/frontend/task-tracker && npm test && npx tsc -b && npx eslint src
```

Expected: all green.

- [ ] **Step 2: CSV export sanity check**

In the running dev server, on the Road Map tab:

1. Apply a `TARGET MONTH` filter that hides some rows.
2. Click "Export CSV".
3. Open the CSV and confirm only the visible (filtered) rows appear — no extra "out-of-month" rows leak through.

(The export reads from `filtered`, so this should work automatically; this step is the end-to-end confirmation.)

- [ ] **Step 3: Cross-tab independence check**

In the running dev server:

1. On Road Map, set TARGET MONTH = April 2026.
2. Switch to MOM (without changing Client). Confirm the AP TARGET MONTH picker is **empty** — independent state per spec.
3. Set AP TARGET MONTH = May 2026 on MOM.
4. Switch back to Road Map. Confirm TARGET MONTH still reads April 2026.

- [ ] **Step 4: Push the branch**

The current branch is `Client_MonthFilter` (a focused single-feature branch). Push so the user can review on GitHub:

```bash
git -C D:/TaskTracker push -u origin Client_MonthFilter
```

(Per the user's auto-push preference for feature-branch work; do not push to `main`.)
