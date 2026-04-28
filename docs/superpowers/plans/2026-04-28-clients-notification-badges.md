# Clients Notification Badges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add red count pills on each Clients sub-tab (Road Map, MOM & Action Points, Internal Report) and on the parent **Clients** entry in the top NavMenu, scoped to the viewer's role and assigned items.

**Architecture:** A pure `computeBadgeCounts` function applies role + ownership rules over already-fetched lists. A `useClientsBadgeCounts` hook mounts the existing data hooks (`useClientRoadmap`, `useOverdueActionPoints` + `useClientMeetings`, `useClientVisits`) and memoizes the counts. Called once at App level (`clientUid=null`) for the parent Clients nav badge, once at ClientsPage level (`clientUid=effective`) for sub-tab badges. Admin-vs-employee scoping is evaluated **per item** via an `isAdminFor(orgUid)` callback derived from `useAuth().isAdminIn`.

**Tech Stack:** React 18 + TypeScript, Vitest + @testing-library/react, Vite. Existing hooks reused; no backend changes.

---

## File Structure

- **Create:** `frontend/task-tracker/src/components/clients/roadmapStatus.ts` — extract `deriveStatus` (currently private to `ClientRoadmapTab.tsx`) and the `RoadmapStatus` ordering so the badge module and the tab share one definition.
- **Modify:** `frontend/task-tracker/src/components/clients/ClientRoadmapTab.tsx` — import `deriveStatus` from the new module instead of defining it locally.
- **Create:** `frontend/task-tracker/src/components/clients/clientsBadgeCounts.ts` — the pure `computeBadgeCounts` function and its `BadgeCounts` type.
- **Create:** `frontend/task-tracker/src/__tests__/components/clients/clientsBadgeCounts.test.ts` — unit tests for the pure function.
- **Create:** `frontend/task-tracker/src/hooks/useClientsBadgeCounts.ts` — React hook that mounts data hooks + memoizes the count computation.
- **Modify:** `frontend/task-tracker/src/components/header/sortableTable.tsx` — add optional `badge?: number` prop on `SortableTab`, render a red pill after the label when > 0.
- **Modify:** `frontend/task-tracker/src/components/header/NavMenu.tsx` — accept `clientsBadgeCount?: number` and attach it to the clients tab's `<SortableTab>`.
- **Modify:** `frontend/task-tracker/src/components/layout/Header.tsx` — accept `clientsBadgeCount?: number` and forward to NavMenu.
- **Modify:** `frontend/task-tracker/src/App.tsx` — call `useClientsBadgeCounts({ clientUid: null })`, pass `total` to Header as `clientsBadgeCount`.
- **Modify:** `frontend/task-tracker/src/pages/ClientsPage.tsx` — call `useClientsBadgeCounts({ clientUid: effectiveClientUid })`, render per-tab pills inside the sub-tab buttons.

---

## Task 1: Extract `deriveStatus` to a shared module

Pure function relocation to enable reuse from the badge counts module without coupling it to `ClientRoadmapTab`.

**Files:**
- Create: `frontend/task-tracker/src/components/clients/roadmapStatus.ts`
- Modify: `frontend/task-tracker/src/components/clients/ClientRoadmapTab.tsx` (remove local copy, add import)
- Create: `frontend/task-tracker/src/__tests__/components/clients/roadmapStatus.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/task-tracker/src/__tests__/components/clients/roadmapStatus.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveRoadmapStatus } from "@/components/clients/roadmapStatus";

describe("deriveRoadmapStatus", () => {
  it("returns Completed when completion_date is set", () => {
    expect(
      deriveRoadmapStatus({
        start_date: null,
        target_date: "2026-04-01",
        expected_date: null,
        completion_date: "2026-04-15",
      }),
    ).toBe("Completed");
  });

  it("returns Overdue when target_date is in the past and not completed", () => {
    expect(
      deriveRoadmapStatus({
        start_date: null,
        target_date: "2026-04-01",
        expected_date: null,
        completion_date: null,
      }),
    ).toBe("Overdue");
  });

  it("returns Overdue when expected_date slipped past target_date", () => {
    expect(
      deriveRoadmapStatus({
        start_date: "2026-05-01",
        target_date: "2026-06-01",
        expected_date: "2026-07-01",
        completion_date: null,
      }),
    ).toBe("Overdue");
  });

  it("returns In Progress when start_date is set and not overdue/completed", () => {
    expect(
      deriveRoadmapStatus({
        start_date: "2026-04-01",
        target_date: "2099-01-01",
        expected_date: null,
        completion_date: null,
      }),
    ).toBe("In Progress");
  });

  it("returns Not Started when no dates set", () => {
    expect(
      deriveRoadmapStatus({
        start_date: null,
        target_date: null,
        expected_date: null,
        completion_date: null,
      }),
    ).toBe("Not Started");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix frontend/task-tracker test -- src/__tests__/components/clients/roadmapStatus.test.ts`
