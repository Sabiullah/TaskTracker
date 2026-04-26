# MOM — Client selector inside the New / Edit Meeting popup

**Status:** Approved
**Date:** 2026-04-26
**Branch:** `Adding_ClientName_MOM`

## Context

In the **Clients → MOM & Action Points** tab, users frequently work with `ORG = All` and `CLIENT = All clients` selected at the top, which routes to `ClientMOMAllView` (a grouped, collapsible list). Today the only way to add a meeting from that view is to expand the correct client group and click its in-line `+ New meeting` button. The popup itself does not surface the client — it is implicit in which group's button was pressed.

When a user has many clients, finding and expanding the right group before adding a meeting is friction. Users want to see and choose the **Client** directly inside the popup.

## Goal

Add a **Client** field inside `ClientMeetingModal` so the user can choose (and change) which client a MOM belongs to, on both create and edit, without changing the existing entry-point buttons.

## Non-goals

- No new top-level "+ New meeting" button. Per-group buttons stay.
- No backend / DRF serializer changes.
- No typeahead search; the dropdown is a native `<select>`.
- No warning prompt when reassigning a meeting to a different client on edit.

## Affected files

- `frontend/task-tracker/src/components/clients/ClientMeetingModal.tsx` — add Client field, change prop API, own client state.
- `frontend/task-tracker/src/components/clients/ClientMOMAllView.tsx` — pass `defaultClientUid` instead of `clientUid`; resolve `org` from `body.client` inside `onSubmit` for both create and update.
- `frontend/task-tracker/src/components/clients/ClientMOMSingleView.tsx` — same prop rename; same org-resolution change inside `onSubmit`.

No other files change.

## Design

### 1. New "Client" field in the popup

- Position: **first field**, above Date / Time.
- Control: native `<select>` matching the existing `Type` / `Mode` / `Conducted by` styling (`inputStyle`).
- Label: `Client*` — required, same asterisk convention as `Date*`.
- Options: `useMasters().clients`, sorted by name (the hook already returns them alphabetised).
- Placeholder option: `<option value="" disabled>— Select client —</option>` rendered first; selected when no client is set.

### 2. Org-scoped option list

- The modal accepts a new `selectedOrg: string | null` prop.
- When `selectedOrg` is set, options are filtered to clients whose `orgs` array includes `selectedOrg` (or whose legacy `org` matches). When `null`, all clients are listed.
- The `(Unassigned)` sentinel from `momGrouping.ts` is **never** an option — it is a grouping artifact, not a real client.
- If the modal is opened with a `defaultClientUid` (or `existing.client`) that would be filtered out by `selectedOrg`, the default still wins. To avoid React's "value not in options" warning and keep the name visible, the option list always includes the currently-selected client even if it would not pass the org filter — it is appended to the filtered list.

### 3. Modal API change

`ClientMeetingModal` props change from:

```ts
interface Props {
  open: boolean;
  clientUid: string;
  existing: ClientMeetingDto | null;
  profiles: Profile[];
  onClose: () => void;
  onSubmit: (body: ClientMeetingWrite) => Promise<void>;
}
```

to:

```ts
interface Props {
  open: boolean;
  defaultClientUid: string;          // was: clientUid
  selectedOrg: string | null;        // new — for option filtering
  clients: MasterItem[];             // new — option source (passed from parent's useMasters)
  existing: ClientMeetingDto | null;
  profiles: Profile[];
  onClose: () => void;
  onSubmit: (body: ClientMeetingWrite) => Promise<void>;
}
```

The modal owns the selected client in its own `useState<string>`. Initialisation in the existing `useEffect(..., [open, existing])` block:

```
client = existing?.client ?? defaultClientUid ?? ""
```

`onSubmit` is called with `body.client = client` (the modal's own state), not the prop.

### 4. Org handling on save

Currently both views compute `org` at the call-site from the *parent-known* `clientUid` and pass it to `createMeeting`. Once the user can change the client inside the popup, that pre-computed value can be stale.

Change in both `ClientMOMAllView` and `ClientMOMSingleView`: resolve `org` inside the `onSubmit` callback from `body.client`, immediately before calling the API. Apply on both `createMeeting` and `updateMeeting` (since edit is now editable too — see §5).

Pseudo-code (same shape in both views):

```ts
onSubmit={async (body) => {
  const c = clients.find((x) => x.id === body.client);
  const org = c?.org ?? c?.orgs?.[0] ?? undefined;
  if (editing) {
    await updateMeeting(editing.uid, { ...body, org });
  } else {
    const created = await createMeeting({ ...body, org });
    // existing post-create UI updates (expand group / select uid)
  }
}}
```

### 5. Edit-time behaviour

- The Client field is editable on edit (per user choice).
- Changing the client and saving silently reassigns the meeting (and its action points and attachments — they are FK-tied to the meeting row, not the client) to the new client. No confirmation prompt.
- Backend: `client` is already a writable FK on `ClientMeetingWrite`; PATCH accepts it. To verify during implementation.

### 6. Validation

- The Save button stays disabled unless **both** `meetingDate` and `client` are non-empty.
- Form `onSubmit` early-returns when either is missing (mirrors the existing pattern).

### 7. Behaviour by entry point

| Entry point | `defaultClientUid` | Editable in popup? |
|---|---|---|
| All-view per-group `+ New meeting` | The group's `clientUid` | Yes |
| All-view `Edit header` | `existing.client` | Yes |
| Single-view `+ New meeting` | The route's `clientUid` | Yes |
| Single-view `Edit header` | `existing.client` | Yes |

### 8. Post-save UI behaviour

- **All view**: after a successful create, the existing code expands the group keyed by the *originally clicked* `modalClientUid`. Update this to expand the group keyed by `body.client` (the actually-saved client) so the new meeting appears under the correct group when the user changed the client in the popup.
- **Single view**: after a successful create, the existing code calls `setSelectedUid(created.uid)`. If the user changed the client to one different from the route's `clientUid`, the new meeting will not appear in this view's list (the hook is scoped by `clientUid`). This is acceptable — the user explicitly chose a different client.

### 9. What does NOT change

- Per-group `+ New meeting` buttons remain.
- All other modal fields, layout and styling.
- `useClientMeetings` hook signature and behaviour.
- Backend / serializer / API contract.

## Verification

After implementation:

1. From All-view, click a per-group `+ New meeting`. Confirm the Client dropdown is pre-filled with that group's client and is changeable.
2. Change the client to a different one and save. Confirm the new meeting appears under the chosen client's group (which auto-expands).
3. Open `Edit header` on an existing meeting. Change the client. Save. Confirm the meeting moves groups and its action points and attachments are still attached.
4. From Single-view, open `+ New meeting`. Confirm the route's client is pre-filled. Save without change. Meeting appears in the side list.
5. With `ORG = 4D` selected at the top, open the popup. Confirm only 4D clients appear in the dropdown.
6. Try to save with an empty client (using browser dev tools to clear state) — confirm the Save button is disabled.

## Open questions

None — design approved by user.
