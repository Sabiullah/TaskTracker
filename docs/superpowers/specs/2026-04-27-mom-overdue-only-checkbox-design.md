# MOM Overdue-Only checkbox (replaces Overdue sub-tab)

## Goal

On the **Clients** page, replace the dedicated "⚠ Overdue" sub-tab with an
"Overdue only" checkbox inside the **MOM & Action Points** tab — mirroring the
existing pattern on the **Road Map** tab.

## Motivation

The Road Map tab already exposes overdue filtering as an inline checkbox
alongside Status / Priority / Owner / Target Month filters. Users have asked
for the same shape on the MOM & Action Points tab so overdue triage stays in
one tab instead of bouncing between two. The dedicated Overdue sub-tab has a
duplicate-feeling "⚠ N overdue action points" pill in the page header anyway,
so removing the tab simplifies the surface without losing any capability.

## Scope

In:

- Remove the `overdue` sub-tab button from the Clients page tab bar.
- Add an "Overdue only" checkbox to the MOM & Action Points filter bar (both
  single-client view and all-clients view).
- Make the page-header overdue pill a plain shortcut to the MOM tab; it does
  NOT auto-toggle the checkbox (per user decision).
- Filter visible action points (and parent meetings, when no AP matches) by
  membership in the canonical overdue AP set returned by
  `/client-action-points/overdue/`.

Out:

- Backend changes. The overdue endpoint already exists and is the source of
  truth for both the header counter and the new checkbox.
- Deleting `OverdueActionPointsPanel.tsx`. It is unrendered after this change
  but stays on disk; a follow-up cleanup task can remove it once confirmed
  dead.
- Deep-linking from the page-header pill into the MOM tab with the checkbox
  pre-checked. User explicitly chose option B (manual toggle).

## Design

### State ownership

`overdueOnly` is a local state within `ClientMOMSingleView` and
`ClientMOMAllView`. The two views never coexist (the `ClientMOMTab` shell
picks one based on whether a client is selected), so there is no need to lift
state up to `ClientMOMTab` or `ClientsPage`.

### Filter integration

`actionPointFilter.ts` is the existing module both views share. We extend it:

```ts
export interface ActionPointFilters {
  status: string[];
  priority: string[];
  owner: string[];
  targetMonth: string;
  overdueUids?: Set<string>;   // when set, AP must be a member
}
```

- `isFilterActive(f)` returns true when `f.overdueUids` is set.
- `actionPointMatches(ap, f)` rejects APs not in `f.overdueUids` when present.

The set is built once per render in each view from the
`useOverdueActionPoints()` result:

```ts
const overdueUids = useMemo(
  () => new Set(overdue.map((ap) => ap.uid)),
  [overdue],
);
const filters = useMemo(
  () => ({
    status, priority, owner, targetMonth,
    overdueUids: overdueOnly ? overdueUids : undefined,
  }),
  [status, priority, owner, targetMonth, overdueOnly, overdueUids],
);
```

Using the canonical overdue list (rather than re-deriving overdue from
`target_date < today && status not in {Completed, Cancelled}` on the
frontend) keeps the checkbox aligned with the page-header counter and any
future backend rule changes.

### UI

Filter-bar row, after the AP TARGET MONTH input, identical styling to the
Road Map tab's checkbox:

```tsx
<label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6, paddingBottom: 6 }}>
  <input
    type="checkbox"
    checked={overdueOnly}
    onChange={(e) => setOverdueOnly(e.target.checked)}
  />
  Overdue only
</label>
```

### Page-level changes

`ClientsPage.tsx`:

- `SubTab` type narrows to `"roadmap" | "mom"`.
- Tab bar drops the third entry.
- The "⚠ N overdue action points" header pill's onClick changes from
  `setSubTab("overdue")` to `setSubTab("mom")`.
- `OverdueActionPointsPanel` import and render block are removed. The
  page-level `meetings` and `scopedOverdue` derivations stay (the header
  counter still needs them).

## Files Touched

- `frontend/task-tracker/src/pages/ClientsPage.tsx`
- `frontend/task-tracker/src/components/clients/ClientMOMSingleView.tsx`
- `frontend/task-tracker/src/components/clients/ClientMOMAllView.tsx`
- `frontend/task-tracker/src/components/clients/actionPointFilter.ts`

## Risks / Edge Cases

- **Empty overdue set + checkbox on:** every meeting is hidden. This is the
  desired behavior — matches the Road Map tab where checking "Overdue only"
  with no overdue items hides everything.
- **Overdue AP belongs to a meeting otherwise filtered out by Status etc.:**
  the AND-composition is consistent with the existing filter semantics — a
  filter only narrows. No change to current `actionPointMatches` shape needed
  beyond the new field.
- **WebSocket updates:** `useOverdueActionPoints` already refetches on AP
  mutations, so the checkbox reflects fresh server state automatically.