Expected: FAIL with "Cannot find module '@/components/clients/roadmapStatus'".

- [ ] **Step 3: Create the shared module**

Create `frontend/task-tracker/src/components/clients/roadmapStatus.ts`:

```ts
import type { RoadmapStatus } from "@/types/api/clients";

export interface RoadmapStatusInput {
  readonly start_date: string | null;
  readonly target_date: string | null;
  readonly expected_date: string | null;
  readonly completion_date: string | null;
}

// Mirrors the rule in ClientRoadmapTab — keep here so badge counts and the
// table render the same status without import cycles.
export function deriveRoadmapStatus(r: RoadmapStatusInput): RoadmapStatus {
  if (r.completion_date) return "Completed";
  const today = new Date().toISOString().slice(0, 10);
  const targetPast = r.target_date !== null && r.target_date < today;
  const expectedSlipped =
    r.target_date !== null &&
    r.expected_date !== null &&
    r.expected_date > r.target_date;
  if (targetPast || expectedSlipped) return "Overdue";
  if (r.start_date) return "In Progress";
  return "Not Started";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --prefix frontend/task-tracker test -- src/__tests__/components/clients/roadmapStatus.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Update `ClientRoadmapTab.tsx` to import from the new module**

In `frontend/task-tracker/src/components/clients/ClientRoadmapTab.tsx`:

Add this import near the other imports at the top of the file:

```tsx
import { deriveRoadmapStatus } from "./roadmapStatus";
```

Replace the local `deriveStatus` function (currently at lines 59–75) with a re-alias or call sites. The simplest fix is to keep a local alias so we don't have to rename every call site:

```tsx
const deriveStatus = deriveRoadmapStatus;
```

Place that line right after the imports and before the `STATUS_ORDER` constant. Then **delete** the original `function deriveStatus(r: ...) { ... }` block.

- [ ] **Step 6: Verify the file still type-checks and behaves the same**

Run: `npm --prefix frontend/task-tracker run build`
Expected: build succeeds with no TS errors.

Run: `npm --prefix frontend/task-tracker test -- src/__tests__/components/clients`
Expected: all clients tests still pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/task-tracker/src/components/clients/roadmapStatus.ts \
        frontend/task-tracker/src/components/clients/ClientRoadmapTab.tsx \
        frontend/task-tracker/src/__tests__/components/clients/roadmapStatus.test.ts
git commit -m "refactor(clients): extract deriveRoadmapStatus to shared module"
```

---

## Task 2: Pure `computeBadgeCounts` function

The heart of the feature: applies role + scope + ownership filters and returns the four numbers.

