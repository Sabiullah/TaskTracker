# Inline Roadmap Add-Row Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "Add roadmap item" modal popup with a persistent inline entry row (client dropdown + all fields as cells + Add button) at the top of the Roadmap tab, matching the Action Points "New action point…" row pattern.

**Architecture:** Extract a new pure presentational component `ClientRoadmapAddRow` that renders the entry row and emits a `ClientRoadmapWrite` body via `onAdd`. `ClientRoadmapTab` renders it above the client groups, wiring `onAdd` to the existing `create()` (with the existing `clientOrgUidFor` org derivation). The old `ClientRoadmapModal` is removed. No backend changes.

**Tech Stack:** React + TypeScript, Vitest + @testing-library/react (jsdom), existing `useClientRoadmap` hook.

---

## File Structure

- **Create:** `frontend/task-tracker/src/components/clients/ClientRoadmapAddRow.tsx` — the inline entry row (pure: props in, `onAdd` out; no hooks beyond local `useState`).
- **Create:** `frontend/task-tracker/src/__tests__/components/clients/clientRoadmapAddRow.test.tsx` — component test.
- **Modify:** `frontend/task-tracker/src/components/clients/ClientRoadmapTab.tsx` — render `ClientRoadmapAddRow`, remove the Add button, `modalOpen` state, `<ClientRoadmapModal>` usage, and its import.
- **Delete:** `frontend/task-tracker/src/components/clients/ClientRoadmapModal.tsx` — no longer referenced.

---

## Task 1: Create the `ClientRoadmapAddRow` component (TDD)

**Files:**
- Create: `frontend/task-tracker/src/components/clients/ClientRoadmapAddRow.tsx`
- Test: `frontend/task-tracker/src/__tests__/components/clients/clientRoadmapAddRow.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/task-tracker/src/__tests__/components/clients/clientRoadmapAddRow.test.tsx`:

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ClientRoadmapAddRow from "@/components/clients/ClientRoadmapAddRow";
import type { MasterItem } from "@/types";
import type { Profile } from "@/types/auth";

afterEach(() => cleanup());

const clients: MasterItem[] = [
  { id: "c-1", name: "Acme", type: "client", org: null, orgs: [], color: null, is_active: true },
  { id: "c-2", name: "OldCo", type: "client", org: null, orgs: [], color: null, is_active: false },
];

const profiles: Profile[] = [
  { id: "u-1", full_name: "Sulthan Alavutheen" } as Profile,
];

function renderRow(onAdd = vi.fn().mockResolvedValue(undefined)) {
  render(
    <table>
      <tbody>
        <ClientRoadmapAddRow clients={clients} profiles={profiles} onAdd={onAdd} />
      </tbody>
    </table>,
  );
  return onAdd;
}

