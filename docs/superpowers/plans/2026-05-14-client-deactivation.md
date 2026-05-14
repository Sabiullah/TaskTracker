# Client Deactivation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Active/Inactive toggle to clients on Masters > Clients so deactivated clients vanish from every "new entry" picker while staying selectable in edit-existing modals and filter/report dropdowns.

**Architecture:** The `Master.is_active` field already exists (default `True`, indexed) and the serializer already exposes it. No DB migration, no new endpoint. Frontend reads/writes the flag via the existing `/api/masters/<uid>/` PATCH, surfaces an inline pill button on the Masters > Clients cards, and applies an `is_active !== false` filter inside each "Add" modal's client option list.

**Tech Stack:** Django 5 / DRF 3 (backend, no code changes besides a regression test). React 18 + TypeScript + Vitest + Testing Library (frontend).

**Spec:** [docs/superpowers/specs/2026-05-14-client-deactivation-design.md](../specs/2026-05-14-client-deactivation-design.md)

---

## File Structure

**Created**
- `frontend/task-tracker/src/utils/clientFilters.ts` — single helper used by every add-modal so the filter rule is defined once.
- `frontend/task-tracker/src/__tests__/utils/clientFilters.test.ts`
- `frontend/task-tracker/src/__tests__/hooks/useMastersToggleActive.test.ts`
- `frontend/task-tracker/src/__tests__/pages/mastersClientToggle.test.tsx`
- `frontend/task-tracker/src/__tests__/components/board/taskModalAddOnlyClients.test.tsx`
- `frontend/task-tracker/src/__tests__/components/clients/internalReportClientList.test.ts`

**Modified**
- `core/masters/tests.py` — add `MasterActiveFlagTests`.
- `frontend/task-tracker/src/types/masters.ts` — add `is_active` field.
- `frontend/task-tracker/src/hooks/useMasters.ts` — hydrate `is_active`, add `toggleActive`.
- `frontend/task-tracker/src/pages/MastersPage.tsx` — sort, visual, toggle button.
- `frontend/task-tracker/src/components/board/TaskModal.tsx`
- `frontend/task-tracker/src/components/worklog/PlanAddModal.tsx`
- `frontend/task-tracker/src/components/invoice/InvoicesTab.tsx`
- `frontend/task-tracker/src/components/conveyance/ConveyanceFormDialog.tsx`
- `frontend/task-tracker/src/components/kaizen/EditRow.tsx`
- `frontend/task-tracker/src/components/clients/VisitSubmitModal.tsx`
- `frontend/task-tracker/src/components/clients/MonthlyReportModal.tsx`
- `frontend/task-tracker/src/components/clients/ClientRoadmapModal.tsx`
- `frontend/task-tracker/src/pages/NoticePage.tsx`
- `frontend/task-tracker/src/components/clients/momClientOptions.ts`
- `frontend/task-tracker/src/__tests__/components/clients/momClientOptions.test.ts` — extend.

---

## Task 1: Backend regression test — PATCH `is_active` round-trips

The `is_active` field is already on the model and serializer. Lock that contract with an explicit test before the frontend starts depending on it.

**Files:**
- Modify: `core/masters/tests.py` (append new test class at the bottom)

- [ ] **Step 1: Write the failing tests**

Append to `core/masters/tests.py`:

```python
class MasterActiveFlagTests(TestCase):
    """Lock the API contract for the client activate/deactivate UI:
    new rows default to active, PATCH toggles, and the flag round-trips
    in the GET payload.
    """

    def setUp(self):
        self.org, self.admin = _make_org_user("active_admin", role="admin")
        self.client_api = APIClient()
        _auth(self.client_api, self.admin)

    def test_new_client_defaults_to_active(self):
        res = self.client_api.post(
            "/api/masters/",
            {
                "name": "Acme",
                "type": "client",
                "org": str(self.org.uid),
                "orgs": [str(self.org.uid)],
            },
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.data)
        self.assertTrue(res.data["is_active"])
        row = Master.objects.get(name="Acme", type="client")
        self.assertTrue(row.is_active)

    def test_patch_is_active_false_then_true(self):
        client_row = _make_client(self.org, name="Toggler")
        url = f"/api/masters/{client_row.uid}/"

        res = self.client_api.patch(url, {"is_active": False}, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertFalse(res.data["is_active"])
        client_row.refresh_from_db()
        self.assertFalse(client_row.is_active)

        res = self.client_api.patch(url, {"is_active": True}, format="json")
        self.assertEqual(res.status_code, 200, res.data)
        self.assertTrue(res.data["is_active"])
        client_row.refresh_from_db()
        self.assertTrue(client_row.is_active)

    def test_list_returns_both_active_and_inactive(self):
        active = _make_client(self.org, name="ActiveCo")
        inactive = _make_client(self.org, name="InactiveCo")
        Master.objects.filter(pk=inactive.pk).update(is_active=False)

        res = self.client_api.get("/api/masters/?type=client")
        self.assertEqual(res.status_code, 200)
        rows = {r["uid"]: r for r in res.data}
        self.assertIn(str(active.uid), rows)
        self.assertIn(str(inactive.uid), rows)
        self.assertTrue(rows[str(active.uid)]["is_active"])
        self.assertFalse(rows[str(inactive.uid)]["is_active"])
```

- [ ] **Step 2: Run tests to confirm they pass against existing code**

Run: `python manage.py test core.masters.tests.MasterActiveFlagTests -v 2`
Expected: 3 passing tests. (They already pass because the field exists; this is a regression net for the frontend work.)

- [ ] **Step 3: Commit**

```bash
git add core/masters/tests.py
git commit -m "test(masters): lock is_active default + PATCH contract"
```

---

## Task 2: Add `is_active` to `MasterItem` type

**Files:**
- Modify: `frontend/task-tracker/src/types/masters.ts`

- [ ] **Step 1: Add the field**

Edit `frontend/task-tracker/src/types/masters.ts`. Below the `target_day?` field (line 29), add:

```ts
  /** Active flag. Default true. Inactive clients are hidden from
   *  "new entry" pickers but remain visible in filter dropdowns and
   *  edit-existing modals so historical data stays addressable.
   *  Hydrated from the server DTO; older DTOs that omit it default
   *  to true. */
  is_active: boolean;
```

The final file should have `is_active: boolean;` as the last field inside `interface MasterItem` (no `?` — every item carries a default).

- [ ] **Step 2: Verify the type compiles**

Run from `frontend/task-tracker/`:

```bash
npx tsc --noEmit
```