**Files:**
- Create: `frontend/task-tracker/src/components/clients/clientsBadgeCounts.ts`
- Create: `frontend/task-tracker/src/__tests__/components/clients/clientsBadgeCounts.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/task-tracker/src/__tests__/components/clients/clientsBadgeCounts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeBadgeCounts } from "@/components/clients/clientsBadgeCounts";
import type { ClientActionPointDto, ClientMeetingDto, ClientRoadmapDto } from "@/types/api/clients";
import type { ClientVisitDto } from "@/types/api/internalReports";

function roadmap(overrides: Partial<ClientRoadmapDto> = {}): ClientRoadmapDto {
  return {
    id: 1,
    uid: "rm-1",
    org_uid: "org-1",
    client: "client-1",
    client_detail: null,
    title: "x",
    owner: "user-emp",
    owner_detail: null,
    category: "",
    description: "",
    start_date: null,
    target_date: "2026-04-01", // past → overdue
    expected_date: null,
    completion_date: null,
    priority: "Medium",
    progress_notes: "",
    created_at: "",
    updated_at: "",
    ...overrides,
  } as ClientRoadmapDto;
}

function ap(overrides: Partial<ClientActionPointDto> = {}): ClientActionPointDto {
  return {
    id: 1,
    uid: "ap-1",
    meeting: 100,
    description: "x",
    responsibility: "user-emp",
    responsibility_detail: null,
    target_date: "2026-04-01",
    completion_date: null,
    status: "Open",
    priority: "Medium",
    remarks: "",
    roadmap_link: null,
    attachments: [],
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function meeting(overrides: Partial<ClientMeetingDto> = {}): ClientMeetingDto {
  return {
    id: 100,
    uid: "m-1",
    org_uid: "org-1",
    client: "client-1",
    client_detail: null,
    meeting_date: "2026-03-15",
    meeting_time: null,
    meeting_type: "Internal",
    mode: "Online",
    venue: "",
    conducted_by: null,
    conducted_by_detail: null,
    our_attendees: [],
    our_attendees_detail: [],
    client_attendees: [],
    agenda: "",
    minutes: "",
    next_meeting_date: null,
    action_points: [],
    attachments: [],
    created_by_detail: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  } as ClientMeetingDto;
}

function visit(overrides: Partial<ClientVisitDto> = {}): ClientVisitDto {
  return {
    id: 1,
    uid: "v-1",
    org_uid: "org-1",
    client: "client-1",
    client_detail: null,
    visit_date: "2026-04-25",
    prepared_by: "user-emp",
    prepared_by_detail: null,
    assigned_manager: "user-mgr",
    assigned_manager_detail: null,
    current_status: "Pending",
    report_sent_date: null,
    voice_note_sent: false,
    voice_note_summary: "",
    created_by_detail: null,
    reports: [],
    audit_events: [],
    is_overdue: false,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

const adminEverywhere = () => true;
const adminNowhere = () => false;
const adminInOrg1Only = (orgUid: string | null) => orgUid === "org-1";

describe("computeBadgeCounts", () => {
  it("returns zeros for empty inputs", () => {
    expect(
      computeBadgeCounts({
        myUid: "user-emp",
        isAdminFor: adminNowhere,
        selectedOrg: null,
        clientUid: null,
        roadmapItems: [],
        overdueAPs: [],
        meetings: [],
        visits: [],
      }),
    ).toEqual({ roadmapOverdue: 0, momOverdue: 0, internalCombined: 0, total: 0 });
  });

  it("admin counts every overdue/pending row regardless of assignee", () => {
    const counts = computeBadgeCounts({
      myUid: "user-x",
      isAdminFor: adminEverywhere,
      selectedOrg: null,
      clientUid: null,
      roadmapItems: [
        roadmap({ uid: "r1", owner: "user-a" }),
        roadmap({ uid: "r2", owner: "user-b" }),
        roadmap({ uid: "r3", owner: null, completion_date: "2026-03-01" }), // Completed → not overdue
      ],
      overdueAPs: [
        ap({ uid: "ap-1", responsibility: "user-a" }),
        ap({ uid: "ap-2", responsibility: "user-b" }),
      ],
      meetings: [meeting()],
      visits: [
        visit({ uid: "v1", is_overdue: true, prepared_by: "user-a", current_status: "Approved" }),
        visit({ uid: "v2", is_overdue: false, prepared_by: "user-b", current_status: "Pending" }),
      ],
    });
    expect(counts).toEqual({
      roadmapOverdue: 2,
      momOverdue: 2,
      internalCombined: 2,
      total: 6,
    });
  });

  it("employee sees only their own overdue items", () => {
    const counts = computeBadgeCounts({
      myUid: "user-emp",
      isAdminFor: adminNowhere,
      selectedOrg: null,
      clientUid: null,
      roadmapItems: [
        roadmap({ uid: "r1", owner: "user-emp" }),
        roadmap({ uid: "r2", owner: "user-other" }),
      ],
      overdueAPs: [
        ap({ uid: "ap-1", responsibility: "user-emp" }),
        ap({ uid: "ap-2", responsibility: "user-other" }),
      ],
      meetings: [meeting()],
      visits: [
        visit({ uid: "v1", is_overdue: true, prepared_by: "user-emp", current_status: "Approved" }),
        visit({ uid: "v2", is_overdue: true, prepared_by: "user-other", current_status: "Approved" }),
      ],
    });
    expect(counts).toEqual({
      roadmapOverdue: 1,
      momOverdue: 1,
      internalCombined: 1,
      total: 3,
    });
  });

  it("manager pending-approval visits count toward Internal even when not prepared by them", () => {
    const counts = computeBadgeCounts({
      myUid: "user-mgr",
      isAdminFor: adminNowhere,
      selectedOrg: null,
      clientUid: null,
      roadmapItems: [],
      overdueAPs: [],
      meetings: [],
      visits: [
        visit({
          uid: "v1",
          is_overdue: false,
          prepared_by: "user-someone-else",
          assigned_manager: "user-mgr",
          current_status: "Pending",
        }),
      ],
    });
    expect(counts.internalCombined).toBe(1);
  });

  it("dedupes a visit that is both overdue AND pending for the same user", () => {
    const counts = computeBadgeCounts({
      myUid: "user-x",
      isAdminFor: adminEverywhere,
      selectedOrg: null,
      clientUid: null,
      roadmapItems: [],
      overdueAPs: [],
      meetings: [],
      visits: [
        visit({ uid: "v1", is_overdue: true, current_status: "Pending" }),
      ],
    });
    expect(counts.internalCombined).toBe(1);
  });

  it("scopes by selectedOrg when provided", () => {
    const counts = computeBadgeCounts({
      myUid: "user-x",
      isAdminFor: adminEverywhere,
      selectedOrg: "org-1",
      clientUid: null,
      roadmapItems: [
        roadmap({ uid: "r1", org_uid: "org-1" }),
        roadmap({ uid: "r2", org_uid: "org-2" }),
      ],
      overdueAPs: [
        ap({ uid: "ap-1", meeting: 100 }),
        ap({ uid: "ap-2", meeting: 200 }),
      ],
      meetings: [
        meeting({ id: 100, org_uid: "org-1" }),
        meeting({ id: 200, org_uid: "org-2", uid: "m-2" }),
      ],
      visits: [
        visit({ uid: "v1", org_uid: "org-1", is_overdue: true, current_status: "Approved" }),
        visit({ uid: "v2", org_uid: "org-2", is_overdue: true, current_status: "Approved" }),
      ],
    });
    expect(counts).toEqual({
      roadmapOverdue: 1,
      momOverdue: 1,
      internalCombined: 1,
      total: 3,
    });
  });

  it("scopes by clientUid when provided (sub-tab badge)", () => {
    const counts = computeBadgeCounts({
      myUid: "user-x",
      isAdminFor: adminEverywhere,
      selectedOrg: null,
      clientUid: "client-1",
      roadmapItems: [
        roadmap({ uid: "r1", client: "client-1" }),
        roadmap({ uid: "r2", client: "client-2" }),
        roadmap({ uid: "r3", client: null }), // unassigned → excluded when clientUid is set
      ],
      overdueAPs: [],
      meetings: [],
      visits: [
        visit({ uid: "v1", client: "client-1", is_overdue: true, current_status: "Approved" }),
        visit({ uid: "v2", client: "client-2", is_overdue: true, current_status: "Approved" }),
      ],
    });
    expect(counts).toEqual({
      roadmapOverdue: 1,
      momOverdue: 0,
      internalCombined: 1,
      total: 2,
    });
  });

  it("excludes action points whose meeting record is missing", () => {
    const counts = computeBadgeCounts({
      myUid: "user-x",
      isAdminFor: adminEverywhere,
      selectedOrg: "org-1",
      clientUid: null,
      roadmapItems: [],
      overdueAPs: [ap({ uid: "ap-1", meeting: 999 })],
      meetings: [], // meeting 999 not loaded
      visits: [],
    });
    expect(counts.momOverdue).toBe(0);
  });

  it("uses per-org admin check — admin in org-1, manager in org-2", () => {
    const counts = computeBadgeCounts({
      myUid: "user-mixed",
      isAdminFor: adminInOrg1Only,
      selectedOrg: null,
      clientUid: null,
      roadmapItems: [
        roadmap({ uid: "r1", org_uid: "org-1", owner: "user-other" }), // admin row → counted
        roadmap({ uid: "r2", org_uid: "org-2", owner: "user-other" }), // not admin & not me → excluded
        roadmap({ uid: "r3", org_uid: "org-2", owner: "user-mixed" }), // not admin but me → counted
      ],
      overdueAPs: [],
      meetings: [],
      visits: [],
    });
    expect(counts.roadmapOverdue).toBe(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix frontend/task-tracker test -- src/__tests__/components/clients/clientsBadgeCounts.test.ts`
