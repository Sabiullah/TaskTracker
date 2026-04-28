# Leads Tab Expiry Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a red notification pill to the **Leads** tab in the top NavMenu showing the count of open leads whose `next_step_date` is past due — mirroring the existing Clients badge.

**Architecture:** Pure helper (`computeLeadsBadgeCount`) → React hook (`useLeadsBadgeCount`) → wired through `App.tsx` → `Header` → `NavMenu` → existing `SortableTab` (no change). Lead list comes from the existing `useLeads()` (already role-filtered server-side and live via WebSocket). Definition of "expired" matches the existing `stats.overdueFollowups` tile on the Leads page exactly.

**Tech Stack:** React 19, TypeScript, Vitest, existing `isOverdue()` helper.

**Spec:** `docs/superpowers/specs/2026-04-28-leads-tab-expiry-badge-design.md`

**Working directory for all commands:** `frontend/task-tracker/`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/components/leads/leadsBadgeCount.ts` | NEW | Pure `computeLeadsBadgeCount(leads): number` |
| `src/__tests__/components/leads/leadsBadgeCount.test.ts` | NEW | Vitest cases for the pure function |
| `src/hooks/useLeadsBadgeCount.ts` | NEW | React hook wrapping `useLeads()` + the pure function |
| `src/components/header/NavMenu.tsx` | MODIFY | Add `leadsBadgeCount` prop, extend badge selector |
| `src/components/layout/Header.tsx` | MODIFY | Add `leadsBadgeCount` prop, forward to `NavMenu` |
| `src/App.tsx` | MODIFY | Call hook, pass count to `Header` |

---

## Task 1: Pure compute function + tests (TDD)

**Files:**
- Create: `frontend/task-tracker/src/components/leads/leadsBadgeCount.ts`
- Create: `frontend/task-tracker/src/__tests__/components/leads/leadsBadgeCount.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/task-tracker/src/__tests__/components/leads/leadsBadgeCount.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeLeadsBadgeCount } from "@/components/leads/leadsBadgeCount";
import type { Lead } from "@/types";

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    serialNo: 1,
    client: "Acme",
    contact_person: null,
    contact_email: null,
    contact_phone: null,
    lead_source: null,
    reference_from: null,
    status: "Cold",
    priority: "Medium",
    assigned_to: null,
    estimated_value: null,
    action_taken: null,
    next_step: null,
    next_step_date: "2000-01-01", // far past → always overdue
    remarks: null,
    created_by: null,
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

