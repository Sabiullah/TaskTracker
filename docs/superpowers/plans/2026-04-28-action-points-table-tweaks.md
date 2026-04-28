# Action Points table tweaks — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Linked roadmap column from the Action Points table, add an inline expand toggle for the Description cell, and tint each row by status (with overdue Open in stronger red).

**Architecture:** UI-only edit to a single React component (`ClientActionPointsTable.tsx`). No prop changes that ripple to callers, no backend changes, no type changes, no new tests. The `roadmap_link` field stays on the DTO and write type; only the UI rendering of it is removed.

**Tech Stack:** React 19, TypeScript, Vite, Vitest. Component lives at `frontend/task-tracker/src/components/clients/ClientActionPointsTable.tsx`.

**Spec:** [`docs/superpowers/specs/2026-04-28-action-points-table-tweaks-design.md`](../specs/2026-04-28-action-points-table-tweaks-design.md)

---

## File map

- **Modify:** `frontend/task-tracker/src/components/clients/ClientActionPointsTable.tsx` — only file changed in this plan.
- **Unchanged (intentional):**
  - `frontend/task-tracker/src/components/clients/ClientMOMSingleView.tsx` — keeps passing `roadmapItems`; the prop stays on the table for now.
  - `frontend/task-tracker/src/components/clients/ClientMOMAllView.tsx` — same.
  - `frontend/task-tracker/src/types/api/clients.ts` — `roadmap_link` stays on `ClientActionPointDto` / `ClientActionPointWrite`.
  - Backend (`core/masters/`) — out of scope.

---

## Task 1: Remove the Linked roadmap column

**Files:**
- Modify: `frontend/task-tracker/src/components/clients/ClientActionPointsTable.tsx`

- [ ] **Step 1: Drop the `<th>Linked roadmap</th>` header**

In `ClientActionPointsTable`'s `<thead>`, delete the `<th>` between Priority and Remarks.

Before:
```tsx
<th style={thStyle}>Priority</th>
<th style={thStyle}>Linked roadmap</th>
<th style={thStyle}>Remarks</th>
```

After:
```tsx
<th style={thStyle}>Priority</th>
<th style={thStyle}>Remarks</th>
```

- [ ] **Step 2: Drop the Linked-roadmap `<td>` from the new-AP draft row**

In the `canWrite` `<tr>` block inside `<tbody>`, delete the entire `<td>` that wraps the `<select>` populated from `roadmapItems` (between the Priority `<td>` and the Remarks `<td>`).

Before:
```tsx
<td style={tdStyle}>
  <select
    value={draft.priority ?? "Medium"}
    /* ... */
  >
    {PRIORITIES.map(/* ... */)}
  </select>
</td>
<td style={tdStyle}>
  <select
    value={draft.roadmap_link ?? ""}
    onChange={(e) => setDraft({ ...draft, roadmap_link: e.target.value || null })}
    style={cellInput}
  >
    <option value="">—</option>
    {roadmapItems.map((r) => (
      <option key={r.uid} value={r.uid}>
        {r.title}
      </option>
    ))}
  </select>
</td>
<td style={tdStyle}>
  <input
    value={draft.remarks ?? ""}
    /* ... */
  />
</td>
```

After:
```tsx
<td style={tdStyle}>
  <select
    value={draft.priority ?? "Medium"}
    /* ... */
  >
    {PRIORITIES.map(/* ... */)}
  </select>
</td>
<td style={tdStyle}>
  <input
    value={draft.remarks ?? ""}
    /* ... */
  />
</td>
```

- [ ] **Step 3: Drop the Linked-roadmap `<td>` from the existing `Row`**

In the `Row` component, delete the `<td>` that renders `roadmap_link` (the one between the Priority `<td>` and the Remarks `<td>`). It currently looks like:

```tsx
<td style={tdStyle}>
  {canWrite ? (
    <select
      value={merged.roadmap_link ?? ""}
      onChange={(e) => setLocal({ ...local, roadmap_link: e.target.value || null })}
      style={cellInput}
    >
      <option value="">—</option>
      {roadmapItems.map((r) => (
        <option key={r.uid} value={r.uid}>
          {r.title}
        </option>
      ))}
    </select>
  ) : (
    roadmapItems.find((r) => r.uid === merged.roadmap_link)?.title ?? "—"
  )}
</td>
```