describe("ClientRoadmapAddRow", () => {
  it("disables Add until a client and a title are provided", () => {
    renderRow();
    const addBtn = screen.getByRole("button", { name: "Add" }) as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Client"), { target: { value: "c-1" } });
    expect(addBtn.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText("New roadmap item…"), {
      target: { value: "Row level security" },
    });
    expect(addBtn.disabled).toBe(false);
  });

  it("hides inactive clients from the picker", () => {
    renderRow();
    const select = screen.getByLabelText("Client") as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toContain("Acme");
    expect(labels).not.toContain("OldCo");
  });

  it("calls onAdd with a trimmed title, the chosen client, and default priority", async () => {
    const onAdd = renderRow();
    fireEvent.change(screen.getByLabelText("Client"), { target: { value: "c-1" } });
    fireEvent.change(screen.getByPlaceholderText("New roadmap item…"), {
      target: { value: "  Vendor analysis  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ client: "c-1", title: "Vendor analysis", priority: "Medium" }),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend/task-tracker && npx vitest --run src/__tests__/components/clients/clientRoadmapAddRow.test.tsx`
Expected: FAIL — cannot resolve module `@/components/clients/ClientRoadmapAddRow`.

- [ ] **Step 3: Write the component**

Create `frontend/task-tracker/src/components/clients/ClientRoadmapAddRow.tsx`:

```tsx
import { useMemo, useState } from "react";
import { filterClientsForAdd } from "@/utils/clientFilters";
import type { MasterItem } from "@/types";
import type { Profile } from "@/types/auth";
import type { ClientRoadmapWrite, Priority } from "@/types/api/clients";

const PRIORITIES: Priority[] = ["High", "Medium", "Low"];

interface Props {
  clients: readonly MasterItem[];
  profiles: Profile[];
  /** Pre-fill the client picker (page-level selected client). "" = none. */
  defaultClientUid?: string;
  /** Persist a new roadmap item. The parent adds the owning `org`. */
  onAdd: (body: ClientRoadmapWrite) => Promise<void>;
}

const emptyDraft = (clientUid: string): ClientRoadmapWrite => ({
  client: clientUid,
  title: "",
  priority: "Medium",
});

export default function ClientRoadmapAddRow({
  clients,
  profiles,
  defaultClientUid,
  onAdd,
}: Props) {
  const [draft, setDraft] = useState<ClientRoadmapWrite>(() =>
    emptyDraft(defaultClientUid ?? ""),
  );
  const [adding, setAdding] = useState(false);

  const visibleClients = useMemo(() => filterClientsForAdd(clients), [clients]);

  const canAdd = !!draft.client && (draft.title ?? "").trim().length > 0;

  const submit = async (): Promise<void> => {
    if (!canAdd) return;
    setAdding(true);
    try {
      await onAdd({ ...draft, title: (draft.title ?? "").trim() });
      // Keep the chosen client so the user can add several rows quickly.
      setDraft(emptyDraft(draft.client));
    } finally {
      setAdding(false);
    }
  };

  return (
    <tr style={{ background: "#fafafa", borderTop: "2px solid #e2e8f0" }}>
      <td style={tdStyle}>
        <select
          aria-label="Client"
          value={draft.client}
          onChange={(e) => setDraft({ ...draft, client: e.target.value })}
          style={cellInput}
        >
          <option value="">— Select a client —</option>
          {visibleClients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </td>
      <td style={tdStyle}>
        <input
          placeholder="New roadmap item…"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          style={cellInput}
        />
      </td>
      <td style={tdStyle}>
        <select
          aria-label="Owner"
          value={draft.owner ?? ""}
          onChange={(e) => setDraft({ ...draft, owner: e.target.value || null })}
          style={cellInput}
        >
          <option value="">—</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>
      </td>
      <td style={tdStyle}>
        <input
          aria-label="Category"
          value={draft.category ?? ""}
          onChange={(e) => setDraft({ ...draft, category: e.target.value })}
          style={cellInput}
        />
      </td>
      <td style={tdStyle}>
        <input
          aria-label="Description"
          value={draft.description ?? ""}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          style={cellInput}
        />
      </td>
      <td style={tdStyle}>
        <input
          aria-label="Start date"
          type="date"
          value={draft.start_date ?? ""}
          onChange={(e) => setDraft({ ...draft, start_date: e.target.value || null })}
          style={cellInput}
        />
      </td>
      <td style={tdStyle}>
        <input
          aria-label="Target date"
          type="date"
          value={draft.target_date ?? ""}
          onChange={(e) => setDraft({ ...draft, target_date: e.target.value || null })}
          style={cellInput}
        />
      </td>
      <td style={tdStyle}>
        <input
          aria-label="Expected date"
          type="date"
          value={draft.expected_date ?? ""}
          onChange={(e) => setDraft({ ...draft, expected_date: e.target.value || null })}
          style={cellInput}
        />
      </td>
      <td style={tdStyle}>
        <input
          aria-label="Completion date"
          type="date"
          value={draft.completion_date ?? ""}
          onChange={(e) =>
            setDraft({ ...draft, completion_date: e.target.value || null })
          }
          style={cellInput}
        />
      </td>
      <td style={tdStyle}>
        <select
          aria-label="Priority"
          value={draft.priority}
          onChange={(e) => setDraft({ ...draft, priority: e.target.value as Priority })}
          style={cellInput}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </td>
      <td style={tdStyle}>
        <input
          aria-label="Progress notes"
          value={draft.progress_notes ?? ""}
          onChange={(e) => setDraft({ ...draft, progress_notes: e.target.value })}
          style={cellInput}
        />
      </td>
      <td style={tdStyle}>
        <button
          type="button"
          onClick={submit}
          disabled={adding || !canAdd}
          style={btnSmall}
        >
          {adding ? "Adding…" : "Add"}
        </button>
      </td>
    </tr>
  );
}

const tdStyle: React.CSSProperties = { padding: "8px 10px", verticalAlign: "top" };
const cellInput: React.CSSProperties = {
  width: "100%",
  padding: "4px 6px",
  border: "1px solid #cbd5e1",
  borderRadius: 4,
  fontSize: 13,
  background: "#fff",
};
const btnSmall: React.CSSProperties = {
  padding: "4px 10px",
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend/task-tracker && npx vitest --run src/__tests__/components/clients/clientRoadmapAddRow.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/components/clients/ClientRoadmapAddRow.tsx frontend/task-tracker/src/__tests__/components/clients/clientRoadmapAddRow.test.tsx
git commit -m "feat(roadmap): add inline ClientRoadmapAddRow entry-row component"
```

---

## Task 2: Wire the add-row into `ClientRoadmapTab`, remove the modal

**Files:**
- Modify: `frontend/task-tracker/src/components/clients/ClientRoadmapTab.tsx`

- [ ] **Step 1: Remove the modal import**

In `ClientRoadmapTab.tsx`, delete this line (line ~6):

```tsx
import ClientRoadmapModal from "./ClientRoadmapModal";
```

Add, just below the remaining sibling imports (next to the `ClientRoadmapFocusModal` import):

```tsx
import ClientRoadmapAddRow from "./ClientRoadmapAddRow";
```

- [ ] **Step 2: Remove the `modalOpen` state**

Delete this line (~line 118):

```tsx
const [modalOpen, setModalOpen] = useState(false);
```

- [ ] **Step 3: Remove the "+ Add roadmap item" button**

Delete this block in the filter toolbar (~lines 289-293):

```tsx
{canWrite && (
  <button type="button" onClick={() => setModalOpen(true)} style={{ ...btnPrimary, alignSelf: "flex-end" }}>
    + Add roadmap item
  </button>
)}
```

- [ ] **Step 4: Render the inline add-row above the client groups**

Locate the start of the results region — the block beginning `{loading ? (` (~line 324). Insert the add-row table immediately BEFORE it, so it sits below the toolbar and above the groups. Add the `canWrite &&` guard:

```tsx
{canWrite && (
  <table
    style={{
      width: "100%",
      borderCollapse: "collapse",
      fontSize: 13,
      marginBottom: 10,
      border: "1px solid #e2e8f0",
      borderRadius: 6,
    }}
  >
    <thead>
      <tr style={{ background: "#f1f5f9", textAlign: "left" }}>
        <th style={thStyle}>Client*</th>
        <th style={thStyle}>Title*</th>
        <th style={thStyle}>Owner</th>
        <th style={thStyle}>Category</th>
        <th style={thStyle}>Description</th>
        <th style={thStyle}>Start</th>
        <th style={thStyle}>Target</th>
        <th style={thStyle}>Expected</th>
        <th style={thStyle}>Completion</th>
        <th style={thStyle}>Priority</th>
        <th style={thStyle}>Progress</th>
        <th style={thStyle}></th>
      </tr>
    </thead>
    <tbody>
      <ClientRoadmapAddRow
        clients={clients}
        profiles={profiles}
        defaultClientUid={clientUid}
        onAdd={async (body) => {
          try {
            await create({ ...body, org: clientOrgUidFor(body.client) });
          } catch (err) {
            reportApiError("Save failed", err);
            throw err;
          }
        }}
      />
    </tbody>
  </table>
)}
```

- [ ] **Step 5: Remove the `<ClientRoadmapModal>` usage**

Delete this block (~lines 455-469):

```tsx
<ClientRoadmapModal
  open={modalOpen}
  defaultClientUid={clientUid}
  clients={clients}
  profiles={profiles}
  onClose={() => setModalOpen(false)}
  onSubmit={async (body) => {
    try {
      await create({ ...body, org: clientOrgUidFor(body.client) });
    } catch (err) {
      reportApiError("Save failed", err);
      throw err;
    }
  }}
/>
```

- [ ] **Step 6: Verify `btnPrimary` is still referenced; remove if now unused**

After Step 3 removed the only `btnPrimary` use, check for remaining references:

Run: `cd frontend/task-tracker && grep -n "btnPrimary" src/components/clients/ClientRoadmapTab.tsx`
Expected: only the definition line (`const btnPrimary: React.CSSProperties = {`) remains.
If so, delete the `const btnPrimary … };` block (~lines 756-764) to avoid an unused-variable lint/tsc error. If other references remain, leave it.

- [ ] **Step 7: Type-check**

Run: `cd frontend/task-tracker && npx tsc -p tsconfig.app.json --noEmit`
Expected: no errors. (Confirm the exact tsconfig name first with `ls frontend/task-tracker/tsconfig*.json`; use the app config that includes `src`.)

- [ ] **Step 8: Run the full frontend test suite**

Run: `cd frontend/task-tracker && npm test`
Expected: PASS, including the new `clientRoadmapAddRow.test.tsx`.

- [ ] **Step 9: Commit**

```bash
git add frontend/task-tracker/src/components/clients/ClientRoadmapTab.tsx
git commit -m "feat(roadmap): use inline add-row in tab, drop add modal usage"
```

---

## Task 3: Delete the now-unused `ClientRoadmapModal`

**Files:**
- Delete: `frontend/task-tracker/src/components/clients/ClientRoadmapModal.tsx`

- [ ] **Step 1: Confirm no remaining references**

Run: `cd frontend/task-tracker && grep -rn "ClientRoadmapModal" src`
Expected: no matches (the import and usage were removed in Task 2).

- [ ] **Step 2: Delete the file**

```bash
git rm frontend/task-tracker/src/components/clients/ClientRoadmapModal.tsx
```

- [ ] **Step 3: Type-check + build**

Run: `cd frontend/task-tracker && npx tsc -p tsconfig.app.json --noEmit && npm run build`
Expected: no errors (build succeeds).

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(roadmap): remove unused ClientRoadmapModal"
```

---

## Task 4: Full verification

- [ ] **Step 1: Run pre-commit across the repo**

Run: `uv run pre-commit run --all-files`
Expected: ruff/format/eslint/tsc/build/line-ending hooks all pass. Fix any reported issues and re-run until clean.

- [ ] **Step 2: Run the frontend test suite once more**

Run: `cd frontend/task-tracker && npm test`
Expected: all tests pass.

- [ ] **Step 3: Commit any pre-commit fixups (if hooks modified files)**

```bash
git add -A
git commit -m "chore(roadmap): satisfy pre-commit"
```

(Skip if pre-commit made no changes.)

---

## Self-Review Notes

- **Spec coverage:** entry row with all modal fields as cells (Task 1) ✓; Client dropdown first, Description after Category, Status omitted (Task 1 column order) ✓; required Client+Title guard (Task 1 test + `canAdd`) ✓; reuse `create` + `clientOrgUidFor` org derivation (Task 2 Step 4) ✓; draft reset keeping client prefill (Task 1 `submit`) ✓; remove button/modal/state (Task 2) ✓; delete modal file (Task 3) ✓; tests + tsc + build + pre-commit (Tasks 1-4) ✓.
- **Column order** (Client, Title, Owner, Category, Description, Start, Target, Expected, Completion, Priority, Progress) is identical between the `ClientRoadmapAddRow` cells (Task 1) and the header `<th>`s (Task 2 Step 4).
- **WebSocket INSERT** already prepends the new item to the list (`useClientRoadmap` create + `client-roadmap` subscription), so no manual list refresh is needed.
