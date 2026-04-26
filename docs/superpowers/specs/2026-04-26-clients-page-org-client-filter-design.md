# Clients page — org-aware client filter

**Date:** 2026-04-26
**Branch:** `Client_Filter`
**Status:** Approved

## Problem

On the Clients page, the top-level **Client** dropdown has no effect on what's
displayed in the Road Map sub-tab or the Overdue panel:

- `ClientsPage.tsx` holds `selectedClientUid` and passes it to `ClientRoadmapTab`
  as `clientUid`, but the tab only uses that prop to (a) pre-expand a group and
  (b) pre-fill the "Add roadmap item" modal. The `useClientRoadmap()` hook is
  called with no argument, so all roadmap items the user can see are fetched
  and grouped by client — including clients from orgs the user did not select.
- `OverdueActionPointsPanel` ignores both org and client. It groups every
  overdue action point the user can see.
- The MOM tab is already correctly scoped (it gates rendering on `clientUid`
  and passes it into `useClientMeetings`); no changes needed there.

## Goal

The page should respect the active org selection and the active client
selection. When neither is constrained ("ALL" org + "All clients"), the
existing grouped-overview UX is preserved.

## Behavior matrix

| Org selection | Client selection      | Road Map shows                              | Overdue shows                              |
|---------------|-----------------------|---------------------------------------------|--------------------------------------------|
| ALL           | All clients           | every roadmap item, grouped by client       | every overdue AP, grouped by client        |
| Specific org  | All clients           | items where `org_uid === selectedOrg`       | overdue APs whose meeting is in that org   |
| Any           | Specific client       | items where `client === clientUid`          | overdue APs whose meeting is for that client |

Client wins over org when both are constrained — the client list is already
scoped to the org, so a selected client implies the org.

## Implementation

### `ClientsPage.tsx`

- Relabel the placeholder option from `— Select a client —` to `All clients`
  to make the unfiltered intent explicit.
- Pass `selectedOrg` to both `ClientRoadmapTab` and `OverdueActionPointsPanel`.
- Add a `useEffect` that clears `selectedClientUid` when `selectedOrg` changes
  and the previously selected client is no longer in `scopedClients`.
  Without this, switching org could leave a stale client UID active that
  doesn't appear in the dropdown anymore but still drives the filter.
- Replace the page-header overdue counter (currently `overdue.length`) with a
  filtered count that applies the same org + client predicate, so the badge
  matches what the user sees after clicking through to the Overdue tab.
  The counter logic is shared with the panel — extract a small pure helper:

  ```ts
  function filterOverdue(
    overdue: ClientActionPointDto[],
    meetings: ClientMeetingDto[],
    selectedOrg: string | null,
    selectedClientUid: string,
  ): ClientActionPointDto[]
  ```

  Place it next to `OverdueActionPointsPanel` and import from the page.

### `ClientRoadmapTab.tsx`

- Add `selectedOrg: string | null` to `Props`.
- Extend the existing `filtered` useMemo to apply, **before** the existing
  status/priority/owner/overdueOnly checks:

  ```ts
  if (clientUid) {
    if (r.client !== clientUid) return false;
  } else if (selectedOrg) {
    if (r.org_uid !== selectedOrg) return false;
  }
  ```

- No other changes inside the tab. The existing `expanded` initialiser (which
  pre-expands the selected client's group) continues to work; with a single
  group, the user sees rows immediately.

### `OverdueActionPointsPanel.tsx`

- Add `selectedOrg: string | null` and `selectedClientUid: string` to `Props`.
- Apply `filterOverdue(...)` to `overdue` before the existing `byClient`
  bucketing.
- Empty-state message:
  - Unfiltered (today's behavior): `No overdue action points 🎉`
  - Filtered, no matches: `No overdue action points for the current filter 🎉`

## Out of scope

- The MOM tab — already correctly scoped.
- The Add-roadmap modal — keeps its current "any client" picker. Users
  legitimately add work for other clients in the same org from this view.
- Backend changes — all filtering is pure client-side over data already
  loaded. The `client_uid` query param exists on `/client-roadmap/` but
  switching to it would break the grouped-overview mode (which fetches all
  items at once for grouping).

## Risk & rollback

Low risk. Pure-presentation client-side filter additions, no API or schema
changes. Revert is a single `git revert`.

## Test plan

Manual smoke (UI):

1. ALL org + All clients → see all clients grouped (matches today).
2. Specific org + All clients → see only that org's clients grouped; clients
   from other orgs are absent.
3. Specific org + specific client → see only that client's group, expanded.
4. Switch org while a client is selected → the client dropdown re-scopes; if
   the previously selected client isn't in the new org, the dropdown falls
   back to "All clients" and the page re-renders the full org view.
5. Repeat 1–3 for the Overdue tab; verify the page-header overdue counter
   matches the panel row count.