Delete that entire `<td>` block.

- [ ] **Step 4: Stop reading `roadmap_link` in the `merged` object**

In `Row`, replace:
```tsx
const merged: ClientActionPointDto = {
  ...ap,
  ...local,
  roadmap_link: local.roadmap_link ?? ap.roadmap_link,
};
```

with:
```tsx
const merged: ClientActionPointDto = { ...ap, ...local };
```

- [ ] **Step 5: Rename the `roadmapItems` prop bindings to `_roadmapItems` and add a comment**

Two binding sites in the file: the `Props` destructure on `ClientActionPointsTable`, and the parameter list on `Row`.

In `ClientActionPointsTable`'s parameter destructure, change `roadmapItems` to `roadmapItems: _roadmapItems` (or just remove it from the destructure — TypeScript still type-checks the prop because `Props` keeps the field). Use the rename form so the prop stays present in the destructure for grep visibility:

```tsx
export default function ClientActionPointsTable({
  meetingUid,
  actionPoints,
  profiles,
  roadmapItems: _roadmapItems, // kept for caller compatibility; UI no longer renders linked roadmap
  canWrite,
  onAdd,
  onUpdate,
  onDelete,
  onUploadAttachment,
  onDeleteAttachment,
}: Props) {
```

In `Row`'s parameter destructure, do the same:

```tsx
function Row({
  ap,
  profiles,
  roadmapItems: _roadmapItems,
  canWrite,
  attachmentsOpen,
  onToggleAttachments,
  onUpdate,
  onDelete,
}: {
  ap: ClientActionPointDto;
  profiles: Profile[];
  roadmapItems: readonly ClientRoadmapDto[];
  canWrite: boolean;
  attachmentsOpen: boolean;
  onToggleAttachments: () => void;
  onUpdate: (apUid: string, body: Partial<ClientActionPointWrite>) => Promise<void>;
  onDelete: (apUid: string) => Promise<void>;
}) {
```

Leave `ClientRoadmapDto` in the import list since the inline type for `Row`'s props still references it.

- [ ] **Step 6: Update `colCount`**

In `ClientActionPointsTable`, change:
```tsx
const colCount = 9 + (canWrite ? 1 : 0);
```
to:
```tsx
const colCount = 8 + (canWrite ? 1 : 0);
```

Header cell count after the deletion: Description, Responsibility, Target, Completion, Status, Priority, Remarks, Files = 8, plus 1 for the Actions column when `canWrite`.

- [ ] **Step 7: Type-check**

Run from `frontend/task-tracker/`:
```bash
npm run build
```
Expected: build succeeds with no TypeScript errors. If there is a "declared but never read" error on `_roadmapItems`, the leading underscore should suppress it under TS's `noUnusedParameters` rule. If it still complains, drop the binding entirely and rely on `Props` keeping the field.

- [ ] **Step 8: Commit**

```bash
git add frontend/task-tracker/src/components/clients/ClientActionPointsTable.tsx
git commit -m "feat(clients): remove Linked roadmap column from Action Points table"
```

---

## Task 2: Inline expand toggle for the Description cell

**Files:**
- Modify: `frontend/task-tracker/src/components/clients/ClientActionPointsTable.tsx`

- [ ] **Step 1: Add `expandedDesc` state and toggle helper**

In `ClientActionPointsTable`, alongside `expandedAttachments` / `toggleAttachments`, add:

```tsx
const [expandedDesc, setExpandedDesc] = useState<Set<string>>(new Set());

const toggleDesc = (uid: string): void =>
  setExpandedDesc((prev) => {
    const next = new Set(prev);
    if (next.has(uid)) next.delete(uid);
    else next.add(uid);
    return next;
  });
```

- [ ] **Step 2: Pass `descExpanded` and `onToggleDesc` into `Row`**

In the `actionPoints.map` block, update the `<Row />` invocation to also pass:

```tsx
<Row
  ap={ap}
  profiles={profiles}
  roadmapItems={roadmapItems}
  canWrite={canWrite}
  attachmentsOpen={open}
  onToggleAttachments={() => toggleAttachments(ap.uid)}
  descExpanded={expandedDesc.has(ap.uid)}
  onToggleDesc={() => toggleDesc(ap.uid)}
  onUpdate={onUpdate}
  onDelete={onDelete}
/>
```

