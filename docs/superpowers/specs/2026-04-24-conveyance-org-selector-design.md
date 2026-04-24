# Conveyance: Organisation selector in Add/Edit dialog

## Problem

Creating a conveyance entry fails for multi-org users with:

> ``org`` is required (you belong to multiple organisations)

The Django viewset calls `resolve_create_org` (core/org_utils.py:141), which
accepts `org` / `org_id` / `org_uid` in the payload and — when absent — only
auto-picks if the caller belongs to exactly one org. `ConveyanceFormDialog`
never sends one.

## Goal

Add an **Organisation** field to `ConveyanceFormDialog` (create mode) so
multi-org users can explicitly pick which org the entry belongs to.
Ensure the chosen client is actually shared with that org.

## Out of scope

- Changing backend semantics.
- Edit mode: an existing entry's org is immutable — no org field needed.
- Changing the header org picker or other pages.

## UX

### Create mode

- New field **Organisation** rendered above **Client** when
  `profile.orgs.length > 1`.
- Single-org users: field is hidden; the single org is still sent in the
  payload (backend would auto-pick it anyway, but being explicit avoids
  surprises if membership changes mid-session).
- Default value:
  1. `selectedOrg` from the App-level header picker, if set and it's one of
     the user's memberships, else
  2. the user's default/primary org (`pickDefaultOrg`), else
  3. empty (forces a manual pick).
- Validation: org is required; submit disabled until one is picked.
- Options come from `profile.orgs`, showing `org.name`, keyed by `org.uid`.

### Client filtering

- Client options are filtered to `MasterItem.orgs.includes(selectedOrgUid)`.
- Changing the org resets the client selection if the current client isn't
  in the new org's client list.

### Edit mode

- No org field; `entry.org` cannot be changed. All existing behaviour is
  preserved. Client dropdown stays unfiltered (parity with today).

## Data flow

```
App.selectedOrg
      │
      ▼
ConveyancePage ──(selectedOrg)──▶ ConveyanceTransactions ──▶ ConveyanceFormDialog
                                                               │
profile.orgs ─────────────────────────────────────────────────▶│ (for the dropdown)
                                                               │
clientOptions: { uid, label, orgs[] } ────────────────────────▶│ (for filtering)
```

- `App.tsx` already owns `selectedOrg`. We add it to the `ConveyancePage`
  props (matches the Leads/Invoice pattern).
- `ConveyancePage` already calls `useAuth()` → has `profile`. It derives
  an `orgOptions: { uid, name }[]` from `profile.orgs` and passes both
  `orgOptions` and `selectedOrg` down.
- `clientOptions` is changed from `{ uid, label }` to `{ uid, label, orgs }`
  so the dialog can filter locally. No extra fetch.

## Payload

`buildCreateFormData` gains an `org` parameter and appends it as
`form.append("org", orgUid)`. Backend accepts `org` / `org_id` / `org_uid`;
uid is what we already have client-side.

## Component changes

| File | Change |
|---|---|
| `src/App.tsx` | Pass `selectedOrg={selectedOrg}` to `<ConveyancePage>` |
| `src/pages/ConveyancePage.tsx` | Add `selectedOrg` prop; derive `orgOptions` from `profile.orgs`; extend `clientOptions` with `orgs`; pass both down |
| `src/components/conveyance/ConveyanceTransactions.tsx` | Accept + pass through `orgOptions`, `selectedOrg`, and new `clientOptions` shape |
| `src/components/conveyance/ConveyanceFormDialog.tsx` | New `org` state; render Organisation `<select>` when `orgOptions.length > 1` in create mode; filter clients by org; reset client when org changes; include `org` in validation + submit |
| `src/components/conveyance/conveyanceFormHelpers.ts` | `validateFormInputs` requires `org`; `buildCreateFormData` appends `org` |
| `src/__tests__/components/conveyanceFormDialog.test.ts` | Tests for the helpers' new `org` requirement |

The existing `ConveyanceFilters` client dropdown doesn't need filtering
(it's a filter, not a create action) — leave it alone.

## Error handling

- If `orgOptions.length === 0` in create mode (shouldn't happen — user must
  have at least one membership to see the Conveyance tab — but be defensive):
  hide the Add Entry button path is out of scope; the existing backend
  error surface ("User is not a member of any organisation") remains
  adequate.
- If the user picks an org with zero clients, the client dropdown shows
  only "— select client —" and submit stays disabled on the existing
  "Client is required" validation. No new error copy needed.

## Testing

- Unit: `validateFormInputs` rejects missing `org`.
- Unit: `buildCreateFormData` appends `org` when provided.
- Manual (this is the primary verification, matching how this UI was
  shipped originally): with a multi-org user, verify
  - Field appears, defaults correctly.
  - Client list narrows on org change; stale client is cleared.
  - Submitting creates the entry in the selected org.
  - Single-org users see no new field and create still works.
