# Client Deactivation — Design

**Status:** Approved for implementation
**Date:** 2026-05-14
**Scope:** `Master.type = "client"` rows only (categories and orgs untouched)

## Goal

Let an admin turn a client "inactive" so that:

1. The client disappears from every **new-entry** client picker across the app.
2. Existing rows that already reference the client (tasks, invoices, visits, monthly reports, conveyance entries, kaizens, leads, roadmaps, etc.) are not modified in any way.
3. Filter / search / report dropdowns continue to show the inactive client so historical data remains filterable.
4. Edit dialogs of existing rows continue to show the inactive client (so saving an unrelated change does not wipe the FK).
5. The operation is fully reversible from the Masters > Clients tab.

All clients default to active. Inactive is opt-in, never automatic.

## Non-goals

- Categories tab — out of scope.
- Orgs tab — out of scope.
- Server-side rejection of writes that point at an inactive client. The filter is a UX-hygiene feature; we will not add validation that blocks a `POST /api/tasks/?client=<inactive_uid>` request. (Reason: it would force us to also handle the "client was active when the form opened but deactivated before submit" race, plus mass-update legacy code paths. Out of scope unless requested separately.)
- Bulk deactivation — single-row toggle only.
- A data migration. The field already exists.

## Architecture

### Data layer (backend)

`core.masters.models.Master.is_active = BooleanField(default=True, db_index=True)` already exists.

`MasterSerializer` already lists `is_active` in `Meta.fields` and does not list it in `Meta.read_only_fields`, so:

- `GET /api/masters/` returns `is_active` for every row.
- `PATCH /api/masters/<uid>/` with body `{"is_active": false}` (or `true`) is the toggle call.
- `POST /api/masters/` accepts `is_active` (defaults to `true` server-side if omitted).

The viewset broadcasts an `UPDATE` over the `masters` WebSocket channel on every PATCH, which keeps every connected client's `useMasters` cache in sync without an extra round trip.

**No backend code change required.** Only a verification step in the plan: write a quick test that confirms PATCHing `is_active` round-trips.

### Frontend type / hook layer

**File:** `frontend/task-tracker/src/types/masters.ts`

Add to `MasterItem`:

```ts
export interface MasterItem {
  // ...existing fields...
  /** Active flag. Default true. Inactive clients are hidden from
   *  "new entry" pickers but remain visible in filter dropdowns and
   *  edit-existing modals so historical data stays addressable. */
  is_active: boolean;
}
```

**File:** `frontend/task-tracker/src/hooks/useMasters.ts`

1. In `dtoToMasterItem`, populate `is_active: dto.is_active ?? true` (the `?? true` guards against older DTOs without the field).
2. Add a new exported helper:

```ts
toggleActive: (item: MasterItem) => Promise<MasterItem | null>;
```

`toggleActive` PATCHes `/masters/<uid>/` with `{is_active: !item.is_active}`, applies the resulting DTO through the existing `applyUpsert` path, and returns the updated item. On failure it surfaces `describeApiError` via `alert` (matches the existing convention in `saveItem` / `deleteItem`).

### Masters > Clients UI

**File:** `frontend/task-tracker/src/pages/MastersPage.tsx`

1. **Sort order on the Clients tab:** active first, then inactive. Within each group, alphabetical. Replace the current `sortByName(clients)` call with:
   ```ts
   const sortedClients = useMemo(() => {
     const active = clients.filter(c => c.is_active !== false);
     const inactive = clients.filter(c => c.is_active === false);
     return [...sortByName(active), ...sortByName(inactive)];
   }, [clients]);
   ```
   Use `sortedClients` in the `tab === "clients"` branch of the grid render. Categories / orgs sort logic is unchanged.

2. **Card visual when inactive:**
   - Outer card `background: #f1f5f9` (vs. `#fafafa` for active).
   - Name text color `#94a3b8` (vs. default `#1e293b`).
   - Colored dot wrapped in `opacity: 0.4`.
   - All other content (OrgBadges, edit, del buttons) unchanged.

