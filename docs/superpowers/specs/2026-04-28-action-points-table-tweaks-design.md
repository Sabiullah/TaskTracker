# Action Points table tweaks — design

**Date:** 2026-04-28
**Branch:** `LinkedRoadmap_Removal`
**Scope file:** `frontend/task-tracker/src/components/clients/ClientActionPointsTable.tsx`

## Summary

Three UI changes to the Action Points table inside the Clients → MOM view:

1. Remove the **Linked roadmap** column from the table.
2. Add an inline **expand toggle** on the **Description** cell so long descriptions can be read and edited as multi-line text.
3. **Color each row by status** for at-a-glance scanning, with overdue Open items getting a stronger red tint.

All changes are confined to the `ClientActionPointsTable` component. No backend, API, type, or migration changes.

## Motivation

- The Linked-roadmap column is no longer used (it shows `—` for all rows). Removing it reduces visual noise and recovers horizontal space.
- The Description field is currently a single-line `<input>`, so long action-point text gets visually clipped, hurting both readability and editing.
- Without status-based row tinting, users have to read the Status column on every row to triage what is open, in progress, done, or overdue.

## Out of scope

- Removing `roadmap_link` from the backend model, serializer, migration, DTO, write type, or any other consumer.
- Removing the `roadmapItems` prop from the parent components (`ClientMOMSingleView`, `ClientMOMAllView`).
- Any coloring rules for statuses other than `Open`, `In Progress`, `Completed`, `Cancelled`.

## Design

### 1. Remove the "Linked roadmap" column

In `ClientActionPointsTable.tsx`:

- Drop the `<th>Linked roadmap</th>` header.
- Drop the corresponding `<td>` in:
  - the editable `Row` (both the read-only branch and the `canWrite` branch with the `<select>`),
  - the new-action-point draft row (the `<select>` populated from `roadmapItems`).
- Stop reading or writing `roadmap_link` in the draft state and `local` state.
- Remove unused imports (`ClientRoadmapDto`) if no other code path in the file uses them after the deletion.
- Keep the `roadmapItems` **prop** on the component for now. Rename the parameter to `_roadmapItems` and add a one-line comment noting the prop is intentionally retained because the two callers still pass it; removing the prop is deferred. (No changes to `ClientMOMSingleView` / `ClientMOMAllView`.)
- Update the colspan helper from `colCount = 9 + (canWrite ? 1 : 0)` to `colCount = 8 + (canWrite ? 1 : 0)`.

### 2. Description expand toggle

Add a per-row inline expand toggle for the Description cell.

**State:**
- New component-level state `expandedDesc: Set<string>` (set of action-point UIDs), parallel to the existing `expandedAttachments` set.
- New `toggleDesc(uid)` helper following the same pattern as `toggleAttachments`.

**UI (inside the Description `<td>` of the `Row` component):**
- Render a small `⤢` button beside the description input/text. The button is always present (read and write modes), styled as a quiet 1×1ch icon button.
- When the row's uid is **in** `expandedDesc`:
  - **Write mode (`canWrite`):** render a `<textarea rows={4}>` instead of the `<input>`, bound to the same `local.description` state so unsaved edits survive a collapse.
  - **Read mode:** render the description text inside a `<div>` with `white-space: pre-wrap; word-break: break-word`.
- When **not** in `expandedDesc`: current single-line `<input>` (write mode) or single-line text (read mode).
- The toggle does not auto-collapse on save. The user collapses it explicitly.

**The new-action-point draft row** keeps the simple single-line input — no expand toggle there. Long descriptions can be expanded after the row is added.

### 3. Status-based row coloring

Add a `rowBackground(ap)` helper inside the file (or inline in `Row`):

```ts
function rowBackground(ap: ClientActionPointDto, today: string): string {
  switch (ap.status) {
    case "Cancelled":   return "#f1f5f9";
    case "Completed":   return "#dcfce7";
    case "In Progress": return "#dbeafe";
    case "Open":
      if (ap.target_date && ap.target_date < today) return "#fecaca"; // overdue
      return "#fef3c7";
  }
}
```

- `today` is computed once per render of `ClientActionPointsTable` as `new Date().toISOString().slice(0, 10)` and passed into `Row` as a prop. `Row` calls `rowBackground(ap, today)` to compute its own `<tr>` background.
- `target_date` is already stored as a `YYYY-MM-DD` string on `ClientActionPointDto`, so a string comparison gives the correct lexicographic-and-chronological result.
- Apply via inline `style.background` on the `Row`'s `<tr>`. The existing `borderBottom: "1px solid #e2e8f0"` is preserved.
- For `Cancelled`, additionally set `color: "#64748b"` on the `<tr>` so the muted text reinforces the visual signal.
- The editable `<input>` and `<select>` controls already have `background: transparent`, so they pick up the row tint automatically — `cellInput` needs no changes.
- The attachments-expand row (the second `<tr>` shown when files are open) keeps its existing `#f8fafc` background so it stays visually distinct from the parent row.
- The new-AP draft row keeps its existing `#fafafa` background — coloring only applies to existing rows that have a status.

## Data flow

No new props on the component. No new API calls. No changes to types or DTOs. No backend work.

## Testing

- **Manual checks** (the verification path):
  - Linked-roadmap column is gone from the header and all rows, including the new-AP draft row.
  - Description expand toggle:
    - Read mode: clicking ⤢ wraps the full text; clicking again collapses.
    - Write mode: clicking ⤢ swaps to a 4-row textarea; typing is preserved when collapsed and re-expanded; Save still works.
  - Row colors match the palette for each of the four statuses; changing Status updates the color immediately on save.
  - An Open row whose Target date is before today is rendered in the stronger red, not amber.
  - Cancelled rows show muted text.
- **Automated tests:** none required. The existing test files (`actionPointFilter.test.ts`, `momClientOptions.test.ts`, `clientsBadgeCounts.test.ts`) do not touch the table component.

## Risks and rollback

- Risk: the `roadmapItems` prop becomes effectively unused. Mitigation: leave the prop in place and rename the parameter to `_roadmapItems` with a one-line comment so a future cleanup is obvious.
- Risk: row tint reduces text contrast for users on certain monitors. Mitigation: chosen palette uses pastel tints (Tailwind `*-100` / `*-200` range) that the rest of the app already uses for similar signals.
- Rollback: revert the single-file change.
