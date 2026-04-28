# Clients Notification Badges — Design

**Date:** 2026-04-28
**Branch:** `Overdue_Notification`
**Status:** Approved (pending spec review)

## Goal

Surface unresolved work on the Clients tab as live notification badges:

- A red pill on each Clients sub-tab (Road Map, MOM & Action Points, Internal Report) showing the count of overdue items relevant to the viewer.
- A red pill on the parent "Clients" entry in the top NavMenu showing the combined total across the three sub-tabs.

For employees and managers, counts are scoped to records assigned to them (or pending their action). For admins, counts are org-wide.

## Counting rules

For `me = profile.id`. After applying the active org and (sub-tabs only) client filters to each list:

| Tab | Admin | Employee/Manager |
|---|---|---|
| Road Map | `roadmapItems` where `deriveStatus(r) === "Overdue"` | same, plus `r.owner === me` |
| MOM & Action Points | `overdueAPs.length` | `overdueAPs` filtered by `ap.responsibility === me` |
| Internal Report | visits where `is_overdue` OR `current_status === "Pending"` (deduped by uid) | visits where `(is_overdue && prepared_by === me) OR (current_status === "Pending" && assigned_manager === me)` (deduped by uid) |

`deriveStatus` is the existing helper in `ClientRoadmapTab.tsx` — completion present → Completed, target date past or expected slipped past target → Overdue, etc.

`useOverdueActionPoints` already returns the server-filtered overdue list; no further status check is needed beyond the responsibility filter for non-admins.

Internal Report uses set-based dedup — a single visit that is both overdue and pending counts once.

**Total** (parent nav badge) = `roadmapOverdue + momOverdue + internalCombined`. The three domains are disjoint, so no cross-tab dedup.

## Scope filters

- `selectedOrg` is applied to all three lists. Roadmap and visits expose `org_uid` directly; action points resolve org via `meetings[ap.meeting].org_uid`.
- `clientUid` (in-page selector) is applied for sub-tab badges only. The parent nav badge passes `clientUid=null` so it ignores the in-page selector.
- Roadmap items with `client=null` are excluded when `clientUid` is set.
- Action points whose meeting record isn't yet loaded are excluded (matches existing `filterOverdue` behavior).

## Architecture

A single hook is added at `frontend/task-tracker/src/hooks/useClientsBadgeCounts.ts`:

```ts
useClientsBadgeCounts(args: {
  myUid: string | null;
  isAdmin: boolean;          // isAdminInAny()
  selectedOrg: string | null;
  clientUid: string | null;  // null = ignore in-page filter
}): {
  roadmapOverdue: number;
  momOverdue: number;
  internalCombined: number;
  total: number;
}
```

Internally it mounts the existing data hooks:

- `useClientRoadmap()`
- `useOverdueActionPoints()` + `useClientMeetings()` (the latter is needed to look up org/client for each AP)
- `useClientVisits()`

The pure logic is extracted into a testable function:

```ts
computeBadgeCounts({
  myUid, isAdmin, selectedOrg, clientUid,
  roadmapItems, overdueAPs, meetings, visits
}): { roadmapOverdue, momOverdue, internalCombined, total }
```

`useMemo` recomputes when any input changes. WebSocket-driven refetches in the underlying hooks propagate live.

## Data flow

```
App.tsx
 ├─ useClientsBadgeCounts({ myUid, isAdmin, selectedOrg, clientUid: null })
 │   → counts.total
 ├─ <NavMenu>
 │   └─ <SortableTab tab="clients" badge={counts.total}/>
 └─ <ClientsPage>
      ├─ useClientsBadgeCounts({ myUid, isAdmin, selectedOrg, clientUid: effectiveClientUid })
      └─ Sub-tab buttons render `badge` next to label
```

Both the App-level and ClientsPage-level calls mount the underlying list hooks separately. This is a deliberate trade-off — the duplicate fetch cost is small (three list endpoints, all WS-synced), and we avoid refactoring all sub-tab components into a shared context.

App must gate the App-level call behind `canAccessClients` to avoid 403s for users without Clients access.

## UI

### Parent "Clients" nav tab

- Red pill after the label: `background: #dc2626; color: #fff; padding: 1px 7px; border-radius: 999px; font-size: 11px; font-weight: 700; margin-left: 6px`.
- Hidden entirely when count is 0.
- `SortableTab` accepts a new optional prop `badge?: number`.

### Sub-tab buttons (Clients page)

- Same red pill, `font-size: 10px`. Inline within the existing button after the label.
- Active tab keeps its existing white background; pill remains red.
- Hidden at 0.

### Existing top-right "1 overdue action point" red card

- Out of scope. Stays as the org+client-scoped MOM-only counter, role-agnostic. Revisit separately if needed.

### Accessibility

- Pill carries `aria-label="N overdue or pending items"` (or "N overdue items" for tabs without pending-approval semantics).
- Tab buttons remain focusable/clickable as before.

### Loading

- While any underlying hook is in initial `loading=true`, `useClientsBadgeCounts` returns zeros to suppress flashes of stale counts.

## Edge cases

- **Real-time updates:** WS events on `client-roadmap`, `client-meetings`, `client-action-points`, `client-visits`, `visit-reports` trigger refetches in the underlying hooks. `useMemo` recomputes counts. No manual invalidation.
- **Org switch:** updates `selectedOrg`, both hook calls re-derive. Both badges refresh.
- **Client selector change:** only the sub-tab badges react; nav badge unchanged.
- **No Clients access:** App skips the hook call. NavMenu doesn't render the Clients tab.
- **Profile not loaded:** hook returns zeros while `myUid` is null.
- **Self-managed visit:** dedup via uid Set means a visit counted both as overdue and pending counts once.
- **Tab order persistence:** unaffected. `loadTabOrder`/`saveTabOrder` key by tab id only.

## Testing

### Unit tests

`src/hooks/useClientsBadgeCounts.test.ts` exercising the pure `computeBadgeCounts`:

1. Admin in single org — counts everything in scope.
2. Employee — only their owner/responsibility/prepared_by rows.
3. Manager with `assigned_manager === me` — pending visits count toward Internal even if not prepared by them.
4. Visit that is both `is_overdue` and `Pending` for the same user → counted once.
5. `clientUid=null` ignores client filter; `clientUid` set scopes correctly.
6. Roadmap item with `client=null` excluded when `clientUid` is set.
7. Action point whose meeting isn't loaded → excluded.
8. Empty inputs → zeros.

### Component tests

- `ClientsPage.test.tsx` — render with mocked counts hook; assert sub-tab buttons display badge text when non-zero, omit when zero.
- `SortableTab.test.tsx` — `badge` prop renders pill at > 0, hides at 0, correct aria-label.

### Manual verification (Playwright MCP)

1. Log in as employee → open Clients → confirm sub-tab badges only count owned rows.
2. Log in as admin → confirm badges show org-wide totals.
3. Change org switcher → both nav and sub-tab badges update.
4. Change in-page client selector → sub-tab badges narrow; nav badge unchanged.
5. Mark an overdue item completed in another browser → counts decrement live via WS.

## Out of scope

- Changing the existing "1 overdue action point" header card.
- Adding pending-approval semantics to Road Map or MOM (no approval workflow exists there today).
- Server-side aggregate endpoint for badge counts.
- Cross-tab dedup (the three domains are disjoint).