Expected: errors point at `dtoToMasterItem` in `useMasters.ts` complaining that the returned object is missing `is_active`. That's the next task — leave the errors in place.

- [ ] **Step 3: Commit (compile errors ok — Task 3 fixes them)**

```bash
git add frontend/task-tracker/src/types/masters.ts
git commit -m "feat(masters): add is_active to MasterItem"
```

---

## Task 3: Hydrate `is_active` and add `toggleActive` to `useMasters`

**Files:**
- Modify: `frontend/task-tracker/src/hooks/useMasters.ts`
- Create: `frontend/task-tracker/src/__tests__/hooks/useMastersToggleActive.test.ts`

- [ ] **Step 1: Write the failing hook test**

Create `frontend/task-tracker/src/__tests__/hooks/useMastersToggleActive.test.ts`:

```ts
// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

let patchCalls: Array<{ url: string; body: unknown }> = [];

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    apiGet: vi.fn(async (url: string) => {
      if (url === "/masters/") {
        return [
          {
            id: 1,
            uid: "client-a",
            name: "Acme",
            type: "client",
            color: "",
            is_active: true,
            sort_order: 0,
            org: null,
            org_uid: null,
            orgs: [],
            parent: null,
            recurrence: "",
            target_day: null,
            created_by_uid: null,
            created_at: "",
            updated_at: "",
          },
        ];
      }
      return [];
    }),
    apiPost: vi.fn(),
    apiPatch: vi.fn(async (url: string, body: unknown) => {
      patchCalls.push({ url, body });
      return {
        id: 1,
        uid: "client-a",
        name: "Acme",
        type: "client",
        color: "",
        is_active: (body as { is_active: boolean }).is_active,
        sort_order: 0,
        org: null,
        org_uid: null,
        orgs: [],
        parent: null,
        recurrence: "",
        target_day: null,
        created_by_uid: null,
        created_at: "",
        updated_at: "",
      };
    }),
    apiDelete: vi.fn(),
    ws: { subscribe: () => () => undefined },
  };
});

import { useMasters } from "@/hooks/useMasters";

describe("useMasters.toggleActive", () => {
  it("hydrates is_active from the DTO and defaults to true when absent", async () => {
    const { result } = renderHook(() => useMasters());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.clients).toHaveLength(1);
    expect(result.current.clients[0].is_active).toBe(true);
  });

  it("PATCHes /masters/<uid>/ with the flipped flag and updates state", async () => {
    patchCalls = [];
    const { result } = renderHook(() => useMasters());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.toggleActive(result.current.clients[0]);
    });

    expect(patchCalls).toEqual([
      { url: "/masters/client-a/", body: { is_active: false } },
    ]);
    expect(result.current.clients[0].is_active).toBe(false);

    await act(async () => {
      await result.current.toggleActive(result.current.clients[0]);
    });
    expect(patchCalls[1]).toEqual({
      url: "/masters/client-a/",
      body: { is_active: true },
    });
    expect(result.current.clients[0].is_active).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run from `frontend/task-tracker/`:

```bash
npx vitest run src/__tests__/hooks/useMastersToggleActive.test.ts
```

Expected: FAIL — `result.current.toggleActive is not a function`.

- [ ] **Step 3: Update `dtoToMasterItem` to hydrate `is_active`**

Edit `frontend/task-tracker/src/hooks/useMasters.ts`. Replace the `return` block of `dtoToMasterItem` (currently lines 62-72) with:

```ts
  return {
    id: dto.uid,
    name: dto.name,
    type: dto.type,
    org: dto.org_uid ?? null,
    orgs,
    color: dto.color || null,
    parent: dto.parent ?? null,
    recurrence: dto.recurrence ?? "",
    target_day: dto.target_day ?? null,
    is_active: dto.is_active ?? true,
  };
```

- [ ] **Step 4: Add `toggleActive` to the hook's return type**

In the same file, edit the `UseMastersReturn` interface. After the `deleteItem` line (currently line 93), add:

```ts
  toggleActive: (item: MasterItem) => Promise<MasterItem | null>;
```

- [ ] **Step 5: Implement `toggleActive`**

Inside `useMasters`, after the `deleteItem` `useCallback` block (around line 263, before the `return` statement), add:

```ts
  const toggleActive = useCallback(
    async (item: MasterItem): Promise<MasterItem | null> => {
      try {
        const saved = await apiPatch<MasterDto>(`/masters/${item.id}/`, {
          is_active: !item.is_active,
        });
        const next = dtoToMasterItem(saved);
        if (next.type === "client")
          setClients((prev) => applyUpsert(prev, next, item.id));
        else if (next.type === "category")
          setCats((prev) => applyUpsert(prev, next, item.id));
        return next;
      } catch (err) {
        const msg =
          err instanceof ApiError ? describeApiError(err) : String(err);
        alert(`Toggle failed: ${msg}`);
        return null;
      }
    },
    [],
  );
```

And add `toggleActive` to the `return` block at the bottom of the hook:

```ts
  return {
    clients,
    cats,
    loading,
    saving,
    reload,
    saveItem,
    deleteItem,
    toggleActive,
  };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/__tests__/hooks/useMastersToggleActive.test.ts`
Expected: 2 passing tests.

- [ ] **Step 7: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/task-tracker/src/hooks/useMasters.ts frontend/task-tracker/src/__tests__/hooks/useMastersToggleActive.test.ts
git commit -m "feat(masters): hydrate is_active + add toggleActive hook helper"
```

---

## Task 4: Create the `clientFilters` helper

Single source of truth so every add modal calls the same function.

**Files:**
- Create: `frontend/task-tracker/src/utils/clientFilters.ts`
- Create: `frontend/task-tracker/src/__tests__/utils/clientFilters.test.ts`

- [ ] **Step 1: Write the failing helper test**