Expected: FAIL with "Cannot find module '@/components/clients/clientsBadgeCounts'".

- [ ] **Step 3: Create the pure module**

Create `frontend/task-tracker/src/components/clients/clientsBadgeCounts.ts`:

```ts
import type {
  ClientActionPointDto,
  ClientMeetingDto,
  ClientRoadmapDto,
} from "@/types/api/clients";
import type { ClientVisitDto } from "@/types/api/internalReports";
import { deriveRoadmapStatus } from "./roadmapStatus";

export interface BadgeCounts {
  readonly roadmapOverdue: number;
  readonly momOverdue: number;
  readonly internalCombined: number;
  readonly total: number;
}

export interface ComputeBadgeCountsArgs {
  readonly myUid: string | null;
  readonly isAdminFor: (orgUid: string | null) => boolean;
  readonly selectedOrg: string | null;
  readonly clientUid: string | null;
  readonly roadmapItems: readonly ClientRoadmapDto[];
  readonly overdueAPs: readonly ClientActionPointDto[];
  readonly meetings: readonly ClientMeetingDto[];
  readonly visits: readonly ClientVisitDto[];
}

const ZERO: BadgeCounts = {
  roadmapOverdue: 0,
  momOverdue: 0,
  internalCombined: 0,
  total: 0,
};

export function computeBadgeCounts(args: ComputeBadgeCountsArgs): BadgeCounts {
  const {
    myUid,
    isAdminFor,
    selectedOrg,
    clientUid,
    roadmapItems,
    overdueAPs,
    meetings,
    visits,
  } = args;

  if (!myUid) return ZERO;

  // ── Roadmap ────────────────────────────────────────────────────────────
  let roadmapOverdue = 0;
  for (const r of roadmapItems) {
    if (selectedOrg && r.org_uid !== selectedOrg) continue;
    if (clientUid) {
      if (r.client !== clientUid) continue;
    }
    if (deriveRoadmapStatus(r) !== "Overdue") continue;
    if (isAdminFor(r.org_uid)) {
      roadmapOverdue += 1;
    } else if (r.owner === myUid) {
      roadmapOverdue += 1;
    }
  }

  // ── MOM action points ──────────────────────────────────────────────────
  const meetingsById = new Map<number, ClientMeetingDto>();
  for (const m of meetings) meetingsById.set(m.id, m);

  let momOverdue = 0;
  for (const p of overdueAPs) {
    const m = meetingsById.get(p.meeting);
    if (!m) continue;
    if (selectedOrg && m.org_uid !== selectedOrg) continue;
    if (clientUid && m.client !== clientUid) continue;
    if (isAdminFor(m.org_uid)) {
      momOverdue += 1;
    } else if (p.responsibility === myUid) {
      momOverdue += 1;
    }
  }

  // ── Internal Report (set-deduped by uid) ───────────────────────────────
  const internalUids = new Set<string>();
  for (const v of visits) {
    if (selectedOrg && v.org_uid !== selectedOrg) continue;
    if (clientUid && v.client !== clientUid) continue;
    const admin = isAdminFor(v.org_uid);
    if (admin) {
      if (v.is_overdue || v.current_status === "Pending") {
        internalUids.add(v.uid);
      }
    } else {
      if (v.is_overdue && v.prepared_by === myUid) internalUids.add(v.uid);
      if (v.current_status === "Pending" && v.assigned_manager === myUid) {
        internalUids.add(v.uid);
      }
    }
  }
  const internalCombined = internalUids.size;

  return {
    roadmapOverdue,
    momOverdue,
    internalCombined,
    total: roadmapOverdue + momOverdue + internalCombined,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --prefix frontend/task-tracker test -- src/__tests__/components/clients/clientsBadgeCounts.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/components/clients/clientsBadgeCounts.ts \
        frontend/task-tracker/src/__tests__/components/clients/clientsBadgeCounts.test.ts
git commit -m "feat(clients): add computeBadgeCounts pure function"
```

