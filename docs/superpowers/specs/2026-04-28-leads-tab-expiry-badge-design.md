# Leads Tab Expiry Badge — Design

**Date:** 2026-04-28
**Branch:** `Leads_Notification`
**Status:** Approved (pending spec review)

## Goal

Surface a live count of overdue follow-ups on the **Leads** tab in the top NavMenu — a red pill identical in style to the existing Clients badge — so users see at a glance how many leads need attention without opening the page.

## Counting rule

A lead is **counted** when **all** of the following are true:

1. `lead.next_step_date` is set (non-null, non-empty).
2. `lead.next_step_date < today` (uses the existing `isOverdue()` helper at `frontend/task-tracker/src/utils/leads.ts:70`).
3. `lead.status` (case-insensitive) is **not** `"Confirmed"` and **not** `"Cancelled"` — i.e. the lead falls in the Open tab.

This matches exactly the `stats.overdueFollowups` calculation already in `LeadsPage.tsx:193-198`, so the badge number equals the "Overdue" stat tile on the Leads page (no surprises for the user).

The badge is hidden when the count is 0 — handled by the existing `SortableTab` rendering (`showBadge = badge > 0`).

## Scope

- The lead list comes from `useLeads()`, which the Django backend already filters by role (admin → org-wide, manager → managed members, employee → self).
- The `Lead` domain type does **not** carry `org_uid`, so the badge cannot be re-scoped client-side by the header `selectedOrg`. The badge counts every lead the server returned. This matches the current Leads page, which also doesn't filter the list by header org client-side. If org-scoping becomes a requirement later, `LeadDto` needs to expose `org_uid` first.
- The badge does **not** apply UI filters (Search/Status/Priority/Assigned-To/Source/Month) from the Leads page — those are page-local, while the badge is global.

## Architecture

Mirrors the Clients badge structure (`useClientsBadgeCounts` + `clientsBadgeCounts.computeBadgeCounts`) so future contributors see one consistent pattern.

```
useLeads()  ──►  useLeadsBadgeCount()  ──►  number
                       │
                       └─ computeLeadsBadgeCount(leads)   (pure)
```

### New files

**`frontend/task-tracker/src/components/leads/leadsBadgeCount.ts`**

```ts
import type { Lead } from "@/types";
import { isOverdue } from "@/utils/leads";

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

**`frontend/task-tracker/src/hooks/useLeadsBadgeCount.ts`**

```ts
import { useMemo } from "react";
import { useLeads } from "@/hooks/useLeads";
import { computeLeadsBadgeCount } from "@/components/leads/leadsBadgeCount";

export function useLeadsBadgeCount(): number {
  const { leads, loading } = useLeads();
  return useMemo(
    () => (loading ? 0 : computeLeadsBadgeCount(leads)),
    [leads, loading],
  );
}
```

**`frontend/task-tracker/src/__tests__/components/leads/leadsBadgeCount.test.ts`**

Vitest cases:
1. Overdue Open lead is counted.
2. Overdue Confirmed lead is excluded.
3. Overdue Cancelled lead is excluded.
4. Future-dated and `null`-dated leads are excluded.
5. Status comparison is case-insensitive (e.g. `"confirmed"` lowercase still excluded).

### Modified files

**`frontend/task-tracker/src/App.tsx`**

Next to the existing `clientsBadge` block (line 116):

```ts
const leadsBadge = useLeadsBadgeCount();
```

In the `<Header>` JSX (around line 427):

```tsx
clientsBadgeCount={clientsBadge.total}
leadsBadgeCount={leadsBadge}
```

**`frontend/task-tracker/src/components/layout/Header.tsx`**

- Add `leadsBadgeCount?: number` to `HeaderProps` next to `clientsBadgeCount`.
- Destructure it in the function signature.
- Forward it into `<NavMenu leadsBadgeCount={leadsBadgeCount} />`.

**`frontend/task-tracker/src/components/header/NavMenu.tsx`**

- Add `leadsBadgeCount?: number` to `NavMenuProps` next to `clientsBadgeCount`.
- Destructure it.
- Update the badge selector at line 132:

```tsx
badge={
  tab.id === "clients"
    ? clientsBadgeCount
    : tab.id === "leads"
      ? leadsBadgeCount
      : undefined
}
```

### Untouched

- `SortableTab` already renders any numeric `badge` prop — no change.
- `useLeads()` already subscribes to the leads WebSocket channel, so the badge updates live as leads are created/edited/deleted.

## Tradeoff noted

`NavMenu` now has two parallel `*BadgeCount` props. If a third tab ever needs a badge, refactor to `tabBadges?: Record<string, number>` to avoid the special-case ladder. Two props is fine for now — kept consistent with the existing style to keep this diff small.

## Out of scope

- Org-scoped counting (needs backend/DTO change to expose `org_uid` on leads).
- Per-tab badges on the in-page **Open / Confirmed / Cancelled** sub-tabs (the request was the parent NavMenu badge only).
- Including leads with `next_step_date == null` (decision A in brainstorming).
- Including leads `next_step_date == today` (decision A in brainstorming — strict past-due only).

## Acceptance

- Visiting the app with at least one Open lead whose `next_step_date < today` shows a red pill on the **Leads** tab with that count.
- The pill number equals the "Overdue" stat tile on the Leads page when no UI filters are applied.
- The pill disappears once the count drops to 0.
- Editing a lead to push `next_step_date` into the future, or moving it to Confirmed/Cancelled, decrements the badge live (via WebSocket).
- Tests in `leadsBadgeCount.test.ts` pass.