Create `frontend/task-tracker/src/__tests__/utils/clientFilters.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  filterClientsForAdd,
  filterClientsForEdit,
} from "@/utils/clientFilters";
import type { MasterItem } from "@/types";

function makeClient(
  id: string,
  name: string,
  is_active: boolean,
): MasterItem {
  return {
    id,
    name,
    type: "client",
    org: null,
    orgs: [],
    color: null,
    is_active,
  };
}

describe("filterClientsForAdd", () => {
  it("excludes inactive clients", () => {
    const items = [
      makeClient("a", "Acme", true),
      makeClient("b", "Beta", false),
      makeClient("c", "Cyrix", true),
    ];
    expect(filterClientsForAdd(items).map((c) => c.id)).toEqual(["a", "c"]);
  });

  it("treats missing is_active as active (back-compat)", () => {
    const items = [
      { ...makeClient("a", "Acme", true), is_active: undefined as unknown as boolean },
      makeClient("b", "Beta", false),
    ];
    expect(filterClientsForAdd(items).map((c) => c.id)).toEqual(["a"]);
  });
});

describe("filterClientsForEdit", () => {
  it("keeps every active client", () => {
    const items = [makeClient("a", "Acme", true), makeClient("b", "Beta", true)];
    expect(filterClientsForEdit(items, null).map((c) => c.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("hides inactive clients when boundUid is null", () => {
    const items = [makeClient("a", "Acme", true), makeClient("b", "Beta", false)];
    expect(filterClientsForEdit(items, null).map((c) => c.id)).toEqual(["a"]);
  });

  it("keeps the bound client even when inactive", () => {
    const items = [
      makeClient("a", "Acme", true),
      makeClient("b", "Beta", false),
    ];
    expect(filterClientsForEdit(items, "b").map((c) => c.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("does not duplicate the bound client when already active", () => {
    const items = [makeClient("a", "Acme", true)];
    expect(filterClientsForEdit(items, "a").map((c) => c.id)).toEqual(["a"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/utils/clientFilters.test.ts`
Expected: FAIL — module `@/utils/clientFilters` not found.

- [ ] **Step 3: Implement the helper**

Create `frontend/task-tracker/src/utils/clientFilters.ts`:

```ts
import type { MasterItem } from "@/types";

const isActiveClient = (c: MasterItem): boolean => c.is_active !== false;

/** Drop inactive clients from a list destined for an Add-new picker. */
export function filterClientsForAdd(
  clients: readonly MasterItem[],
): MasterItem[] {
  return clients.filter(isActiveClient);
}

/** Drop inactive clients, but keep the currently-bound one even when
 *  inactive, so editing an existing row doesn't blank out its FK on
 *  save. Pass ``null`` for ``boundUid`` when no value is bound yet. */
export function filterClientsForEdit(
  clients: readonly MasterItem[],
  boundUid: string | null,
): MasterItem[] {
  return clients.filter(
    (c) => isActiveClient(c) || (boundUid !== null && c.id === boundUid),
  );
}

/** True when the client is inactive — callers can use this to append a
 *  "(inactive)" suffix in the rendered option label. */
export function isInactiveClient(c: MasterItem): boolean {
  return c.is_active === false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/utils/clientFilters.test.ts`
Expected: 6 passing tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/utils/clientFilters.ts frontend/task-tracker/src/__tests__/utils/clientFilters.test.ts
git commit -m "feat(masters): add filterClientsForAdd + filterClientsForEdit helpers"
```

---

## Task 5: Masters > Clients tab — sort, toggle button, visual

**Files:**
- Modify: `frontend/task-tracker/src/pages/MastersPage.tsx`
- Create: `frontend/task-tracker/src/__tests__/pages/mastersClientToggle.test.tsx`

- [ ] **Step 1: Write the failing integration test**

Create `frontend/task-tracker/src/__tests__/pages/mastersClientToggle.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";

let confirmSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
});

const mastersListing = [
  {
    id: 1,
    uid: "active-1",
    name: "Acme",
    type: "client" as const,
    color: "",
    is_active: true,
    sort_order: 0,
    org: null,
    org_uid: null,
    orgs: [],
    parent: null,
    recurrence: "" as const,
    target_day: null,
    created_by_uid: null,
    created_at: "",
    updated_at: "",
  },
  {
    id: 2,
    uid: "inactive-1",
    name: "OldCo",
    type: "client" as const,
    color: "",
    is_active: false,
    sort_order: 0,
    org: null,
    org_uid: null,
    orgs: [],
    parent: null,
    recurrence: "" as const,
    target_day: null,
    created_by_uid: null,
    created_at: "",
    updated_at: "",
  },
];

const patchCalls: Array<{ url: string; body: unknown }> = [];

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    apiGet: vi.fn(async (url: string) => {
      if (url === "/masters/") return mastersListing;
      if (url === "/orgs/") return [];
      return [];
    }),
    apiPatch: vi.fn(async (url: string, body: unknown) => {
      patchCalls.push({ url, body });
      const uid = url.split("/").filter(Boolean).pop();
      const row = mastersListing.find((m) => m.uid === uid);
      if (!row) throw new Error("not found");
      const next = { ...row, ...(body as object) };
      Object.assign(row, next);
      return next;
    }),
    apiPost: vi.fn(),
    apiDelete: vi.fn(),
    ws: { subscribe: () => () => undefined },
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdminInAny: () => true }),
}));

vi.mock("@/hooks/useOrgs", () => ({
  useOrgs: () => ({
    orgs: [],
    loading: false,
    saving: false,
    saveOrg: vi.fn(),
    deleteOrg: vi.fn(),
  }),
}));

import MastersPage from "@/pages/MastersPage";