---

## Task 3: `useClientsBadgeCounts` hook

Wraps the data hooks and memoizes the count computation, exposed for both App and ClientsPage.

**Files:**
- Create: `frontend/task-tracker/src/hooks/useClientsBadgeCounts.ts`

- [ ] **Step 1: Create the hook**

Create `frontend/task-tracker/src/hooks/useClientsBadgeCounts.ts`:

```ts
import { useMemo } from "react";
import { useClientMeetings } from "@/hooks/useClientMeetings";
import { useClientRoadmap } from "@/hooks/useClientRoadmap";
import { useClientVisits } from "@/hooks/useClientVisits";
import { useOverdueActionPoints } from "@/hooks/useOverdueActionPoints";
import { computeBadgeCounts, type BadgeCounts } from "@/components/clients/clientsBadgeCounts";

export interface UseClientsBadgeCountsArgs {
  readonly myUid: string | null;
  readonly isAdminFor: (orgUid: string | null) => boolean;
  readonly selectedOrg: string | null;
  readonly clientUid: string | null;
}

export function useClientsBadgeCounts(args: UseClientsBadgeCountsArgs): BadgeCounts {
  const { items: roadmapItems, loading: roadmapLoading } = useClientRoadmap();
  const { overdue, loading: overdueLoading } = useOverdueActionPoints();
  const { meetings, loading: meetingsLoading } = useClientMeetings();
  const { visits, loading: visitsLoading } = useClientVisits();

  return useMemo(() => {
    if (roadmapLoading || overdueLoading || meetingsLoading || visitsLoading) {
      return { roadmapOverdue: 0, momOverdue: 0, internalCombined: 0, total: 0 };
    }
    return computeBadgeCounts({
      myUid: args.myUid,
      isAdminFor: args.isAdminFor,
      selectedOrg: args.selectedOrg,
      clientUid: args.clientUid,
      roadmapItems,
      overdueAPs: overdue,
      meetings,
      visits,
    });
  }, [
    args.myUid,
    args.isAdminFor,
    args.selectedOrg,
    args.clientUid,
    roadmapItems,
    overdue,
    meetings,
    visits,
    roadmapLoading,
    overdueLoading,
    meetingsLoading,
    visitsLoading,
  ]);
}
```

- [ ] **Step 2: Verify the file type-checks**

Run: `npm --prefix frontend/task-tracker run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/task-tracker/src/hooks/useClientsBadgeCounts.ts
git commit -m "feat(clients): add useClientsBadgeCounts hook"
```

---

## Task 4: Add `badge` prop to `SortableTab`

The reusable nav-tab component. We add the prop here so both the parent Clients tab can render the pill consistently.