3. **Toggle button:** new button placed **before** the existing `Edit` button on every client card (only when `tab === "clients"`).
   - When `is_active !== false`: green pill, label `Active`, `background: #d1fae5`, `color: #065f46`. Title attribute: `"Active — click to deactivate"`.
   - When `is_active === false`: grey pill, label `Inactive`, `background: #e5e7eb`, `color: #4b5563`. Title attribute: `"Inactive — click to reactivate"`.
   - `onClick`:
     - If currently active: `window.confirm("Deactivate '<name>'? Existing entries are kept untouched. The client will no longer appear in new-entry dropdowns.")`. Proceed only on OK.
     - If currently inactive: no confirm, just call `toggleActive(item)`.
   - After success, surface `showToast("✅ <name> deactivated")` or `"✅ <name> reactivated"`.

4. **Categories and Orgs tabs**: render unchanged. Do not show the toggle on category or org cards (gated by `tab === "clients"`).

### Apply hiding in "Add-new" client pickers

Pattern for every modal that handles **both add and edit** through a single state object (most of them — `modal.item == null` means add):

```ts
const clientOptions = useMemo(
  () => clients.filter(c =>
    // Edit existing row: include the currently-bound client even if inactive,
    // so the dropdown doesn't blank out on save.
    modal.item ? true : c.is_active !== false
  ),
  [clients, modal.item]
);
```

For pickers that are **always add-new** (no edit mode through that picker), just:

```ts
const clientOptions = useMemo(
  () => clients.filter(c => c.is_active !== false),
  [clients]
);
```

For modals that can edit a row whose **current** client is inactive while still wanting to *change* it to another active one, the implementation MUST keep the currently-bound client in the option list even when filtering. The simplest formulation:

```ts
const clientOptions = useMemo(() => {
  const boundUid = editingRow?.client_uid ?? null;
  return clients.filter(c => c.is_active !== false || c.id === boundUid);
}, [clients, editingRow?.client_uid]);
```

Render the inactive-but-bound option with a `(inactive)` suffix in its label so the user understands why no new row would let them pick it.

### Components to update (the "Add-new" bucket)

Each item below needs `useMemo`-filtered `clients` feeding the client `<select>` / autocomplete:

| File | Picker context | Filter rule |
|---|---|---|
| `src/components/board/TaskModal.tsx` | Add task | Add-only filter (modal mode = add) → hide inactives. Edit mode → show all but tag bound inactive with `(inactive)`. |
| `src/components/worklog/PlanAddModal.tsx` | Add work-plan row | Always add-new → hide inactives. |
| `src/components/invoice/InvoicesTab.tsx` | New invoice form | Hide inactives on create; show all on edit. |
| `src/components/conveyance/ConveyanceFormDialog.tsx` | Add/edit conveyance | Hide inactives when `modal.item == null`. |
| `src/components/kaizen/EditRow.tsx` | New kaizen row | Add-only → hide inactives. (Existing rows keep their client even if inactive — Edit mode preserves.) |
| `src/components/clients/VisitSubmitModal.tsx` | Submit new visit | Hide inactives. |
| `src/components/clients/MonthlyReportModal.tsx` | New monthly report | Hide inactives. |
| `src/components/clients/ClientRoadmapModal.tsx` | New roadmap row | Hide inactives. |
| `src/pages/NoticePage.tsx` | New notice form (typeahead datalist sourced from `clientMasters`) | Filter `clientMasters` to `is_active !== false` when building the datalist for the *new* notice form. The existing `clientUidByName` lookup map is built from the same array, so derive it from the filtered list too. Filter dropdown above the table is untouched. |
| `src/pages/LeadsPage.tsx` | Free-text `client` input | **No change** — the lead form's `client` field is a free-text input, not a dropdown sourced from Masters. Confirmed in current source. |
| `src/components/clients/momClientOptions.ts` | Helper for MOM (Minutes-of-Meeting) Client dropdown | Add a third parameter `excludeInactive: boolean` (default `false` to preserve current call sites). When `true`, the `matchesOrg` filter is composed with `c.is_active !== false`, except the pinned `clientUid` row is always retained even if inactive. MOM **modal in Add mode** passes `true`; MOM **filter view** passes `false`. |

### Components NOT to filter (Filter / Edit / Display bucket)

These keep showing inactive clients. The implementation pass MUST NOT add an `is_active` filter to these:

- `src/pages/MastersPage.tsx` — Clients tab itself (we're showing all by design).
- `src/components/layout/Header.tsx` — global client filter (if any).
- `src/pages/ClientsPage.tsx` — Clients dashboard filter row.
- `src/pages/InvoicePage.tsx` — Invoice filter row + summary tabs.
- `src/pages/ConveyancePage.tsx` — Conveyance filter row.
- `src/pages/KaizenPage.tsx` — Kaizen filter row.
- `src/pages/PaceClientClassPage.tsx` — Pace dashboard filter.
- `src/pages/WorkLogPage.tsx` and `src/components/worklog/WorkLogDashboard.tsx` — Worklog filter row.
- `src/components/clients/ClientInternalReportTab.tsx` — Internal Report client filter.
- `src/components/clients/ClientMonthlyReportTab.tsx` — Monthly report tab filter.
- `src/components/clients/ClientRoadmapTab.tsx` — Roadmap tab filter.
- `src/components/clients/ClientMOMSingleView.tsx` / `ClientMOMAllView.tsx` — MOM views (read-mostly).
- `src/components/dashboard/TaskDrillModal.tsx` — drilldown is read-only.
- `src/components/invoice/SummaryTab.tsx` — read-only summary.

### Visual treatment of "currently bound but inactive" option

In any select element that has to include an inactive client because it's the row's currently-bound value, render the option label as:

```
<Client name> (inactive)
```

A small `(inactive)` suffix in `#94a3b8` italic. This applies to both edit modals and filter dropdowns where the user might wonder why an option is there.

## Data flow

```
+----------------+    PATCH {is_active: false}    +-------------------+
| MastersPage    | -----------------------------> | /api/masters/<u>/ |
| Clients tab    |                                +---------+---------+
| toggle click   |                                          |
+-------+--------+                                          | WS broadcast
        ^                                                   | UPDATE
        |                                                   v
        |                                          +-------------------+
        | applyUpsert                              | masters WS channel|
        |                                          +---------+---------+
        |                                                    |
        |                                                    v
        |  setClients([...new state])              +-------------------+
        +------------------------------------------+ useMasters hook   |
                                                   | (every page)      |
                                                   +-------------------+
                                                            |
                                                            v
                                          Every add-form's clientOptions
                                          recomputes → inactive vanishes.
```

## Error handling

- PATCH failure (network / 403 / 500): `describeApiError` → `alert(...)`. State stays at the pre-toggle value (no optimistic flip we'd need to revert because the toggle is a single call that resolves before the next render).
- Race: two admins toggle the same client in opposite directions. Last write wins. The WS broadcast carries the final state, so both UIs converge.
- Confirm dialog dismissed: no API call.

## Testing

Adding to the implementation plan as separate test items:

1. **Backend (Django test)** — PATCH `/api/masters/<uid>/` with `{"is_active": false}` and then `{"is_active": true}` round-trips and the DB row reflects the change.
2. **Frontend unit (`__tests__/hooks/useMasters.test.ts`)** — `toggleActive(item)` issues the right PATCH, applies the response, and propagates an `is_active` flip into `clients` state.
3. **Frontend integration (`__tests__/pages/MastersPage.test.tsx`)** — Clicking the Active pill on a client opens the confirm; OK → toggle pill becomes Inactive, card visual changes. Clicking Inactive pill on an inactive client toggles back without confirm.
4. **Frontend integration (`__tests__/components/board/taskModal.test.tsx`)** — Open TaskModal in **Add** mode: inactive clients are absent from the client select. Open TaskModal in **Edit** mode on a task whose client is now inactive: that client is present in the select with `(inactive)` suffix.
5. **Frontend integration (one filter dropdown)** — `ClientInternalReportTab.test.tsx` (or whatever the canonical filter test is) — inactive clients still appear in the filter list.

## Migration / rollout

- No DB migration.
- No feature flag — inactive defaults to `false` on every existing row already.
- Zero data backfill.
- The PATCH endpoint already exists; no API versioning concern.
- Deploy backend (no-op) and frontend in the usual single commit; no ordering requirement.

## Out-of-scope follow-ups (not part of this work)

- Same mechanism for `type = "category"` (mains and subs).
- Server-side guard against creating a new row that points at an inactive client.
- Bulk deactivate UI (multi-select on Masters > Clients).
- Audit log entry on toggle (currently the broadcast fires but no `MasterAuditEvent` is recorded; we don't have such a model today).