describe("MastersPage clients tab — activate/deactivate", () => {
  it("renders an Active pill for active clients and Inactive for inactive ones", async () => {
    render(<MastersPage profile={null} profiles={[]} />);
    // Switch to Clients tab
    await waitFor(() => screen.getByText(/🏢 Clients/));
    fireEvent.click(screen.getByText(/🏢 Clients/));
    await waitFor(() => screen.getByText("Acme"));
    expect(screen.getByText("Acme")).toBeTruthy();
    expect(screen.getByText("OldCo")).toBeTruthy();
    // Active pill on the active row
    const activePills = screen.getAllByRole("button", { name: /^Active$/ });
    expect(activePills.length).toBe(1);
    const inactivePills = screen.getAllByRole("button", { name: /^Inactive$/ });
    expect(inactivePills.length).toBe(1);
  });

  it("sorts active clients first, then inactive, alphabetical within each", async () => {
    render(<MastersPage profile={null} profiles={[]} />);
    fireEvent.click(screen.getByText(/🏢 Clients/));
    await waitFor(() => screen.getByText("Acme"));
    const cards = document.querySelectorAll(".dm-item-card");
    const names = Array.from(cards).map((c) => c.querySelector("span")?.textContent ?? "");
    expect(names[0]).toContain("Acme");
    expect(names[1]).toContain("OldCo");
  });

  it("clicking Active prompts confirm then PATCHes is_active=false", async () => {
    patchCalls.length = 0;
    render(<MastersPage profile={null} profiles={[]} />);
    fireEvent.click(screen.getByText(/🏢 Clients/));
    await waitFor(() => screen.getByText("Acme"));
    fireEvent.click(screen.getByRole("button", { name: /^Active$/ }));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(patchCalls).toHaveLength(1));
    expect(patchCalls[0]).toEqual({
      url: "/masters/active-1/",
      body: { is_active: false },
    });
  });

  it("clicking Inactive reactivates without a confirm", async () => {
    patchCalls.length = 0;
    confirmSpy.mockClear();
    render(<MastersPage profile={null} profiles={[]} />);
    fireEvent.click(screen.getByText(/🏢 Clients/));
    await waitFor(() => screen.getByText("OldCo"));
    fireEvent.click(screen.getByRole("button", { name: /^Inactive$/ }));
    expect(confirmSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(patchCalls).toHaveLength(1));
    expect(patchCalls[0]).toEqual({
      url: "/masters/inactive-1/",
      body: { is_active: true },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/pages/mastersClientToggle.test.tsx`
Expected: FAIL — no Active/Inactive pills rendered yet.

- [ ] **Step 3: Wire up `toggleActive` in MastersPage and add sort helper**

Edit `frontend/task-tracker/src/pages/MastersPage.tsx`.

In the destructure of `useMasters()` (currently around line 77-84), add `toggleActive`:

```ts
  const {
    clients,
    cats,
    loading: mastersLoading,
    saving: mastersSaving,
    saveItem,
    deleteItem,
    toggleActive,
  } = useMasters();
```

After the `subCountByParent` `useMemo` (around line 117-123), add:

```ts
  // Active clients sort first, then inactives. Names alphabetical within each
  // group so the grid keeps stable order after a toggle.
  const sortedClients = useMemo(() => {
    const active = clients.filter((c) => c.is_active !== false);
    const inactive = clients.filter((c) => c.is_active === false);
    return [...sortByName(active), ...sortByName(inactive)];
  }, [clients]);
```

- [ ] **Step 4: Add a `handleToggleActive` handler and inline button styles**

Right above the `handleDelete` definition (currently line 378), add:

```ts
  const handleToggleActive = async (item: MasterItem): Promise<void> => {
    if (item.is_active !== false) {
      const ok = window.confirm(
        `Deactivate "${item.name}"? Existing entries are kept untouched. The client will no longer appear in new-entry dropdowns.`,
      );
      if (!ok) return;
    }
    const res = await toggleActive(item);
    if (res) {
      showToast(
        res.is_active ? `✅ ${res.name} reactivated` : `🚫 ${res.name} deactivated`,
      );
    }
  };

  const activePillBtn: CSSProperties = {
    padding: "2px 8px",
    fontSize: 11,
    fontWeight: 600,
    background: "#d1fae5",
    color: "#065f46",
    border: "none",
    borderRadius: 4,
    cursor: "pointer",
  };
  const inactivePillBtn: CSSProperties = {
    ...activePillBtn,
    background: "#e5e7eb",
    color: "#4b5563",
  };
```

- [ ] **Step 5: Replace `sortByName(clients)` with `sortedClients` and apply card visual**

In the grid render around line 560, change:

```ts
                  {(tab === "orgs"
                    ? sortByName(orgs)
                    : tab === "clients"
                      ? sortByName(clients)
                      : // Mains only — subs are edited inline in the main
                        // category's dialog, so showing them as separate
                        // cards here would just duplicate the listing.
                        sortByName(cats.filter((c) => !c.parent))
                  ).map((item) => (
```

to:

```ts
                  {(tab === "orgs"
                    ? sortByName(orgs)
                    : tab === "clients"
                      ? sortedClients
                      : // Mains only — subs are edited inline in the main
                        // category's dialog, so showing them as separate
                        // cards here would just duplicate the listing.
                        sortByName(cats.filter((c) => !c.parent))
                  ).map((item) => {
                    const isInactiveClientCard =
                      tab === "clients" &&
                      "is_active" in item &&
                      (item as MasterItem).is_active === false;
                    return (
```

Then locate the existing card's inline style block (currently `background: "#fafafa"` around line 579) and change it to:

```ts
                      background: isInactiveClientCard ? "#f1f5f9" : "#fafafa",
```

Locate the colored-dot block (the `<div>` with `borderRadius: "50%"` around line 600-614). Wrap its `background` and add `opacity`:

```ts
                        <div
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background:
                              tab === "cats" &&
                              !(item as MasterItem).parent &&
                              (subCountByParent[item.id] ?? 0) > 0
                                ? "#10b981"
                                : "#2563eb",
                            flexShrink: 0,
                            opacity: isInactiveClientCard ? 0.4 : 1,
                          }}
                        />
```

Locate the name `<span>` block (around line 615-694) — set its `color` based on inactive state. Change the existing `style={{ flex: 1, fontWeight: 600, fontSize: 13, ... }}` to add:

```ts
                          color: isInactiveClientCard ? "#94a3b8" : undefined,
```

Close the `.map` callback — change the existing `))}` (around line 720-721) to `);})}`. Because we now use a block-bodied arrow function instead of an expression body, we need an explicit `return (` (added in the previous step) and the closing `)`.

- [ ] **Step 6: Inject the toggle pill on client cards**

Inside the same card render, between the `OrgBadges` block (around line 696-703) and the existing `{(tab !== "orgs" || isAdmin) && (` button block (line 704), insert:

```tsx
                      {tab === "clients" && (
                        <button
                          aria-label={
                            isInactiveClientCard ? "Inactive" : "Active"
                          }
                          title={
                            isInactiveClientCard
                              ? "Inactive — click to reactivate"
                              : "Active — click to deactivate"
                          }
                          onClick={() =>
                            handleToggleActive(item as MasterItem)
                          }
                          style={
                            isInactiveClientCard
                              ? inactivePillBtn
                              : activePillBtn
                          }
                        >
                          {isInactiveClientCard ? "Inactive" : "Active"}
                        </button>
                      )}
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run src/__tests__/pages/mastersClientToggle.test.tsx`
Expected: 4 passing tests.

Run typecheck: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Smoke-test in the browser**

Run dev server: `npm run dev` (from `frontend/task-tracker/`). Open Masters > Clients. Confirm:
- Each client card shows a green "Active" or grey "Inactive" pill before Edit/Del.
- Clicking Active on a real client prompts a confirm. OK → card becomes muted, pill flips to grey "Inactive". Clicking Inactive flips back without prompt.

- [ ] **Step 9: Commit**

```bash
git add frontend/task-tracker/src/pages/MastersPage.tsx frontend/task-tracker/src/__tests__/pages/mastersClientToggle.test.tsx
git commit -m "feat(masters): activate/deactivate toggle on client cards"
```

---

## Task 6: Hide inactive clients in TaskModal (Add mode)

**Files:**
- Modify: `frontend/task-tracker/src/components/board/TaskModal.tsx`
- Create: `frontend/task-tracker/src/__tests__/components/board/taskModalAddOnlyClients.test.tsx`

- [ ] **Step 1: Write the failing integration test**

Create `frontend/task-tracker/src/__tests__/components/board/taskModalAddOnlyClients.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import type { MasterItem } from "@/types";
import {
  filterClientsForAdd,
  filterClientsForEdit,
} from "@/utils/clientFilters";

// TaskModal builds its client option list from useMasters().clients.
// The component-level invariant we're protecting: Add mode applies
// filterClientsForAdd, Edit mode applies filterClientsForEdit with the
// task's bound client uid (or name lookup → uid).
// This test pins the data-shape contract; a full DOM test of TaskModal
// is out of scope here.

const items: MasterItem[] = [
  {
    id: "a",
    name: "Acme",
    type: "client",
    org: null,
    orgs: [],
    color: null,
    is_active: true,
  },
  {
    id: "b",
    name: "OldCo",
    type: "client",
    org: null,
    orgs: [],
    color: null,
    is_active: false,
  },
];

describe("TaskModal client options", () => {
  it("Add mode hides inactives", () => {
    expect(filterClientsForAdd(items).map((c) => c.id)).toEqual(["a"]);
  });

  it("Edit mode keeps the bound inactive client", () => {
    expect(filterClientsForEdit(items, "b").map((c) => c.id)).toEqual([
      "a",
      "b",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it passes (helpers already exist)**

Run: `npx vitest run src/__tests__/components/board/taskModalAddOnlyClients.test.tsx`
Expected: 2 passing tests.

- [ ] **Step 3: Apply the filter inside TaskModal**

Edit `frontend/task-tracker/src/components/board/TaskModal.tsx`.

At the top of the file with the other utility imports, add:

```ts
import {
  filterClientsForAdd,
  filterClientsForEdit,
} from "@/utils/clientFilters";
```

Replace the `clientObjects` `useMemo` (currently lines 158-167):

```ts
  // Resolve the bound client's uid for Edit mode. The form stores the
  // client by *name* (legacy), so we look it up in clientMasters.
  const boundClientUid = useMemo(() => {
    if (!task || !task.client_name) return null;
    const match = clientMasters.find((c) => c.name === task.client_name);
    return match ? match.id : null;
  }, [task, clientMasters]);

  const visibleClientMasters = useMemo(
    () =>
      task
        ? filterClientsForEdit(clientMasters, boundClientUid)
        : filterClientsForAdd(clientMasters),
    [clientMasters, task, boundClientUid],
  );

  const clientObjects = useMemo(
    () =>
      visibleClientMasters
        .map((c) => ({
          name: c.name,
          orgs: c.orgs && c.orgs.length ? c.orgs : c.org ? [c.org] : [],
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [visibleClientMasters],
  );
```

> Note: `task.client_name` is the canonical bound field on the task DTO. If pyright flags it, fall back to `(task as { client_name?: string })?.client_name` rather than expanding the `Task` type — that's out of scope here.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/__tests__/components/board/`
Expected: no regressions in board tests.

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/components/board/TaskModal.tsx frontend/task-tracker/src/__tests__/components/board/taskModalAddOnlyClients.test.tsx
git commit -m "feat(board): hide inactive clients from Add Task picker"
```

---

## Task 7: Hide inactive clients in PlanAddModal (Worklog)

The parent (`WorkLogPage`) builds the `clients` prop as a name-list. We filter inside `PlanAddModal` itself by intersecting that prop with `clientMasters` (already in scope via `useMasters()`), so the filter rows on `WorkLogPage` keep showing all clients.

**Files:**
- Modify: `frontend/task-tracker/src/components/worklog/PlanAddModal.tsx`

- [ ] **Step 1: Apply the filter**

Edit `frontend/task-tracker/src/components/worklog/PlanAddModal.tsx`.

Add the import:

```ts
import { filterClientsForAdd } from "@/utils/clientFilters";
```

After the existing `clientUidByName` `useMemo` (around line 42-48), add:

```ts
  // PlanAddModal is always Add-new (worklog plans can be edited inline
  // in the table, not through this modal). Drop inactive clients from
  // the dropdown by intersecting the parent-supplied name list with
  // the active clients in masters.
  const activeClientNames = useMemo(() => {
    const activeNames = new Set(
      filterClientsForAdd(clientMasters).map((c) => c.name),
    );
    return clients.filter((name) => activeNames.has(name));
  }, [clients, clientMasters]);
```

Replace the `<select>` body around line 551 — change the iteration from `clients.map` to `activeClientNames.map`:

```tsx
                {activeClientNames.map((c) => (
```

(Same `<option>` body, only the source array changes.)

- [ ] **Step 2: Manual smoke test**

Run dev server, open Worklog > Plan tab, click Add. Confirm the Client dropdown does NOT contain the client you deactivated in Task 5's smoke test. Then check the filter row above the table — it should still include the deactivated client.

- [ ] **Step 3: Commit**

```bash
git add frontend/task-tracker/src/components/worklog/PlanAddModal.tsx
git commit -m "feat(worklog): hide inactive clients from Add Plan modal"
```

---

## Task 8: Hide inactive clients in InvoicesTab (new invoice)

**Files:**
- Modify: `frontend/task-tracker/src/components/invoice/InvoicesTab.tsx`

- [ ] **Step 1: Locate the client picker source**

Read `InvoicesTab.tsx` and find where the new-invoice form's Client dropdown maps over the clients array. Search for `clients.map(` and identify the modal/dialog body. Confirm whether the same form handles edit (look for a `selectedInvoice` or `editing` flag near the form state).

- [ ] **Step 2: Apply the filter pattern**

Two variants depending on what step 1 revealed:

**If the form is Add-only:**

```ts
import { filterClientsForAdd } from "@/utils/clientFilters";

// ...inside the component:
const visibleClients = useMemo(
  () => filterClientsForAdd(clients),
  [clients],
);

// then replace `clients.map(...)` in the modal's <select> with `visibleClients.map(...)`.
```

**If the form handles both Add and Edit:**

```ts
import {
  filterClientsForAdd,
  filterClientsForEdit,
} from "@/utils/clientFilters";

const visibleClients = useMemo(
  () =>
    editingInvoice
      ? filterClientsForEdit(clients, editingInvoice.client_uid ?? null)
      : filterClientsForAdd(clients),
  [clients, editingInvoice],
);
```

(Substitute the actual edit-state variable name surfaced in step 1.)

- [ ] **Step 3: Manual smoke test**

Open Invoice > new invoice form. Confirm inactive clients are absent. If the same modal opens for editing an existing invoice whose client is now inactive: confirm the inactive client is still present and selected.

- [ ] **Step 4: Commit**

```bash
git add frontend/task-tracker/src/components/invoice/InvoicesTab.tsx
git commit -m "feat(invoice): hide inactive clients from new invoice picker"
```

---

## Task 9: Hide inactive clients in ConveyanceFormDialog

**Files:**
- Modify: `frontend/task-tracker/src/components/conveyance/ConveyanceFormDialog.tsx`

- [ ] **Step 1: Inspect the form**

Open the file. Find where `clients` are mapped into the client `<select>`. Locate the prop or state that distinguishes Add vs Edit — typically a `dialog.item` or `editingRow` is non-null on edit.

- [ ] **Step 2: Apply the filter**

Add to imports:

```ts
import {
  filterClientsForAdd,
  filterClientsForEdit,
} from "@/utils/clientFilters";
```

Inside the component (where `clients` and the edit-state variable are both in scope), add:

```ts
const visibleClients = useMemo(
  () =>
    editingRow
      ? filterClientsForEdit(clients, editingRow.client_uid ?? null)
      : filterClientsForAdd(clients),
  [clients, editingRow],
);
```

Replace `clients.map(` in the `<select>` body with `visibleClients.map(`.

> If `editingRow.client_uid` doesn't exist but `editingRow.client_name` does, derive the uid by looking up name → id in `clientMasters` exactly as Task 6 did for TaskModal.

- [ ] **Step 3: Manual smoke test**

Open Conveyance > Add. Confirm inactive clients are absent from the dropdown. Open Conveyance > Edit on an entry whose client is now inactive. Confirm the inactive client appears (selected) and the entry can still be saved.

- [ ] **Step 4: Commit**

```bash
git add frontend/task-tracker/src/components/conveyance/ConveyanceFormDialog.tsx
git commit -m "feat(conveyance): hide inactive clients from new entry picker"
```

---

## Task 10: Hide inactive clients in Kaizen EditRow

`EditRow` is an inline-add row for new kaizens. Existing rows keep their client (read-only display or separate edit flow).

**Files:**
- Modify: `frontend/task-tracker/src/components/kaizen/EditRow.tsx`

- [ ] **Step 1: Apply the filter**

Add to imports:

```ts
import { filterClientsForAdd, filterClientsForEdit } from "@/utils/clientFilters";
```

Identify the prop/state that distinguishes Add vs Edit. If the row is always Add-new, use `filterClientsForAdd`. If it doubles as Edit, use the `editingRow ? filterClientsForEdit(...) : filterClientsForAdd(...)` pattern from Task 9.

Add the `visibleClients` memo and replace `clients.map(` in the client `<select>` with `visibleClients.map(`.

- [ ] **Step 2: Manual smoke test**

Open Kaizen > add new row. Confirm inactive clients are absent.

- [ ] **Step 3: Commit**

```bash
git add frontend/task-tracker/src/components/kaizen/EditRow.tsx
git commit -m "feat(kaizen): hide inactive clients from EditRow client picker"
```

---

## Task 11: Hide inactive clients in VisitSubmitModal

**Files:**
- Modify: `frontend/task-tracker/src/components/clients/VisitSubmitModal.tsx`

- [ ] **Step 1: Apply the filter**

```ts
import { filterClientsForAdd, filterClientsForEdit } from "@/utils/clientFilters";

// inside component:
const visibleClients = useMemo(
  () =>
    editingVisit
      ? filterClientsForEdit(clients, editingVisit.client_uid ?? null)
      : filterClientsForAdd(clients),
  [clients, editingVisit],
);
```

Use `visibleClients` in the `<select>`/`<datalist>` body.

If `VisitSubmitModal` is strictly Add-new (no edit mode reuses it), drop the ternary and just use `filterClientsForAdd(clients)`.

- [ ] **Step 2: Manual smoke test**

From Clients page open the visit submit modal. Inactive client absent from the dropdown.

- [ ] **Step 3: Commit**

```bash
git add frontend/task-tracker/src/components/clients/VisitSubmitModal.tsx
git commit -m "feat(clients): hide inactive clients from new-visit modal"
```

---

## Task 12: Hide inactive clients in MonthlyReportModal

**Files:**
- Modify: `frontend/task-tracker/src/components/clients/MonthlyReportModal.tsx`

- [ ] **Step 1: Apply the filter**

```ts
import { filterClientsForAdd, filterClientsForEdit } from "@/utils/clientFilters";

const visibleClients = useMemo(
  () =>
    editingReport
      ? filterClientsForEdit(clients, editingReport.client_uid ?? null)
      : filterClientsForAdd(clients),
  [clients, editingReport],
);
```

(Substitute the actual edit-state variable name from the file.)

Replace `clients.map(` in the dropdown body with `visibleClients.map(`.

- [ ] **Step 2: Manual smoke test**

New monthly report → inactive client absent. Edit an existing report whose client is now inactive → still selectable.

- [ ] **Step 3: Commit**

```bash
git add frontend/task-tracker/src/components/clients/MonthlyReportModal.tsx
git commit -m "feat(clients): hide inactive clients from new monthly-report modal"
```

---

## Task 13: Hide inactive clients in ClientRoadmapModal

**Files:**
- Modify: `frontend/task-tracker/src/components/clients/ClientRoadmapModal.tsx`

- [ ] **Step 1: Apply the filter**

Same pattern as Task 12. Add the `filterClientsForAdd` + `filterClientsForEdit` import, derive `visibleClients` with the edit-state variable, and replace `clients.map(` in the picker.

- [ ] **Step 2: Manual smoke test**

Add roadmap item → inactive client absent. Edit a roadmap whose client is inactive → still selectable.

- [ ] **Step 3: Commit**

```bash
git add frontend/task-tracker/src/components/clients/ClientRoadmapModal.tsx
git commit -m "feat(clients): hide inactive clients from new roadmap modal"
```

---

## Task 14: Hide inactive clients in NoticePage typeahead

The notice form's `<datalist>` is sourced from `clientMasters` and the `clientUidByName` lookup is built from the same list. Both need to be derived from the active subset so a user can't type a deactivated client's name and have the form resolve it.

**Files:**
- Modify: `frontend/task-tracker/src/pages/NoticePage.tsx`

- [ ] **Step 1: Apply the filter**

Edit `frontend/task-tracker/src/pages/NoticePage.tsx`.

Add to imports:

```ts
import { filterClientsForAdd, filterClientsForEdit } from "@/utils/clientFilters";
```

Find the existing `clientUidByName` `useMemo` (around line 68-75). Replace its body so the lookup is sourced from the right subset depending on whether we're editing an existing notice:

```ts
  const visibleClientMasters = useMemo(
    () =>
      editingNotice
        ? filterClientsForEdit(
            clientMasters,
            clientMasters.find((c) => c.name === editingNotice.client_name)?.id
              ?? null,
          )
        : filterClientsForAdd(clientMasters),
    [clientMasters, editingNotice],
  );

  const clientUidByName = useMemo(() => {
    const map: Record<string, string> = {};
    visibleClientMasters.forEach((c) => {
      map[c.name] = c.id;
    });
    return map;
  }, [visibleClientMasters]);
```

> If the file's edit-state variable is named differently (e.g. `editForm`, `editingId`), adjust accordingly. If the form is strictly Add-new (no edit reuses it), drop the ternary and use `filterClientsForAdd(clientMasters)` only.

Find the `<datalist>` used by the notice form and update its source to `visibleClientMasters` instead of `clientMasters`. The filter dropdown above the table (the `clients` array built from `notices.map(...)`) is unchanged — that's filter-bucket, not add-bucket.

- [ ] **Step 2: Manual smoke test**

New notice form: type the inactive client's name — it should NOT appear in the datalist suggestions. Filter row above the notices table: the inactive client should still be selectable so old notices can be filtered.

- [ ] **Step 3: Commit**

```bash
git add frontend/task-tracker/src/pages/NoticePage.tsx
git commit -m "feat(notice): hide inactive clients from new-notice typeahead"
```

---

## Task 15: Extend `momClientOptions` with `excludeInactive`

The MOM (Minutes of Meeting) helper is used in two contexts: the **modal** in Add mode (should hide inactives) and the MOM **filter view** (should not). Add a parameter so each caller can pick.

**Files:**
- Modify: `frontend/task-tracker/src/components/clients/momClientOptions.ts`
- Modify: `frontend/task-tracker/src/__tests__/components/clients/momClientOptions.test.ts`

- [ ] **Step 1: Write the failing test extensions**

Edit `frontend/task-tracker/src/__tests__/components/clients/momClientOptions.test.ts`.

Update the helper at the top:

```ts
function client(
  id: string,
  name: string,
  orgs: string[],
  legacyOrg: string | null = null,
  is_active: boolean = true,
): MasterItem {
  return { id, name, type: "client", org: legacyOrg, orgs, color: null, is_active };
}
```

Append three new tests at the bottom of the `describe` block:

```ts
  it("excludes inactive clients when excludeInactive is true", () => {
    const clients = [
      client("a", "Acme", ["org1"], null, true),
      client("b", "Beta", ["org1"], null, false),
    ];
    expect(
      momClientOptions(clients, "org1", "", true).map((c) => c.id),
    ).toEqual(["a"]);
  });

  it("includes inactive clients by default (excludeInactive=false)", () => {
    const clients = [
      client("a", "Acme", ["org1"], null, true),
      client("b", "Beta", ["org1"], null, false),
    ];
    expect(momClientOptions(clients, "org1", "").map((c) => c.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("keeps the pinned clientUid even when inactive and excludeInactive is true", () => {
    const clients = [
      client("a", "Acme", ["org1"], null, true),
      client("b", "Beta", ["org1"], null, false),
    ];
    const out = momClientOptions(clients, "org1", "b", true).map((c) => c.id);
    expect(out).toContain("a");
    expect(out).toContain("b");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/components/clients/momClientOptions.test.ts`
Expected: 3 new tests FAIL (extra arg ignored; second test fails because the helper currently returns all clients).

- [ ] **Step 3: Implement `excludeInactive`**

Replace the body of `momClientOptions` in `frontend/task-tracker/src/components/clients/momClientOptions.ts`:

```ts
export function momClientOptions(
  clients: readonly MasterItem[],
  selectedOrg: string | null,
  clientUid: string,
  excludeInactive: boolean = false,
): MasterItem[] {
  const matchesOrg = (c: MasterItem): boolean => {
    if (!selectedOrg) return true;
    if (c.orgs.includes(selectedOrg)) return true;
    return c.org === selectedOrg;
  };
  const isActive = (c: MasterItem): boolean => c.is_active !== false;

  const base = clients.filter(
    (c) => matchesOrg(c) && (!excludeInactive || isActive(c)),
  );
  const pinned =
    clientUid && !base.some((c) => c.id === clientUid)
      ? clients.filter((c) => c.id === clientUid)
      : [];
  return [...base, ...pinned].sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 4: Update callers**

Find every caller of `momClientOptions`:

```bash
git grep -n momClientOptions -- frontend/task-tracker/src
```

Inspect each non-test caller and add a fourth argument:
- If the call site is the **Add-mode** MOM modal (a `<select>` for a brand-new MOM record): pass `true`.
- If the call site is the **filter view** (filter row, all-view, single-view that's read-only or edit-existing): pass `false` (or omit — the default).

The two viewers to touch are `ClientMOMSingleView.tsx` and `ClientMOMAllView.tsx`; the meeting modal is in those files too. Read each file's call site, identify whether the surrounding state is "creating a new MOM" vs "filtering an existing list", and pass the right flag.

- [ ] **Step 5: Run all tests**

Run: `npx vitest run src/__tests__/components/clients/`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add frontend/task-tracker/src/components/clients/momClientOptions.ts frontend/task-tracker/src/components/clients/ClientMOMSingleView.tsx frontend/task-tracker/src/components/clients/ClientMOMAllView.tsx frontend/task-tracker/src/__tests__/components/clients/momClientOptions.test.ts
git commit -m "feat(clients): excludeInactive option on momClientOptions"
```

---

## Task 16: Append `(inactive)` suffix to bound-client option labels in edit modals

The spec calls for any inactive client that survives `filterClientsForEdit` (because it's the row's currently-bound value) to be rendered with an `(inactive)` suffix so the user understands why the option is in an otherwise-active list.

**Files (one consolidated pass):**
- Modify: `frontend/task-tracker/src/components/board/TaskModal.tsx`
- Modify: `frontend/task-tracker/src/components/invoice/InvoicesTab.tsx`
- Modify: `frontend/task-tracker/src/components/conveyance/ConveyanceFormDialog.tsx`
- Modify: `frontend/task-tracker/src/components/clients/VisitSubmitModal.tsx`
- Modify: `frontend/task-tracker/src/components/clients/MonthlyReportModal.tsx`
- Modify: `frontend/task-tracker/src/components/clients/ClientRoadmapModal.tsx`
- Modify: `frontend/task-tracker/src/pages/NoticePage.tsx`

- [ ] **Step 1: Pattern recap**

In each file from Tasks 6, 8, 9, 11, 12, 13, 14, the client picker iterates `visibleClients.map(...)` (or `visibleClientMasters` in NoticePage) and emits `<option value=... label={c.name}>`. Wrap each label with an `(inactive)` suffix when `c.is_active === false`:

```tsx
import { isInactiveClient } from "@/utils/clientFilters";

// inside the option-render JSX:
<option key={c.id} value={c.id}>
  {c.name}
  {isInactiveClient(c) ? " (inactive)" : ""}
</option>
```

If the existing select renders by **name** rather than **uid** (e.g., TaskModal's `clientObjects` is `{ name, orgs }[]`), enrich the projection to also carry the `is_active` flag and the suffix check.

For example, in TaskModal (Task 6's `clientObjects`), change:

```ts
  const clientObjects = useMemo(
    () =>
      visibleClientMasters
        .map((c) => ({
          name: c.name,
          orgs: c.orgs && c.orgs.length ? c.orgs : c.org ? [c.org] : [],
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [visibleClientMasters],
  );
```

to:

```ts
  const clientObjects = useMemo(
    () =>
      visibleClientMasters
        .map((c) => ({
          name: c.name,
          orgs: c.orgs && c.orgs.length ? c.orgs : c.org ? [c.org] : [],
          inactive: c.is_active === false,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [visibleClientMasters],
  );
```

Then in the option/datalist render body, append the suffix when `o.inactive` is true.

- [ ] **Step 2: Apply in every modal**

For each of the seven files above, locate the `<option>`/`<datalist><option>` line that renders a client name, and append the suffix. Where the iteration variable doesn't already expose `is_active` (because the projected type omitted it), enrich the projection first as shown in Step 1.

- [ ] **Step 3: Manual smoke test**

Open Board > Edit an existing task whose client is now inactive. The client `<select>` should show that one option as `<Name> (inactive)` while every other option remains plain. Do the same spot-check for Invoice edit, Conveyance edit, Visit edit, Monthly Report edit, Roadmap edit, Notice edit. Add-new pickers should not show any suffix because they have no inactive entries.

- [ ] **Step 4: Run tests + typecheck**

```bash
cd frontend/task-tracker
npm test
npx tsc --noEmit
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/task-tracker/src
git commit -m "feat(masters): append '(inactive)' suffix to bound inactive client options"
```

---

## Task 17: Pin the "filters still show inactives" invariant with a test

Belt-and-suspenders: a small test that confirms `ClientInternalReportTab` (and by extension every filter component) doesn't accidentally adopt the same filter.

**Files:**
- Create: `frontend/task-tracker/src/__tests__/components/clients/internalReportClientList.test.ts`

- [ ] **Step 1: Write the test**

Create the file:

```ts
import { describe, expect, it } from "vitest";
import type { MasterItem } from "@/types";
import { filterClientsForAdd } from "@/utils/clientFilters";

// Documents the contract: filter-bucket components MUST NOT call
// filterClientsForAdd on their dropdown source. This test is intentionally
// "negative" — it fails if someone refactors filterClientsForAdd to mutate
// the input or otherwise affect the array filter-row consumers rely on.

describe("Filter-bucket components keep all clients", () => {
  const items: MasterItem[] = [
    {
      id: "a",
      name: "Acme",
      type: "client",
      org: null,
      orgs: [],
      color: null,
      is_active: true,
    },
    {
      id: "b",
      name: "OldCo",
      type: "client",
      org: null,
      orgs: [],
      color: null,
      is_active: false,
    },
  ];

  it("filterClientsForAdd does not mutate the input", () => {
    const before = items.map((c) => c.id);
    filterClientsForAdd(items);
    expect(items.map((c) => c.id)).toEqual(before);
  });

  it("the unfiltered source is still 2 long after a filter call", () => {
    filterClientsForAdd(items);
    expect(items).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/__tests__/components/clients/internalReportClientList.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/task-tracker/src/__tests__/components/clients/internalReportClientList.test.ts
git commit -m "test(clients): pin non-mutation of filterClientsForAdd"
```

---

## Task 18: Full test suite + final verification

- [ ] **Step 1: Run backend tests**

From repo root:

```bash
python manage.py test core.masters -v 2
```

Expected: all green; the `MasterActiveFlagTests` class from Task 1 is in the count.

- [ ] **Step 2: Run frontend tests**

From `frontend/task-tracker/`:

```bash
npm test
```

Expected: all green; new tests from Tasks 3, 4, 5, 6, 15, 16 are in the count.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Manual end-to-end sanity check**

Dev server up. Walk through:

1. Masters > Clients: deactivate one client. Card visually mutes, pill flips to grey "Inactive".
2. Board > Add Task: client dropdown does NOT show the deactivated client. Edit an existing task that uses it: still selectable, label rendered as `<Name> (inactive)`.
3. Worklog > Plan > Add: deactivated client missing.
4. Invoice > new: deactivated client missing.
5. Conveyance > new: deactivated client missing.
6. Kaizen > new row: deactivated client missing.
7. Visit submit: deactivated client missing.
8. Monthly report > new: deactivated client missing.
9. Roadmap > new: deactivated client missing.
10. Notice > new: deactivated client missing from datalist.
11. Internal Report / Dashboard / Worklog filter rows: deactivated client STILL appears so historical filters work.
12. Reactivate the client from Masters > Clients. Confirm it reappears in every Add picker.

- [ ] **Step 5: Final commit (if any leftover changes)**

```bash
git status
# if anything outstanding:
git add -A
git commit -m "chore(masters): final cleanup for client deactivation feature"
```

- [ ] **Step 6: Push**

```bash
git push
```

---

## Out of scope (deliberately deferred)

- Same mechanism for `type = "category"` rows (mains and subs).
- Server-side validation that rejects writes pointing at an inactive client.
- Bulk-deactivation UI.
- Audit log row on each toggle (no `MasterAuditEvent` model exists today).