describe("computeLeadsBadgeCount", () => {
  it("counts an overdue Open lead", () => {
    expect(computeLeadsBadgeCount([lead()])).toBe(1);
  });

  it("excludes overdue Confirmed leads", () => {
    expect(computeLeadsBadgeCount([lead({ status: "Confirmed" })])).toBe(0);
  });

  it("excludes overdue Cancelled leads", () => {
    expect(computeLeadsBadgeCount([lead({ status: "Cancelled" })])).toBe(0);
  });

  it("excludes future-dated leads", () => {
    expect(
      computeLeadsBadgeCount([lead({ next_step_date: "2999-12-31" })]),
    ).toBe(0);
  });

  it("excludes leads with no next_step_date", () => {
    expect(computeLeadsBadgeCount([lead({ next_step_date: null })])).toBe(0);
  });

  it("status comparison is case-insensitive", () => {
    expect(computeLeadsBadgeCount([lead({ status: "confirmed" })])).toBe(0);
    expect(computeLeadsBadgeCount([lead({ status: "CANCELLED" })])).toBe(0);
  });

  it("sums multiple matching leads", () => {
    const leads = [
      lead({ id: "a" }),
      lead({ id: "b", status: "Hot" }),
      lead({ id: "c", status: "Confirmed" }), // excluded
      lead({ id: "d", next_step_date: "2999-12-31" }), // excluded
    ];
    expect(computeLeadsBadgeCount(leads)).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix frontend/task-tracker test -- src/__tests__/components/leads/leadsBadgeCount.test.ts`
Expected: FAIL with "Cannot find module '@/components/leads/leadsBadgeCount'" or similar resolution error.

- [ ] **Step 3: Implement the pure function**

Create `frontend/task-tracker/src/components/leads/leadsBadgeCount.ts`:

```ts
import type { Lead } from "@/types";
import { isOverdue } from "@/utils/leads";

/**
 * Count of "open" leads whose next_step_date is past due.
 *
 * "Open" means status is neither Confirmed nor Cancelled (case-insensitive),
 * matching the Open / Confirmed / Cancelled tab split on the Leads page.
 *
 * Mirrors the `stats.overdueFollowups` calculation in `LeadsPage.tsx` so the
 * NavMenu pill number equals the "Overdue" stat tile on the Leads page (when
 * no in-page filters are active).
 */
export function computeLeadsBadgeCount(leads: readonly Lead[]): number {
  let n = 0;
  for (const l of leads) {
    if (!isOverdue(l.next_step_date)) continue;
    const s = (l.status || "").toLowerCase();
    if (s === "confirmed" || s === "cancelled") continue;
    n += 1;
  }
  return n;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix frontend/task-tracker test -- src/__tests__/components/leads/leadsBadgeCount.test.ts`
Expected: PASS, 7 tests passing.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/components/leads/leadsBadgeCount.ts frontend/task-tracker/src/__tests__/components/leads/leadsBadgeCount.test.ts
git commit -m "feat(leads): add computeLeadsBadgeCount pure helper

Counts overdue leads with status not in {Confirmed, Cancelled}.
Mirrors the existing stats.overdueFollowups calculation on LeadsPage."
```

---

## Task 2: React hook

**Files:**
- Create: `frontend/task-tracker/src/hooks/useLeadsBadgeCount.ts`

- [ ] **Step 1: Implement the hook**

Create `frontend/task-tracker/src/hooks/useLeadsBadgeCount.ts`:

```ts
import { useMemo } from "react";
import { useLeads } from "@/hooks/useLeads";
import { computeLeadsBadgeCount } from "@/components/leads/leadsBadgeCount";

/**
 * Live count of overdue Open leads — used as the red pill on the NavMenu
 * "Leads" tab. Returns 0 while the initial fetch is in flight to avoid a
 * flash of stale-data on first render.
 */
export function useLeadsBadgeCount(): number {
  const { leads, loading } = useLeads();
  return useMemo(
    () => (loading ? 0 : computeLeadsBadgeCount(leads)),
    [leads, loading],
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npm --prefix frontend/task-tracker run build`
Expected: PASS (no TS errors).

> If the build fails because of unrelated existing errors, run `npx --prefix frontend/task-tracker tsc --noEmit -p frontend/task-tracker/tsconfig.app.json 2>&1 | grep useLeadsBadgeCount` to confirm the new file specifically is clean, then proceed — don't fix unrelated breakage in this plan.

- [ ] **Step 3: Commit**

```bash
git add frontend/task-tracker/src/hooks/useLeadsBadgeCount.ts
git commit -m "feat(leads): add useLeadsBadgeCount hook

Wraps useLeads() + computeLeadsBadgeCount; returns 0 while loading."
```

---

## Task 3: Plumb the count through NavMenu

**Files:**
- Modify: `frontend/task-tracker/src/components/header/NavMenu.tsx:19-30, 32-43, 126-134`

- [ ] **Step 1: Add the prop to `NavMenuProps`**

Edit `NavMenu.tsx`. Find the existing prop:

```tsx
  clientsBadgeCount?: number;
}
```

Add `leadsBadgeCount` immediately above it so the props remain alphabetised in the way the file already does them (the codebase isn't strict — keep them adjacent for grep-ability):

```tsx
  clientsBadgeCount?: number;
  leadsBadgeCount?: number;
}
```

- [ ] **Step 2: Destructure the new prop**

In the same file, find the destructuring block:

```tsx
  clientsBadgeCount,
}: NavMenuProps) {
```

Add `leadsBadgeCount` after `clientsBadgeCount`:

```tsx
  clientsBadgeCount,
  leadsBadgeCount,
}: NavMenuProps) {
```

- [ ] **Step 3: Extend the badge selector**

In the same file, find the `<SortableTab>` line (~line 132):

```tsx
              badge={tab.id === "clients" ? clientsBadgeCount : undefined}
```

Replace with:

```tsx
              badge={
                tab.id === "clients"
                  ? clientsBadgeCount
                  : tab.id === "leads"
                    ? leadsBadgeCount
                    : undefined
              }
```

- [ ] **Step 4: Type-check**

Run: `npm --prefix frontend/task-tracker run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/components/header/NavMenu.tsx
git commit -m "feat(nav): accept leadsBadgeCount prop and render it on Leads tab"
```

---

## Task 4: Forward the prop through Header

**Files:**
- Modify: `frontend/task-tracker/src/components/layout/Header.tsx:54, 83, 678`

- [ ] **Step 1: Add the prop to `HeaderProps`**

Edit `Header.tsx`. Find:

```tsx
  clientsBadgeCount?: number;
```

Add the new prop directly after it:

```tsx
  clientsBadgeCount?: number;
  leadsBadgeCount?: number;
```

- [ ] **Step 2: Destructure it in the function signature**

Find:

```tsx
  clientsBadgeCount,
```

(in the destructuring block of the `Header` component, near the `selectedOrg` line). Add:

```tsx
  clientsBadgeCount,
  leadsBadgeCount,
```

- [ ] **Step 3: Forward it into `<NavMenu>`**

Find the `<NavMenu ...>` render block (around line 668). After the `clientsBadgeCount={clientsBadgeCount}` line, add:

```tsx
        clientsBadgeCount={clientsBadgeCount}
        leadsBadgeCount={leadsBadgeCount}
```

- [ ] **Step 4: Type-check**

Run: `npm --prefix frontend/task-tracker run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/components/layout/Header.tsx
git commit -m "feat(header): forward leadsBadgeCount prop to NavMenu"
```

---

## Task 5: Wire the hook in App.tsx

**Files:**
- Modify: `frontend/task-tracker/src/App.tsx` (top imports, ~line 116, ~line 427)

- [ ] **Step 1: Import the hook**

Edit `App.tsx`. Find the existing import for `useClientsBadgeCounts` (search the file for `useClientsBadgeCounts`). Directly below it, add:

```tsx
import { useLeadsBadgeCount } from "@/hooks/useLeadsBadgeCount";
```

(If `useClientsBadgeCounts` is imported alongside other hooks in a single block, place the new import near it for readability.)

- [ ] **Step 2: Call the hook**

Find the existing block at ~line 116:

```tsx
  const clientsBadge = useClientsBadgeCounts({
    myUid: profile?.id ?? null,
    isAdminFor,
    selectedOrg: selectedOrg || null,
    clientUid: null,
  });
```

Add directly below it:

```tsx
  const leadsBadge = useLeadsBadgeCount();
```

- [ ] **Step 3: Pass the prop into `<Header>`**

Find (~line 427):

```tsx
        clientsBadgeCount={clientsBadge.total}
```

Add directly below:

```tsx
        clientsBadgeCount={clientsBadge.total}
        leadsBadgeCount={leadsBadge}
```

- [ ] **Step 4: Type-check**

Run: `npm --prefix frontend/task-tracker run build`
Expected: PASS.

- [ ] **Step 5: Run the full test suite**

Run: `npm --prefix frontend/task-tracker test`
Expected: PASS — `leadsBadgeCount` tests pass, no regressions in unrelated tests.

- [ ] **Step 6: Commit**

```bash
git add frontend/task-tracker/src/App.tsx
git commit -m "feat(app): wire useLeadsBadgeCount into Header

Adds the live overdue-follow-ups pill on the Leads tab of the top
NavMenu. Number matches the existing 'Overdue' stat tile on the
Leads page when no in-page filters are active."
```

---

## Task 6: Manual smoke test in the browser

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server**

Run: `npm --prefix frontend/task-tracker run dev`
Expected: Vite reports a local URL (e.g. `http://localhost:5173`).

- [ ] **Step 2: Sign in and visit the app**

Open the URL in a browser. The Leads tab in the top NavMenu should show a red pill with a number when at least one Open lead has `next_step_date < today`.

- [ ] **Step 3: Cross-check against the Overdue stat tile**

Click the Leads tab. The number on the pill should equal the number on the "Overdue" stat tile in the page header (so long as no in-page filters are active and you're not in a multi-org account viewing a single org — see spec note on org scope).

- [ ] **Step 4: Verify live updates**

Edit one of the overdue leads and either:
- push `next_step_date` into the future, or
- change status to **Confirmed** or **Cancelled**.

After saving, the pill should decrement by one without a page refresh (driven by the existing leads WebSocket subscription).

- [ ] **Step 5: Verify the pill hides at zero**

If you don't have any overdue Open leads available, mark all of them future-dated or Confirmed/Cancelled — the pill should disappear entirely (no `0` shown), confirming the existing `SortableTab` `showBadge = badge > 0` rule still holds.

- [ ] **Step 6: Push the branch**

```bash
git push
```

(The branch already tracks `origin/Leads_Notification` from the spec commit, so a plain `git push` is enough.)

---

## Self-Review Notes

**Spec coverage:** All five acceptance criteria in the spec are covered — Task 1 covers the counting rule, Task 2 wraps it in a hook backed by the live `useLeads()` subscription, Tasks 3–5 expose the count on the NavMenu, Task 6 manually verifies the visible behaviour and live update.

**No placeholders:** Every step has the actual code or exact command. No "implement later" or "add error handling" hand-waves.

**Type consistency:** `computeLeadsBadgeCount(readonly Lead[])` is used identically in the hook (`useLeads()` returns `Lead[]`, which is assignable to `readonly Lead[]`). The new `leadsBadgeCount?: number` prop name is consistent in `NavMenu`, `Header`, and `App.tsx`.
