# MOM & Action Points — All-clients grouped view

**Date:** 2026-04-26
**Branch:** `MOM_AllClient`

## Problem

On the Clients page → **MOM & Action Points** sub-tab, selecting **All clients** in the
client picker currently renders the placeholder *"Select a client to view meetings."*
The user wants to see every client's meetings at once, grouped by client in
collapsible sections — the same interaction pattern already used on the **Road Map**
sub-tab.

## Goal

When the page-level client selector is `""` (All clients), `ClientMOMTab` should
render an expandable list of clients; each client expands to show its meetings.
When a specific client is selected, the existing left-list / right-pane layout
is preserved unchanged.

## Non-goals

- No backend / API changes. `/client-meetings/` already returns all meetings the
  caller is authorised to see, with `org_uid` and `client_detail.name` populated.
- No new filter bar (date / type / mode). The Road Map tab is the visual model
  only for grouping and collapse. Filters can be added later if needed.
- No deep-linking from the Overdue tab into a specific meeting (already noted
  as a future TODO in the existing code).

## Design

### Component structure

`ClientMOMTab.tsx` becomes a thin router:

- `clientUid !== ""` → render `ClientMOMSingleView`
  (today's UI, extracted verbatim into its own component)
- `clientUid === ""` → render new `ClientMOMAllView`

Splitting avoids one large component and lets each view evolve independently.

### `ClientMOMSingleView` (extracted)

Identical behaviour to the current body of `ClientMOMTab`. The extraction is
mechanical — same hooks, same `safe*` wrappers, same modal wiring. No
behavioural changes.

### `ClientMOMAllView` (new)

**Props**

```ts
interface Props {
  selectedOrg: string | null;
  profile: Profile | null;
  profiles: Profile[];
  canWrite: boolean;
}
```

**Data**

- `useClientMeetings()` — no client filter; already returns all visible meetings
  with nested action points + attachments and the websocket-driven live updates.
- `useClientRoadmap()` — needed for the action-points table's roadmap-link
  picker (same as `ClientMOMSingleView`).
- `useMasters()` — `clients` list, used to resolve `clientOrgUid` when creating
  a new meeting under a specific client group.

**Filtering**

Mirror `ClientRoadmapTab` org scoping client-side:

```ts
meetings.filter(m => !selectedOrg || m.org_uid === selectedOrg)
```

**Grouping**

```ts
group by m.client            // string | null
label  by m.client_detail?.name ?? "(Unassigned)"
sort   alphabetic by name; "(Unassigned)" pushed to bottom
```

This matches `ClientRoadmapTab.groups` exactly.

**Rendering — outer collapse (per client)**

Identical visual treatment to Road Map:

- Full-width button header: `▾`/`▸` + client name + `(N meeting/s)` muted count
- 1px border, rounded, light blue when open / off-white when closed
- All groups **collapsed by default**

**Rendering — inner table (when a group is open)**

Compact meetings table:

| Date | Type | Mode | Conducted by | Next meeting | # AP | Actions |
|------|------|------|--------------|--------------|------|---------|

- Sorted by `meeting_date` descending (most recent first)
- Each row has a leading chevron `▸`/`▾` and is clickable to toggle inline
  expansion below the row
- A `+ New meeting` button lives in the group's header strip (next to the
  count) — `canWrite` only, opens `ClientMeetingModal` with `clientUid` =
  this group

**Inline-expanded meeting detail**

When a meeting row is open, a single-row `<tr>` spanning all columns renders
the same block as today's right-pane:

- Header: `meeting_date · meeting_type · mode` + Edit / Delete buttons
- Two-column grid of Venue / Conducted by / Our attendees / Client attendees /
  Next meeting
- Agenda, Minutes (preserved whitespace)
- `ClientMeetingAttachments` (reused as-is)
- `ClientActionPointsTable` (reused as-is)

Multiple meeting rows in different groups (and within the same group) can be
expanded simultaneously. State lives in `ClientMOMAllView`, not the row.

**State**

```ts
expandedClients:  Set<string>             // client uids whose group is open
expandedMeetings: Set<string>             // meeting uids whose detail is open
modalOpen:        boolean
editing:          ClientMeetingDto | null
modalClientUid:   string                  // pre-fill for the modal's client picker
```

The modal's `clientUid` is derived from the `+ New meeting` button context
(when creating) or from the meeting being edited (when editing). It's stored
on state so the same modal instance is reused for both flows.

**CRUD wiring**

All mutations go through the existing hook returned by `useClientMeetings()`,
so the `safeAdd`, `safeUpdate`, `safeDelete`, `safeUpload` wrappers and their
`reportApiError` calls move into `ClientMOMAllView` unchanged. Websocket
events keep the grouped view live without extra work.

The `org` field for `createMeeting` is resolved per-group (just like Single
view does today: `selectedClient?.org ?? selectedClient?.orgs?.[0]`).

### Page-level wiring

`ClientsPage.tsx` already has `selectedOrg`. Thread it through:

```tsx
<ClientMOMTab
  clientUid={effectiveClientUid}
  selectedOrg={selectedOrg}              // new prop
  profile={profile}
  profiles={profiles}
  canWrite={canWrite}
/>
```

`ClientMOMTab.tsx` gains the prop, forwards it only to the All view (Single
view doesn't need it — selection is already client-specific).

## Files touched

| File | Change |
|------|--------|
| `frontend/task-tracker/src/pages/ClientsPage.tsx` | Pass `selectedOrg` prop to `<ClientMOMTab>` |
| `frontend/task-tracker/src/components/clients/ClientMOMTab.tsx` | Convert to router; gain `selectedOrg` prop |
| `frontend/task-tracker/src/components/clients/ClientMOMSingleView.tsx` | **NEW** — verbatim extraction of current `ClientMOMTab` body |
| `frontend/task-tracker/src/components/clients/ClientMOMAllView.tsx` | **NEW** — grouped collapsible view |

No backend / hook / type changes.

## Edge cases

- **Empty result set after org filter** — show a `"No meetings yet."` placeholder
  (same wording as today's empty list).
- **Meeting with `client === null`** (orphan) — bucketed into `(Unassigned)`,
  rendered last; `+ New meeting` in that group is disabled (no client to
  attribute the new meeting to).
- **User switches from "All clients" to a specific client while groups/meetings
  are expanded** — state is local to `ClientMOMAllView` and unmounts cleanly;
  no leakage. Returning to "All clients" starts fresh (collapsed) — acceptable
  and consistent with Road Map.
- **Websocket INSERT for a brand-new client** — the new meeting's
  `client_detail.name` arrives with the record, so the new group renders
  immediately on next state update; no extra fetch needed.
- **`canWrite === false`** — no `+ New meeting` button, no Edit/Delete in
  inline detail; rows are still expandable read-only.

## Testing strategy

Manual verification via the Vite dev server:

1. Org = ALL, client = All clients → groups render, all collapsed, alphabetical,
   `(Unassigned)` last.
2. Open a group → meeting table appears, sorted by `meeting_date` desc.
3. Click a row → inline detail appears with action points editable.
4. `+ New meeting` in a group → modal pre-selects that client, save returns to
   the same view, the new meeting row appears at the top of that group.
5. Switch org selector → groups re-filter; clients with no meetings in the
   selected org disappear.
6. Pick a specific client → reverts to today's left-list / right-pane layout
   (regression check on `ClientMOMSingleView` extraction).
7. Read-only role (member) → no write controls visible; rows still expandable.

## Open questions

None.