- [ ] **Step 3: Add the new props to `Row`'s parameter type**

In `Row`'s inline type, add the two new props:

```tsx
function Row({
  ap,
  profiles,
  roadmapItems: _roadmapItems,
  canWrite,
  attachmentsOpen,
  onToggleAttachments,
  descExpanded,
  onToggleDesc,
  onUpdate,
  onDelete,
}: {
  ap: ClientActionPointDto;
  profiles: Profile[];
  roadmapItems: readonly ClientRoadmapDto[];
  canWrite: boolean;
  attachmentsOpen: boolean;
  onToggleAttachments: () => void;
  descExpanded: boolean;
  onToggleDesc: () => void;
  onUpdate: (apUid: string, body: Partial<ClientActionPointWrite>) => Promise<void>;
  onDelete: (apUid: string) => Promise<void>;
}) {
```

- [ ] **Step 4: Render the description cell with the expand toggle**

Replace the existing Description `<td>` in `Row`:

```tsx
<td style={tdStyle}>
  {canWrite ? (
    <input value={merged.description} onChange={(e) => setLocal({ ...local, description: e.target.value })} style={cellInput} />
  ) : (
    merged.description
  )}
</td>
```

with:

```tsx
<td style={tdStyle}>
  <div style={{ display: "flex", gap: 4, alignItems: "flex-start" }}>
    <div style={{ flex: 1, minWidth: 0 }}>
      {canWrite ? (
        descExpanded ? (
          <textarea
            rows={4}
            value={merged.description}
            onChange={(e) => setLocal({ ...local, description: e.target.value })}
            style={{ ...cellInput, resize: "vertical", fontFamily: "inherit" }}
          />
        ) : (
          <input
            value={merged.description}
            onChange={(e) => setLocal({ ...local, description: e.target.value })}
            style={cellInput}
          />
        )
      ) : descExpanded ? (
        <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{merged.description}</div>
      ) : (
        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{merged.description}</div>
      )}
    </div>
    <button
      type="button"
      onClick={onToggleDesc}
      title={descExpanded ? "Collapse description" : "Expand description"}
      aria-label={descExpanded ? "Collapse description" : "Expand description"}
      style={{
        background: "transparent",
        border: "1px solid #e2e8f0",
        borderRadius: 4,
        padding: "0 6px",
        fontSize: 12,
        cursor: "pointer",
        color: "#64748b",
        lineHeight: "20px",
      }}
    >
      ⤢
    </button>
  </div>
</td>
```

- [ ] **Step 5: Type-check and run unit tests**

From `frontend/task-tracker/`:
```bash
npm run build
npm test
```
Expected: build succeeds; existing test suite continues to pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/task-tracker/src/components/clients/ClientActionPointsTable.tsx
git commit -m "feat(clients): add inline expand toggle for action point description"
```

---

## Task 3: Status-based row coloring (with overdue override)

**Files:**
- Modify: `frontend/task-tracker/src/components/clients/ClientActionPointsTable.tsx`

- [ ] **Step 1: Add the `rowBackground` helper**

Add this module-level helper at the bottom of the file, near `cellInput` / `thStyle` / `tdStyle`:

```tsx
function rowBackground(ap: ClientActionPointDto, today: string): string {
  switch (ap.status) {
    case "Cancelled":
      return "#f1f5f9";
    case "Completed":
      return "#dcfce7";
    case "In Progress":
      return "#dbeafe";
    case "Open":
      if (ap.target_date && ap.target_date < today) return "#fecaca";
      return "#fef3c7";
  }
}
```

(The `switch` is exhaustive over `ActionPointStatus`, so TypeScript will not require a default branch.)

- [ ] **Step 2: Compute `today` once per render in `ClientActionPointsTable` and thread it into `Row`**

Inside `ClientActionPointsTable`, before the `return`:

```tsx
const today = new Date().toISOString().slice(0, 10);
```

Pass it down on the `<Row />` invocation:

```tsx
<Row
  ap={ap}
  profiles={profiles}
  roadmapItems={roadmapItems}
  canWrite={canWrite}
  attachmentsOpen={open}
  onToggleAttachments={() => toggleAttachments(ap.uid)}
  descExpanded={expandedDesc.has(ap.uid)}
  onToggleDesc={() => toggleDesc(ap.uid)}
  today={today}
  onUpdate={onUpdate}
  onDelete={onDelete}