**Files:**
- Modify: `frontend/task-tracker/src/components/header/sortableTable.tsx`
- Create: `frontend/task-tracker/src/__tests__/components/header/sortableTab.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/task-tracker/src/__tests__/components/header/sortableTab.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { SortableTab } from "@/components/header/sortableTable";

function wrap(children: React.ReactNode) {
  return (
    <DndContext>
      <SortableContext items={["t"]}>{children}</SortableContext>
    </DndContext>
  );
}

describe("SortableTab badge", () => {
  it("does not render a pill when badge is undefined", () => {
    render(
      wrap(
        <SortableTab
          tab={{ id: "t", label: "Tab", icon: null }}
          isActive={false}
          onClick={() => {}}
        />,
      ),
    );
    expect(screen.queryByLabelText(/overdue/i)).toBeNull();
  });

  it("does not render a pill when badge is 0", () => {
    render(
      wrap(
        <SortableTab
          tab={{ id: "t", label: "Tab", icon: null }}
          isActive={false}
          onClick={() => {}}
          badge={0}
        />,
      ),
    );
    expect(screen.queryByLabelText(/overdue/i)).toBeNull();
  });

  it("renders the badge count when > 0 with an aria-label", () => {
    render(
      wrap(
        <SortableTab
          tab={{ id: "t", label: "Tab", icon: null }}
          isActive={false}
          onClick={() => {}}
          badge={3}
        />,
      ),
    );
    const pill = screen.getByLabelText("3 overdue or pending items");
    expect(pill.textContent).toBe("3");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix frontend/task-tracker test -- src/__tests__/components/header/sortableTab.test.tsx`
Expected: FAIL — current component has no `badge` prop and no aria-labeled pill.

- [ ] **Step 3: Modify `SortableTab` to accept and render the badge**

Replace the contents of `frontend/task-tracker/src/components/header/sortableTable.tsx` with:

```tsx
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { NavTab } from "@/types";

export interface SortableTabProps {
  tab: NavTab;
  isActive: boolean;
  onClick: () => void;
  badge?: number;
}

const pillStyle: React.CSSProperties = {
  marginLeft: 6,
  padding: "1px 7px",
  background: "#dc2626",
  color: "#fff",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1.4,
};

export function SortableTab({ tab, isActive, onClick, badge }: SortableTabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };
  const showBadge = typeof badge === "number" && badge > 0;
  return (
    <button
      ref={setNodeRef}
      style={style}
      className={`nav-tab${isActive ? " active" : ""}${isDragging ? " dragging-tab" : ""}`}
      onClick={onClick}
      {...attributes}
      {...listeners}
    >
      {tab.icon}
      {tab.label}
      {showBadge && (
        <span aria-label={`${badge} overdue or pending items`} style={pillStyle}>
          {badge}
        </span>
      )}
    </button>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --prefix frontend/task-tracker test -- src/__tests__/components/header/sortableTab.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/components/header/sortableTable.tsx \
        frontend/task-tracker/src/__tests__/components/header/sortableTab.test.tsx
git commit -m "feat(header): add optional badge prop to SortableTab"
```

---

## Task 5: Wire `clientsBadgeCount` through NavMenu and Header

Pure plumbing: forward an optional number from Header → NavMenu → the clients tab's `<SortableTab>`.

**Files:**
- Modify: `frontend/task-tracker/src/components/header/NavMenu.tsx`
- Modify: `frontend/task-tracker/src/components/layout/Header.tsx`

- [ ] **Step 1: Add the prop to `NavMenu`**

In `frontend/task-tracker/src/components/header/NavMenu.tsx`, edit the `NavMenuProps` interface (around line 19) — add `clientsBadgeCount?: number`:

```tsx
export interface NavMenuProps {
  view: string;
  onViewChange: (view: string) => void;
  hasInvoiceAccess: boolean;
  hasNoticeAccess: boolean;
  hasMastersAccess: boolean;
  canAccessLeads: boolean;
  canAccessClients: boolean;
  isAdmin: boolean;
  icons: Record<string, React.ReactNode>;
  clientsBadgeCount?: number;
}
```

In the function signature destructuring (around line 31), add `clientsBadgeCount`:

```tsx
export default function NavMenu({
  view,
  onViewChange,
  hasInvoiceAccess,
  hasNoticeAccess,
  hasMastersAccess,
  canAccessLeads,
  canAccessClients,
  isAdmin,
  icons,
  clientsBadgeCount,
}: NavMenuProps) {
```

In the `nav-tabs` rendering (around line 124), change the map callback to pass `badge` for the clients tab only:

```tsx
<nav className="nav-tabs">
  {NAV_TABS.map((tab) => (
    <SortableTab
      key={tab.id}
      tab={tab}
      isActive={view === tab.id}
      onClick={() => onViewChange(tab.id)}
      badge={tab.id === "clients" ? clientsBadgeCount : undefined}
    />
  ))}
  ...
```