/>
```

- [ ] **Step 3: Add `today` to `Row`'s parameter type and apply the background**

Update `Row`'s parameter list and inline type:

```tsx
function Row({
  ap,
  profiles,
  roadmapItems: _roadmapItems,
  canWrite,
  attachmentsOpen,
  onToggleAttachments,
  descExpanded,
  onToggleDesc,
  today,
  onUpdate,
  onDelete,
}: {
  ap: ClientActionPointDto;
  profiles: Profile[];
  roadmapItems: readonly ClientRoadmapDto[];
  canWrite: boolean;
  attachmentsOpen: boolean;
  onToggleAttachments: () => void;
  descExpanded: boolean;
  onToggleDesc: () => void;
  today: string;
  onUpdate: (apUid: string, body: Partial<ClientActionPointWrite>) => Promise<void>;
  onDelete: (apUid: string) => Promise<void>;
}) {
```

Replace the row's existing `<tr>` style:

```tsx
<tr style={{ borderBottom: "1px solid #e2e8f0" }}>
```

with:

```tsx
<tr
  style={{
    borderBottom: "1px solid #e2e8f0",
    background: rowBackground(ap, today),
    color: ap.status === "Cancelled" ? "#64748b" : undefined,
  }}
>
```

- [ ] **Step 4: Type-check and run unit tests**

From `frontend/task-tracker/`:
```bash
npm run build
npm test
```
Expected: build succeeds, tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/components/clients/ClientActionPointsTable.tsx
git commit -m "feat(clients): tint action point rows by status with overdue override"
```

---

## Task 4: Manual verification + push

**Files:** none (manual + git).

- [ ] **Step 1: Start the dev server**

From `frontend/task-tracker/`:
```bash
npm run dev
```
Open the app, log in, navigate to **Clients → MOM** view for any client that has at least one meeting with action points.

- [ ] **Step 2: Verify column removal**

- [ ] Header row no longer shows "Linked roadmap".
- [ ] Existing rows have no Linked-roadmap cell.
- [ ] The new-AP draft row has no Linked-roadmap dropdown.
- [ ] No layout breakage; columns line up.

- [ ] **Step 3: Verify Description expand**

- [ ] Each row's Description cell shows the ⤢ button on the right.
- [ ] (Read-only user) Click ⤢ — description wraps to multiple lines; click again — collapses to single line.
- [ ] (Editable user) Click ⤢ — input becomes a 4-row textarea; type some text; click ⤢ to collapse; re-expand — typed text is still there. Click Save — change persists.
- [ ] The new-AP draft row still uses the simple input (no ⤢).

- [ ] **Step 4: Verify status-based row colors**

For action points in each status (create or edit a few to test all four):

- [ ] **Open, target date in the future** → light amber `#fef3c7`.
- [ ] **Open, target date before today** → stronger red `#fecaca`.
- [ ] **In Progress** → light blue `#dbeafe`.
- [ ] **Completed** → light green `#dcfce7`.
- [ ] **Cancelled** → light gray `#f1f5f9` with muted text color.
- [ ] Toggling status via the Status dropdown and clicking Save updates the row tint.

- [ ] **Step 5: Verify the attachments expand row is still distinct**

- [ ] Click the 📎 button on any row.
- [ ] The expanded attachments sub-row has the existing `#f8fafc` background, visually separate from the parent row's tint.

- [ ] **Step 6: Push the branch**

```bash
git push origin LinkedRoadmap_Removal
```

---

## Self-review notes

- Spec coverage:
  - "Remove Linked roadmap column" → Task 1.
  - "Description expand toggle (inline, ⤢, textarea on expand, state preserved)" → Task 2.
  - "Row tint per status, overdue Open in stronger red, Cancelled muted, attachments sub-row keeps its existing color, draft row unchanged" → Task 3.
  - "No automated test changes" → no test tasks. Manual verification covered in Task 4.
- No placeholders. Each step has the exact code to write or the exact command to run.
- Type consistency: `descExpanded` / `onToggleDesc` / `today` names match across `ClientActionPointsTable` (where they are passed) and `Row` (where they are received) in Tasks 2 and 3. `rowBackground` signature is `(ap: ClientActionPointDto, today: string) => string` and is called with that exact signature in Task 3.