- [ ] **Step 2: Add the prop to `Header`**

In `frontend/task-tracker/src/components/layout/Header.tsx`, locate the `HeaderProps` (or equivalent) interface that already declares `canAccessClients: boolean;` (around line 53). Add `clientsBadgeCount?: number;` next to it.

In the function signature destructuring (around line 81), add `clientsBadgeCount,` next to `canAccessClients,`.

In the `<NavMenu …/>` call inside the JSX (around line 666–676), add the prop:

```tsx
<NavMenu
  view={view}
  onViewChange={onViewChange}
  hasInvoiceAccess={hasInvoiceAccess}
  hasNoticeAccess={hasNoticeAccess}
  hasMastersAccess={hasMastersAccess}
  canAccessLeads={canAccessLeads}
  canAccessClients={canAccessClients}
  isAdmin={isAdmin}
  icons={icons}
  clientsBadgeCount={clientsBadgeCount}
/>
```

- [ ] **Step 3: Verify the file type-checks**

Run: `npm --prefix frontend/task-tracker run build`
Expected: build succeeds. Header is invoked from `App.tsx` without `clientsBadgeCount` for now — that's fine because the prop is optional.

- [ ] **Step 4: Commit**

```bash
git add frontend/task-tracker/src/components/header/NavMenu.tsx \
        frontend/task-tracker/src/components/layout/Header.tsx
git commit -m "feat(header): plumb clientsBadgeCount through NavMenu and Header"
```

---

## Task 6: Wire `App.tsx` — call hook, pass to Header

App computes the parent-nav total and forwards it. Gated on `canAccessClients` via the `hasLeadsAccess` analog (we use the existing literal `true` for clients access). When the user has no profile yet, the hook returns zeros — safe to call unconditionally.

**Files:**
- Modify: `frontend/task-tracker/src/App.tsx`

- [ ] **Step 1: Add the hook call**

In `frontend/task-tracker/src/App.tsx`, add the import near the other hook imports (around line 49):

```tsx
import { useClientsBadgeCounts } from "./hooks/useClientsBadgeCounts";
```

Find the helpers destructured from `useAuth()` (around line 52) and extend the destructure to include `isAdminIn`:

```tsx
const { user, profile, signOut, isAdminInAny, isManagerInAny, isAdminIn } = useAuth();
```

After the `selectedOrg` state is declared (around line 102) and the existing `isAdmin` const is computed (around line 60), add **after** the `selectedOrg` state declaration (so `selectedOrg` is in scope):

```tsx
const isAdminFor = useCallback(
  (orgUid: string | null) => (orgUid ? isAdminIn(orgUid) : isAdminInAny()),
  [isAdminIn, isAdminInAny],
);

const clientsBadge = useClientsBadgeCounts({
  myUid: profile?.id ?? null,
  isAdminFor,
  selectedOrg: selectedOrg || null,
  clientUid: null,
});
```

- [ ] **Step 2: Pass the count to Header**

In the same file, find the `<Header …/>` element (around line 380–412). Add the prop after `canAccessClients={true}`:

```tsx
canAccessClients={true}
clientsBadgeCount={clientsBadge.total}
selectedOrg={selectedOrg}
onOrgChange={setSelectedOrg}
```

- [ ] **Step 3: Verify the build still succeeds**

Run: `npm --prefix frontend/task-tracker run build`
Expected: build succeeds.

- [ ] **Step 4: Run lint and the full test suite**

Run: `npm --prefix frontend/task-tracker run lint`
Expected: no errors.

Run: `npm --prefix frontend/task-tracker test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/task-tracker/src/App.tsx
git commit -m "feat(clients): show overdue/pending count on Clients nav tab"
```

---

## Task 7: Wire `ClientsPage` — sub-tab pills

Compute scoped counts for the in-page sub-tabs and render the pill inside each sub-tab button.

**Files:**
- Modify: `frontend/task-tracker/src/pages/ClientsPage.tsx`

- [ ] **Step 1: Add the hook call**

In `frontend/task-tracker/src/pages/ClientsPage.tsx`, add the import near the existing hook imports:

```tsx
import { useClientsBadgeCounts } from "@/hooks/useClientsBadgeCounts";
```

Extend the destructure of `useAuth()` (line 21) to include `isAdminIn`:

```tsx
const { isAdminInAny, isManagerInAny, isAdminIn } = useAuth();
```

After `effectiveClientUid` is computed (around line 43–46), add:

```tsx
const isAdminFor = useMemo(
  () => (orgUid: string | null) => (orgUid ? isAdminIn(orgUid) : isAdminInAny()),
  [isAdminIn, isAdminInAny],
);

const subTabCounts = useClientsBadgeCounts({
  myUid: profile?.id ?? null,
  isAdminFor,
  selectedOrg,
  clientUid: effectiveClientUid || null,
});
```

- [ ] **Step 2: Render the pill inside each sub-tab button**

Locate the sub-tab bar JSX (currently lines 91–128). Replace it with a version that renders the pill after the label:

```tsx
{/* Sub-tab bar */}
<div
  style={{
    display: "flex",
    gap: 6,
    background: "#f1f5f9",
    padding: 4,
    borderRadius: 8,
    width: "fit-content",
    marginBottom: 12,
  }}
>
  {(
    [
      { id: "roadmap", label: "🗺️ Road Map", count: subTabCounts.roadmapOverdue },
      { id: "mom", label: "📋 MOM & Action Points", count: subTabCounts.momOverdue },
      { id: "internal", label: "📝 Internal Report", count: subTabCounts.internalCombined },
    ] as const
  ).map((t) => (
    <button
      key={t.id}
      type="button"
      onClick={() => setSubTab(t.id)}
      style={{
        padding: "7px 18px",
        borderRadius: 6,
        border: "none",
        cursor: "pointer",
        fontSize: 13,
        fontWeight: 600,
        background: subTab === t.id ? "#fff" : "transparent",
        color: subTab === t.id ? "#1e293b" : "#64748b",
        boxShadow: subTab === t.id ? "0 1px 3px rgba(0,0,0,.1)" : "none",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <span>{t.label}</span>
      {t.count > 0 && (
        <span
          aria-label={`${t.count} overdue or pending items`}
          style={{
            padding: "1px 6px",
            background: "#dc2626",
            color: "#fff",
            borderRadius: 999,
            fontSize: 10,
            fontWeight: 700,
            lineHeight: 1.4,
          }}
        >
          {t.count}
        </span>
      )}
    </button>
  ))}
</div>
```

- [ ] **Step 3: Run the build and tests**

Run: `npm --prefix frontend/task-tracker run build`
Expected: build succeeds.

Run: `npm --prefix frontend/task-tracker test`
Expected: all tests pass.

Run: `npm --prefix frontend/task-tracker run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/task-tracker/src/pages/ClientsPage.tsx
git commit -m "feat(clients): show per-tab overdue/pending pills on sub-tabs"
```

---

## Task 8: Manual verification + push

**Files:** none.

- [ ] **Step 1: Start the dev server**

Run: `npm --prefix frontend/task-tracker run dev`
Expected: dev server up at the printed local URL.

- [ ] **Step 2: Verify as admin**

In a browser, sign in as a user with admin role. Open the **Clients** page.

Confirm:
- Each sub-tab (Road Map, MOM & Action Points, Internal Report) shows a red pill with a non-zero count if there are overdue/pending items in scope. Tabs with zero items show no pill.
- The parent **Clients** entry in the top NavMenu shows the sum of the three sub-tab counts.

- [ ] **Step 3: Verify org switch updates both badges**

Change the org switcher in the header. Both the parent nav badge and the sub-tab pills should refresh to reflect the new org's data.

- [ ] **Step 4: Verify in-page client selector updates only sub-tab badges**

Change the **Client** dropdown inside the page. Sub-tab pills should narrow to that client; the parent nav badge stays unchanged.

- [ ] **Step 5: Verify as employee (not admin/manager)**

Sign in as a regular employee. Open Clients. Sub-tab pills should reflect only items where the employee is the assignee:
- Road Map: items where they are `owner`
- MOM: action points where they are `responsibility`
- Internal Report: visits where they are `prepared_by` (and overdue) — pending-approval count is typically zero unless they are also an `assigned_manager` somewhere.

- [ ] **Step 6: Verify live updates via WebSocket**

In a second browser/tab, mark an overdue roadmap item as Completed (set `completion_date`). The sub-tab pill and parent nav badge in the first tab should decrement within a second.

- [ ] **Step 7: Push the branch**

```bash
git push origin Overdue_Notification
```

---

## Notes for the implementer

- The existing top-right "1 overdue action point" red card on the Clients page is **out of scope** — leave it untouched. It uses `filterOverdue` and is org+client-scoped MOM-only, role-agnostic.
- We deliberately do **not** centralize data fetching in a context. App-level and ClientsPage-level calls each mount their own copies of the underlying list hooks. The duplicate fetch cost is small and the code is simpler. Don't refactor this without spec sign-off.
- `useClientMeetings()` (no clientUid) loads all meetings for the user's orgs. The badge module needs only `id`, `org_uid`, and `client` from each — fine for the volume in practice.
- TypeScript path alias `@/…` resolves to `frontend/task-tracker/src/…` per `tsconfig.json`.
- The spec mentioned an optional `ClientsPage.test.tsx` component test. We skip it: the per-tab pill is a thin shell over `useClientsBadgeCounts` (whose pure logic is exhaustively tested in Task 2), and mocking the page's full hook stack would add brittleness without catching real defects. Manual verification in Task 8 covers the rendered output.
