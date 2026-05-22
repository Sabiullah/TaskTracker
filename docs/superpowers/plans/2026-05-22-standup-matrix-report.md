# Daily Standup Matrix Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a List ↔ Matrix view toggle to the Daily Standup page so managers can read a full month of standup priorities as an employee × date table, with smart "Leave / WFH / Holiday" labels in non-submission cells.

**Architecture:** Frontend-only. A new `DailyStandupMatrixView` component re-uses two existing endpoints — `/operational_standups/?month=` (already used by `useOperationalStandups`) and `/attendance/matrix/?month=` (already used by `useAttendanceMatrix`) — and joins them client-side. Pure helper functions (employee derivation, fallback labels, approval tint) live in a separate module for unit testing.

**Tech Stack:** React 19, TypeScript, Vitest + @testing-library/react (jsdom). No backend changes.

**Spec:** [docs/superpowers/specs/2026-05-22-standup-matrix-report-design.md](../specs/2026-05-22-standup-matrix-report-design.md)

---

## File Structure

**Create:**

- `frontend/task-tracker/src/components/pace/standupMatrix.ts` — pure helpers: `uniqueSubmittedEmployees`, `attendanceFallbackLabel`, `approvalTint`. No React. Lets us unit-test the join logic without rendering.
- `frontend/task-tracker/src/components/pace/DailyStandupMatrixView.tsx` — presentational component. Consumes pre-fetched data; no fetches inside.
- `frontend/task-tracker/src/__tests__/components/pace/standupMatrix.test.ts` — unit tests for the pure helpers.
- `frontend/task-tracker/src/__tests__/components/pace/dailyStandupMatrixView.test.tsx` — component tests (jsdom).

**Modify:**

- `frontend/task-tracker/src/pages/DailyStandupPage.tsx` — add `viewMode` toggle state, render the toggle, conditionally call `useAttendanceMatrix(month)` and render `<DailyStandupMatrixView />` when matrix mode is active.
- `frontend/task-tracker/src/__tests__/components/pace/dailyStandupPage.smoke.test.tsx` — extend with a smoke test that the toggle shows up and matrix view renders.

**Not modified:**

- `useOperationalStandups.ts`, `useAttendanceMatrix.ts` — composed at the page level, no signature changes.
- `core/pace/views.py`, `core/attendance/views.py` — no backend changes.

---

## Working Commands

| Action | Command |
| --- | --- |
| Run a single vitest file | `cd frontend/task-tracker && npx vitest --run src/__tests__/components/pace/standupMatrix.test.ts` |
| Run all vitest tests | `cd frontend/task-tracker && npm test` |
| TypeScript build | `cd frontend/task-tracker && npm run build` |
| Lint | `cd frontend/task-tracker && npm run lint` |
| Pre-commit (per memory `feedback_run_precommit_before_push.md`) | `uv run pre-commit run --all-files` |

---

## Task 1: Pure helpers — `uniqueSubmittedEmployees`

**Files:**

- Create: `frontend/task-tracker/src/components/pace/standupMatrix.ts`
- Test: `frontend/task-tracker/src/__tests__/components/pace/standupMatrix.test.ts`

- [ ] **Step 1.1: Create the helpers module with empty exports**

`frontend/task-tracker/src/components/pace/standupMatrix.ts`:

```ts
import type {
  OperationalStandupApprovalDto,
  OperationalStandupDto,
} from "@/types/api";
import type { CellPayload } from "@/utils/matrixCells";

export interface MatrixEmployee {
  readonly uid: string;
  readonly full_name: string;
  readonly org_names: readonly string[];
}

export function uniqueSubmittedEmployees(
  _standups: readonly OperationalStandupDto[],
): MatrixEmployee[] {
  throw new Error("not implemented");
}

export interface FallbackLabel {
  readonly text: string;
  readonly color: string;
}

export function attendanceFallbackLabel(
  _cell: CellPayload | undefined,
): FallbackLabel | null {
  throw new Error("not implemented");
}

export function approvalTint(
  _approvals: readonly OperationalStandupApprovalDto[],
): string {
  throw new Error("not implemented");
}
```

- [ ] **Step 1.2: Write the failing test for `uniqueSubmittedEmployees`**

`frontend/task-tracker/src/__tests__/components/pace/standupMatrix.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  uniqueSubmittedEmployees,
  attendanceFallbackLabel,
  approvalTint,
} from "@/components/pace/standupMatrix";
import type {
  OperationalStandupDto,
  OperationalStandupApprovalDto,
} from "@/types/api";
import type { CellPayload } from "@/utils/matrixCells";

function makeStandup(
  uid: string,
  full_name: string,
  date: string,
  approvals: OperationalStandupApprovalDto[] = [],
): OperationalStandupDto {
  return {
    id: 1,
    uid: `s-${uid}-${date}`,
    profile: uid,
    profile_detail: { id: 1, uid, full_name, username: full_name.toLowerCase() },
    standup_date: date,
    breakthrough_type: "",
    priorities: "x",
    collaboration_need: "",
    remarks: "",
    created_by_detail: null,
    approvals,
    created_at: "",
    updated_at: "",
  };
}

describe("uniqueSubmittedEmployees", () => {
  it("returns empty array when there are no standups", () => {
    expect(uniqueSubmittedEmployees([])).toEqual([]);
  });

  it("dedupes by profile uid and sorts alphabetically by full_name", () => {
    const result = uniqueSubmittedEmployees([
      makeStandup("u-charlie", "Charlie", "2026-05-01"),
      makeStandup("u-alice", "Alice", "2026-05-01"),
      makeStandup("u-alice", "Alice", "2026-05-02"),
      makeStandup("u-bob", "Bob", "2026-05-01"),
    ]);
    expect(result.map((e) => e.full_name)).toEqual(["Alice", "Bob", "Charlie"]);
    expect(result.map((e) => e.uid)).toEqual(["u-alice", "u-bob", "u-charlie"]);
  });

  it("collects union of org_names across an employee's standups", () => {
    const ap = (org_uid: string, org_name: string): OperationalStandupApprovalDto => ({
      uid: `a-${org_uid}`,
      org_uid,
      org_name,
      status: "Approved",
      approved_by_detail: null,
      approved_at: null,
      reviewed_by_detail: null,
      reviewed_at: null,
    });
    const result = uniqueSubmittedEmployees([
      makeStandup("u1", "Alice", "2026-05-01", [ap("o1", "4D"), ap("o2", "YBV")]),
      makeStandup("u1", "Alice", "2026-05-02", [ap("o2", "YBV")]),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.org_names).toEqual(["4D", "YBV"]);
  });
});
```

- [ ] **Step 1.3: Run test, confirm fail**

Run: `cd frontend/task-tracker && npx vitest --run src/__tests__/components/pace/standupMatrix.test.ts`
Expected: 3 failures with `not implemented`.

- [ ] **Step 1.4: Implement `uniqueSubmittedEmployees`**

In `frontend/task-tracker/src/components/pace/standupMatrix.ts`, replace the throwing stub:

```ts
export function uniqueSubmittedEmployees(
  standups: readonly OperationalStandupDto[],
): MatrixEmployee[] {
  const byUid = new Map<string, { full_name: string; orgs: Set<string> }>();
  for (const s of standups) {
    const ref = s.profile_detail;
    const name = ref.full_name || ref.username || "";
    let entry = byUid.get(ref.uid);
    if (!entry) {
      entry = { full_name: name, orgs: new Set<string>() };
      byUid.set(ref.uid, entry);
    }
    for (const a of s.approvals) entry.orgs.add(a.org_name);
  }
  return [...byUid.entries()]
    .map(([uid, v]) => ({
      uid,
      full_name: v.full_name,
      org_names: [...v.orgs].sort(),
    }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}
```

- [ ] **Step 1.5: Run test, confirm pass**

Run: `cd frontend/task-tracker && npx vitest --run src/__tests__/components/pace/standupMatrix.test.ts -t "uniqueSubmittedEmployees"`
Expected: all 3 PASS.

---

## Task 2: Pure helpers — `attendanceFallbackLabel`

**Files:**

- Modify: `frontend/task-tracker/src/components/pace/standupMatrix.ts`
- Test: `frontend/task-tracker/src/__tests__/components/pace/standupMatrix.test.ts`

- [ ] **Step 2.1: Append failing tests for `attendanceFallbackLabel`**

Append at the bottom of `standupMatrix.test.ts`:

```ts
function cell(code: CellPayload["code"], extra: Partial<CellPayload> = {}): CellPayload {
  return { code, ...extra };
}

describe("attendanceFallbackLabel", () => {
  it("returns null when no cell payload", () => {
    expect(attendanceFallbackLabel(undefined)).toBeNull();
  });

  it("maps full-day leave to 'Leave'", () => {
    expect(attendanceFallbackLabel(cell("L"))?.text).toBe("Leave");
  });

  it("maps half-day leave variants to 'Leave'", () => {
    expect(attendanceFallbackLabel(cell("L½"))?.text).toBe("Leave");
    expect(attendanceFallbackLabel(cell("L½+H"))?.text).toBe("Leave");
  });

  it("maps WFH and WFH-pending to 'WFH'", () => {
    expect(attendanceFallbackLabel(cell("WFH"))?.text).toBe("WFH");
    expect(attendanceFallbackLabel(cell("WP"))?.text).toBe("WFH");
  });

  it("maps half-day attendance to 'Half Day'", () => {
    expect(attendanceFallbackLabel(cell("H"))?.text).toBe("Half Day");
  });

  it("maps HD with holiday_name to the holiday name", () => {
    expect(
      attendanceFallbackLabel(cell("HD", { holiday_name: "Independence Day" }))?.text,
    ).toBe("Independence Day");
  });

  it("maps HD with no holiday_name to 'Holiday'", () => {
    expect(attendanceFallbackLabel(cell("HD"))?.text).toBe("Holiday");
  });

  it("maps holiday-worked to 'Worked on holiday'", () => {
    expect(attendanceFallbackLabel(cell("HW"))?.text).toBe("Worked on holiday");
  });

  it("maps open-punch to 'Open punch'", () => {
    expect(attendanceFallbackLabel(cell("?"))?.text).toBe("Open punch");
  });

  it("returns null for P and A — no informative fallback", () => {
    expect(attendanceFallbackLabel(cell("P"))).toBeNull();
    expect(attendanceFallbackLabel(cell("A"))).toBeNull();
  });
});
```

- [ ] **Step 2.2: Run test, confirm fail**

Run: `cd frontend/task-tracker && npx vitest --run src/__tests__/components/pace/standupMatrix.test.ts -t "attendanceFallbackLabel"`
Expected: 10 failures with `not implemented`.

- [ ] **Step 2.3: Implement `attendanceFallbackLabel`**

In `standupMatrix.ts`, replace the throwing stub:

```ts
export function attendanceFallbackLabel(
  cell: CellPayload | undefined,
): FallbackLabel | null {
  if (!cell) return null;
  switch (cell.code) {
    case "L":
    case "L½":
    case "L½+H":
      return { text: "Leave", color: "#7c3aed" };
    case "WFH":
    case "WP":
      return { text: "WFH", color: "#0e7490" };
    case "H":
      return { text: "Half Day", color: "#92400e" };
    case "HD":
      return { text: cell.holiday_name ?? "Holiday", color: "#64748b" };
    case "HW":
      return { text: "Worked on holiday", color: "#155e75" };
    case "?":
      return { text: "Open punch", color: "#dc2626" };
    case "P":
    case "A":
    default:
      return null;
  }
}
```

- [ ] **Step 2.4: Run test, confirm pass**

Run: `cd frontend/task-tracker && npx vitest --run src/__tests__/components/pace/standupMatrix.test.ts -t "attendanceFallbackLabel"`
Expected: all 10 PASS.

---

## Task 3: Pure helpers — `approvalTint`

**Files:**

- Modify: `frontend/task-tracker/src/components/pace/standupMatrix.ts`
- Test: `frontend/task-tracker/src/__tests__/components/pace/standupMatrix.test.ts`

- [ ] **Step 3.1: Append failing tests for `approvalTint`**

Append at the bottom of `standupMatrix.test.ts`:

```ts
function makeApproval(
  status: "Pending" | "Approved",
): OperationalStandupApprovalDto {
  return {
    uid: `ap-${status}-${Math.random()}`,
    org_uid: "o1",
    org_name: "Org",
    status,
    approved_by_detail: null,
    approved_at: null,
    reviewed_by_detail: null,
    reviewed_at: null,
  };
}

describe("approvalTint", () => {
  it("returns 'transparent' when no approvals exist", () => {
    expect(approvalTint([])).toBe("transparent");
  });

  it("returns the green tint when every approval is Approved", () => {
    expect(approvalTint([makeApproval("Approved"), makeApproval("Approved")])).toBe(
      "#16a34a",
    );
  });

  it("returns the amber tint when any approval is Pending", () => {
    expect(approvalTint([makeApproval("Approved"), makeApproval("Pending")])).toBe(
      "#d97706",
    );
  });
});
```

- [ ] **Step 3.2: Run test, confirm fail**

Run: `cd frontend/task-tracker && npx vitest --run src/__tests__/components/pace/standupMatrix.test.ts -t "approvalTint"`
Expected: 3 failures.

- [ ] **Step 3.3: Implement `approvalTint`**

In `standupMatrix.ts`, replace the throwing stub:

```ts
export function approvalTint(
  approvals: readonly OperationalStandupApprovalDto[],
): string {
  if (approvals.length === 0) return "transparent";
  const anyPending = approvals.some((a) => a.status === "Pending");
  return anyPending ? "#d97706" : "#16a34a";
}
```

- [ ] **Step 3.4: Run all helper tests, confirm pass**

Run: `cd frontend/task-tracker && npx vitest --run src/__tests__/components/pace/standupMatrix.test.ts`
Expected: all 16 PASS.

- [ ] **Step 3.5: Commit Tasks 1–3**

```bash
git add frontend/task-tracker/src/components/pace/standupMatrix.ts \
        frontend/task-tracker/src/__tests__/components/pace/standupMatrix.test.ts
git commit -m "feat(pace): pure helpers for Daily Standup matrix view"
```

---

## Task 4: `DailyStandupMatrixView` — empty state

**Files:**

- Create: `frontend/task-tracker/src/components/pace/DailyStandupMatrixView.tsx`
- Test: `frontend/task-tracker/src/__tests__/components/pace/dailyStandupMatrixView.test.tsx`

- [ ] **Step 4.1: Stub the component**

`frontend/task-tracker/src/components/pace/DailyStandupMatrixView.tsx`:

```tsx
import type { OperationalStandupDto } from "@/types/api";
import type { MatrixPayload } from "@/hooks/useAttendanceMatrix";

export interface DailyStandupMatrixViewProps {
  readonly month: string;
  readonly standups: readonly OperationalStandupDto[];
  readonly attendanceMatrix: MatrixPayload | null;
  readonly loading: boolean;
}

export function DailyStandupMatrixView(
  _props: DailyStandupMatrixViewProps,
): JSX.Element {
  return <div />;
}
```

- [ ] **Step 4.2: Write failing empty-state test**

`frontend/task-tracker/src/__tests__/components/pace/dailyStandupMatrixView.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import { DailyStandupMatrixView } from "@/components/pace/DailyStandupMatrixView";
import type { MatrixPayload } from "@/hooks/useAttendanceMatrix";

beforeEach(() => cleanup());

const emptyMatrix: MatrixPayload = {
  employees: [],
  dates: [
    { date: "2026-05-01", weekday: "Fri", is_holiday: false, is_override: false, holiday_name: null },
  ],
  cells: {},
};

describe("DailyStandupMatrixView empty state", () => {
  it("shows 'No standup entries this month' when standups is empty", () => {
    render(
      <DailyStandupMatrixView
        month="2026-05"
        standups={[]}
        attendanceMatrix={emptyMatrix}
        loading={false}
      />,
    );
    expect(screen.getByText(/No standup entries this month/i)).toBeTruthy();
  });

  it("shows a loading indicator when loading=true and no data yet", () => {
    render(
      <DailyStandupMatrixView
        month="2026-05"
        standups={[]}
        attendanceMatrix={null}
        loading={true}
      />,
    );
    expect(screen.getByText(/Loading matrix/i)).toBeTruthy();
  });
});
```

- [ ] **Step 4.3: Run test, confirm fail**

Run: `cd frontend/task-tracker && npx vitest --run src/__tests__/components/pace/dailyStandupMatrixView.test.tsx`
Expected: 2 failures (text not found).

- [ ] **Step 4.4: Implement empty + loading states**

Replace the body of `DailyStandupMatrixView.tsx`:

```tsx
import { useMemo, type CSSProperties } from "react";
import type {
  OperationalStandupApprovalDto,
  OperationalStandupDto,
} from "@/types/api";
import type { MatrixPayload } from "@/hooks/useAttendanceMatrix";
import type { CellPayload } from "@/utils/matrixCells";
import {
  approvalTint,
  attendanceFallbackLabel,
  uniqueSubmittedEmployees,
} from "./standupMatrix";

export interface DailyStandupMatrixViewProps {
  readonly month: string;
  readonly standups: readonly OperationalStandupDto[];
  readonly attendanceMatrix: MatrixPayload | null;
  readonly loading: boolean;
}

const wrap: CSSProperties = {
  overflow: "auto",
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  maxHeight: "calc(100vh - 320px)",
};

const empty: CSSProperties = {
  padding: 24,
  textAlign: "center",
  color: "#94a3b8",
  fontSize: 13,
};

export function DailyStandupMatrixView({
  standups,
  attendanceMatrix,
  loading,
}: DailyStandupMatrixViewProps): JSX.Element {
  const employees = useMemo(() => uniqueSubmittedEmployees(standups), [standups]);

  if (loading && !attendanceMatrix && standups.length === 0) {
    return <div style={empty}>Loading matrix…</div>;
  }

  if (employees.length === 0) {
    return (
      <div style={wrap}>
        <div style={empty}>No standup entries this month.</div>
      </div>
    );
  }

  return <div style={wrap}>{/* table — populated in later tasks */}</div>;
}
```

- [ ] **Step 4.5: Run test, confirm pass**

Run: `cd frontend/task-tracker && npx vitest --run src/__tests__/components/pace/dailyStandupMatrixView.test.tsx`
Expected: 2 PASS.

---

## Task 5: `DailyStandupMatrixView` — render rows and cells with standup content

**Files:**

- Modify: `frontend/task-tracker/src/components/pace/DailyStandupMatrixView.tsx`
- Test: `frontend/task-tracker/src/__tests__/components/pace/dailyStandupMatrixView.test.tsx`

- [ ] **Step 5.1: Append failing tests for row rendering and entry cells**

Append at the bottom of `dailyStandupMatrixView.test.tsx`:

```tsx
import type {
  OperationalStandupApprovalDto,
  OperationalStandupDto,
} from "@/types/api";

function makeStandup(
  uid: string,
  full_name: string,
  date: string,
  priorities: string,
  breakthrough_type: "Breakdown" | "Breakthrough" | "" = "",
  approvals: OperationalStandupApprovalDto[] = [],
): OperationalStandupDto {
  return {
    id: 1,
    uid: `s-${uid}-${date}`,
    profile: uid,
    profile_detail: { id: 1, uid, full_name, username: full_name.toLowerCase() },
    standup_date: date,
    breakthrough_type,
    priorities,
    collaboration_need: "",
    remarks: "",
    created_by_detail: null,
    approvals,
    created_at: "",
    updated_at: "",
  };
}

const twoDayMatrix: MatrixPayload = {
  employees: [],
  dates: [
    { date: "2026-05-01", weekday: "Fri", is_holiday: false, is_override: false, holiday_name: null },
    { date: "2026-05-02", weekday: "Sat", is_holiday: false, is_override: false, holiday_name: null },
  ],
  cells: {},
};

describe("DailyStandupMatrixView rows", () => {
  it("renders one row per unique submitted employee, sorted alphabetically", () => {
    const standups = [
      makeStandup("u-bob", "Bob", "2026-05-01", "Bob priorities"),
      makeStandup("u-alice", "Alice", "2026-05-01", "Alice priorities"),
      makeStandup("u-alice", "Alice", "2026-05-02", "Alice day 2"),
    ];
    const { container } = render(
      <DailyStandupMatrixView
        month="2026-05"
        standups={standups}
        attendanceMatrix={twoDayMatrix}
        loading={false}
      />,
    );
    const bodyRows = container.querySelectorAll("tbody tr");
    expect(bodyRows).toHaveLength(2);
    expect(bodyRows[0]!.textContent).toContain("Alice");
    expect(bodyRows[1]!.textContent).toContain("Bob");
  });

  it("renders the full priorities text wrapped (white-space: pre-wrap)", () => {
    const longText = "1. First task\n2. Second task that is a bit longer\n3. Third";
    render(
      <DailyStandupMatrixView
        month="2026-05"
        standups={[makeStandup("u1", "Alice", "2026-05-01", longText)]}
        attendanceMatrix={twoDayMatrix}
        loading={false}
      />,
    );
    const node = screen.getByText((_, el) => el?.textContent === longText);
    expect(node).toBeTruthy();
    expect(getComputedStyle(node).whiteSpace).toBe("pre-wrap");
  });

  it("renders a BT chip for Breakthrough entries and BD for Breakdowns", () => {
    render(
      <DailyStandupMatrixView
        month="2026-05"
        standups={[
          makeStandup("u1", "Alice", "2026-05-01", "p", "Breakthrough"),
          makeStandup("u2", "Bob", "2026-05-01", "p", "Breakdown"),
        ]}
        attendanceMatrix={twoDayMatrix}
        loading={false}
      />,
    );
    expect(screen.getByText("BT")).toBeTruthy();
    expect(screen.getByText("BD")).toBeTruthy();
  });

  it("does not render a type chip when breakthrough_type is empty", () => {
    render(
      <DailyStandupMatrixView
        month="2026-05"
        standups={[makeStandup("u1", "Alice", "2026-05-01", "p", "")]}
        attendanceMatrix={twoDayMatrix}
        loading={false}
      />,
    );
    expect(screen.queryByText("BT")).toBeNull();
    expect(screen.queryByText("BD")).toBeNull();
  });
});
```

- [ ] **Step 5.2: Run test, confirm fail**

Run: `cd frontend/task-tracker && npx vitest --run src/__tests__/components/pace/dailyStandupMatrixView.test.tsx -t "DailyStandupMatrixView rows"`
Expected: 4 failures.

- [ ] **Step 5.3: Implement the table with entry cells**

Replace the contents of `DailyStandupMatrixView.tsx` with the full version below (this supersedes the Task 4 stub):

```tsx
import { useMemo, type CSSProperties } from "react";
import type {
  OperationalStandupApprovalDto,
  OperationalStandupDto,
} from "@/types/api";
import type { MatrixPayload } from "@/hooks/useAttendanceMatrix";
import type { CellPayload } from "@/utils/matrixCells";
import {
  approvalTint,
  attendanceFallbackLabel,
  uniqueSubmittedEmployees,
} from "./standupMatrix";

export interface DailyStandupMatrixViewProps {
  readonly month: string;
  readonly standups: readonly OperationalStandupDto[];
  readonly attendanceMatrix: MatrixPayload | null;
  readonly loading: boolean;
}

const wrap: CSSProperties = {
  overflow: "auto",
  background: "#fff",
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  maxHeight: "calc(100vh - 320px)",
};

const empty: CSSProperties = {
  padding: 24,
  textAlign: "center",
  color: "#94a3b8",
  fontSize: 13,
};

const empCell: CSSProperties = {
  padding: "6px 10px",
  fontSize: 12,
  fontWeight: 600,
  color: "#1e293b",
  borderBottom: "1px solid #e2e8f0",
  whiteSpace: "nowrap",
  background: "#fff",
  position: "sticky",
  left: 0,
  zIndex: 1,
  verticalAlign: "top",
  minWidth: 180,
};

const headCell: CSSProperties = {
  padding: 6,
  fontSize: 11,
  fontWeight: 700,
  color: "#475569",
  textAlign: "center",
  borderBottom: "1px solid #e2e8f0",
  background: "#fff",
  position: "sticky",
  top: 0,
  zIndex: 2,
  minWidth: 220,
};

const dataCell: CSSProperties = {
  padding: 8,
  fontSize: 12,
  color: "#1e293b",
  borderBottom: "1px solid #f1f5f9",
  borderLeft: "3px solid transparent",
  verticalAlign: "top",
  minWidth: 220,
  maxWidth: 280,
  whiteSpace: "pre-wrap",
};

const chip = (bg: string, color: string): CSSProperties => ({
  display: "inline-block",
  background: bg,
  color,
  fontSize: 10,
  fontWeight: 700,
  padding: "1px 6px",
  borderRadius: 4,
  marginBottom: 4,
});

const fallback: CSSProperties = {
  fontStyle: "italic",
  color: "#94a3b8",
  fontSize: 11,
};

function dayLabel(date: string): string {
  return String(parseInt(date.slice(8), 10));
}

interface EntryCellProps {
  readonly entry: OperationalStandupDto;
}

function EntryCell({ entry }: EntryCellProps): JSX.Element {
  const tint = approvalTint(entry.approvals);
  const style: CSSProperties = { ...dataCell, borderLeftColor: tint };
  const title =
    `Collaboration: ${entry.collaboration_need || "—"}\n` +
    `Remarks: ${entry.remarks || "—"}`;
  return (
    <td style={style} title={title}>
      {entry.breakthrough_type === "Breakthrough" && (
        <span style={chip("#dcfce7", "#166534")}>BT</span>
      )}
      {entry.breakthrough_type === "Breakdown" && (
        <span style={chip("#fed7aa", "#9a3412")}>BD</span>
      )}
      <div>{entry.priorities}</div>
    </td>
  );
}

interface FallbackCellProps {
  readonly cell: CellPayload | undefined;
}

function FallbackCell({ cell }: FallbackCellProps): JSX.Element {
  const label = attendanceFallbackLabel(cell);
  return (
    <td style={dataCell}>
      {label ? (
        <span style={{ ...fallback, color: label.color }}>{label.text}</span>
      ) : (
        <span style={fallback}>—</span>
      )}
    </td>
  );
}

export function DailyStandupMatrixView({
  standups,
  attendanceMatrix,
  loading,
}: DailyStandupMatrixViewProps): JSX.Element {
  const employees = useMemo(() => uniqueSubmittedEmployees(standups), [standups]);

  const byEmpDate = useMemo(() => {
    const m = new Map<string, Map<string, OperationalStandupDto>>();
    for (const s of standups) {
      const empUid = s.profile_detail.uid;
      let inner = m.get(empUid);
      if (!inner) {
        inner = new Map();
        m.set(empUid, inner);
      }
      inner.set(s.standup_date, s);
    }
    return m;
  }, [standups]);

  const dates = attendanceMatrix?.dates ?? [];

  if (loading && !attendanceMatrix && standups.length === 0) {
    return <div style={empty}>Loading matrix…</div>;
  }

  if (employees.length === 0) {
    return (
      <div style={wrap}>
        <div style={empty}>No standup entries this month.</div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <table style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...empCell, ...headCell, zIndex: 3, minWidth: 180 }}>
              Employee
            </th>
            {dates.map((d) => {
              const isHoliday = d.is_holiday || (d.weekday === "Sun" && !d.is_override);
              return (
                <th
                  key={d.date}
                  style={{
                    ...headCell,
                    background: isHoliday ? "#f1f5f9" : "#fff",
                  }}
                >
                  <div style={{ fontWeight: 500, color: "#94a3b8" }}>{d.weekday}</div>
                  <div>{dayLabel(d.date)}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {employees.map((emp) => {
            const inner = byEmpDate.get(emp.uid);
            return (
              <tr key={emp.uid}>
                <td style={empCell}>
                  <div>{emp.full_name}</div>
                  {emp.org_names.length > 0 && (
                    <div style={{ fontSize: 10, fontWeight: 500, color: "#94a3b8" }}>
                      {emp.org_names.join(" · ")}
                    </div>
                  )}
                </td>
                {dates.map((d) => {
                  const entry = inner?.get(d.date);
                  if (entry) return <EntryCell key={d.date} entry={entry} />;
                  const cell = attendanceMatrix?.cells[emp.uid]?.[d.date];
                  return <FallbackCell key={d.date} cell={cell} />;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 5.4: Run row tests, confirm pass**

Run: `cd frontend/task-tracker && npx vitest --run src/__tests__/components/pace/dailyStandupMatrixView.test.tsx`
Expected: all tests in the file PASS.

---

## Task 6: `DailyStandupMatrixView` — smart fallback cells and approval tint

**Files:**

- Test: `frontend/task-tracker/src/__tests__/components/pace/dailyStandupMatrixView.test.tsx`

> The implementation already covers these from Task 5. This task adds the regression tests that lock the behaviour in.

- [ ] **Step 6.1: Append fallback and tint tests**

Append at the bottom of `dailyStandupMatrixView.test.tsx`:

```tsx
const fiveDayMatrix: MatrixPayload = {
  employees: [],
  dates: [
    { date: "2026-05-04", weekday: "Mon", is_holiday: false, is_override: false, holiday_name: null },
    { date: "2026-05-05", weekday: "Tue", is_holiday: false, is_override: false, holiday_name: null },
    { date: "2026-05-06", weekday: "Wed", is_holiday: false, is_override: false, holiday_name: null },
    { date: "2026-05-07", weekday: "Thu", is_holiday: false, is_override: false, holiday_name: null },
    { date: "2026-05-08", weekday: "Fri", is_holiday: false, is_override: false, holiday_name: null },
  ],
  cells: {
    "u1": {
      "2026-05-05": { code: "L" },
      "2026-05-06": { code: "WFH" },
      "2026-05-07": { code: "HD", holiday_name: "Founders Day" },
      // 2026-05-08 left unset → should fall back to dash
    },
  },
};

describe("DailyStandupMatrixView fallback cells", () => {
  it("renders Leave / WFH / Holiday-name / dash for non-submission cells", () => {
    render(
      <DailyStandupMatrixView
        month="2026-05"
        standups={[makeStandup("u1", "Alice", "2026-05-04", "Alice priorities")]}
        attendanceMatrix={fiveDayMatrix}
        loading={false}
      />,
    );
    expect(screen.getByText("Leave")).toBeTruthy();
    expect(screen.getByText("WFH")).toBeTruthy();
    expect(screen.getByText("Founders Day")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
  });
});

function ap(status: "Pending" | "Approved"): OperationalStandupApprovalDto {
  return {
    uid: `ap-${status}-${Math.random()}`,
    org_uid: "o1",
    org_name: "Org",
    status,
    approved_by_detail: null,
    approved_at: null,
    reviewed_by_detail: null,
    reviewed_at: null,
  };
}

describe("DailyStandupMatrixView approval tint", () => {
  it("applies green left border when all approvals are Approved", () => {
    const { container } = render(
      <DailyStandupMatrixView
        month="2026-05"
        standups={[
          makeStandup("u1", "Alice", "2026-05-01", "All approved", "", [
            ap("Approved"),
            ap("Approved"),
          ]),
        ]}
        attendanceMatrix={twoDayMatrix}
        loading={false}
      />,
    );
    const cellWithText = [...container.querySelectorAll("td")].find(
      (n) => n.textContent === "All approved",
    );
    expect(cellWithText).toBeTruthy();
    expect(cellWithText!.style.borderLeftColor).toBe("rgb(22, 163, 74)");
  });

  it("applies amber left border when any approval is Pending", () => {
    const { container } = render(
      <DailyStandupMatrixView
        month="2026-05"
        standups={[
          makeStandup("u1", "Alice", "2026-05-01", "Any pending", "", [
            ap("Approved"),
            ap("Pending"),
          ]),
        ]}
        attendanceMatrix={twoDayMatrix}
        loading={false}
      />,
    );
    const cellWithText = [...container.querySelectorAll("td")].find(
      (n) => n.textContent === "Any pending",
    );
    expect(cellWithText!.style.borderLeftColor).toBe("rgb(217, 119, 6)");
  });
});
```

- [ ] **Step 6.2: Run tests, confirm pass**

Run: `cd frontend/task-tracker && npx vitest --run src/__tests__/components/pace/dailyStandupMatrixView.test.tsx`
Expected: every test in the file PASS.

- [ ] **Step 6.3: Commit Tasks 4–6**

```bash
git add frontend/task-tracker/src/components/pace/DailyStandupMatrixView.tsx \
        frontend/task-tracker/src/__tests__/components/pace/dailyStandupMatrixView.test.tsx
git commit -m "feat(pace): Daily Standup matrix view component"
```

---

## Task 7: Wire the toggle into `DailyStandupPage`

**Files:**

- Modify: `frontend/task-tracker/src/pages/DailyStandupPage.tsx`
- Modify: `frontend/task-tracker/src/__tests__/components/pace/dailyStandupPage.smoke.test.tsx`

- [ ] **Step 7.1: Extend the smoke test with toggle and matrix render assertions**

Replace the entire contents of `frontend/task-tracker/src/__tests__/components/pace/dailyStandupPage.smoke.test.tsx` with:

```tsx
// @vitest-environment jsdom
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import DailyStandupPage from "@/pages/DailyStandupPage";

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(async (url: string) => {
    if (url.startsWith("/operational_standups/?month=")) {
      return [
        {
          id: 1,
          uid: "s1",
          profile: "u1",
          profile_detail: { id: 1, uid: "u1", full_name: "Alice", username: "alice" },
          standup_date: "2026-05-04",
          breakthrough_type: "Breakthrough",
          priorities: "Build the matrix view",
          collaboration_need: "",
          remarks: "",
          created_by_detail: null,
          approvals: [],
          created_at: "",
          updated_at: "",
        },
      ];
    }
    if (url.startsWith("/operational_standups/roster/")) {
      return [
        {
          profile: { id: 1, uid: "u1", full_name: "Alice", username: "alice" },
          entry: null,
          approvals: [],
          can_edit: true,
        },
      ];
    }
    if (url.startsWith("/attendance/matrix/")) {
      return {
        employees: [{ uid: "u1", full_name: "Alice", org_uids: ["o1"] }],
        dates: [
          { date: "2026-05-04", weekday: "Mon", is_holiday: false, is_override: false, holiday_name: null },
        ],
        cells: { u1: { "2026-05-04": { code: "P" } } },
      };
    }
    return [];
  }),
  apiPost: vi.fn(async () => ({})),
  apiPatch: vi.fn(async () => ({})),
  ApiError: class ApiError extends Error {},
  ws: { subscribe: () => () => {} },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    isAdminInAny: () => false,
    isManagerInAny: () => false,
  }),
}));

beforeEach(() => cleanup());

describe("DailyStandupPage", () => {
  it("renders title and date sections in default List view", async () => {
    render(<DailyStandupPage profile={null} profiles={[]} selectedOrg="" />);
    await waitFor(() => {
      expect(screen.getByText(/Daily Standup/i)).toBeTruthy();
    });
  });

  it("shows List and Matrix toggle buttons", async () => {
    render(<DailyStandupPage profile={null} profiles={[]} selectedOrg="" />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^List$/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /^Matrix$/i })).toBeTruthy();
    });
  });

  it("switches to the matrix view and renders an employee row when Matrix is clicked", async () => {
    render(<DailyStandupPage profile={null} profiles={[]} selectedOrg="" />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Matrix$/i })).toBeTruthy();
    });
    // List view should NOT render priorities text from the matrix.
    expect(screen.queryByText("Build the matrix view")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Matrix$/i }));
    await waitFor(() => {
      expect(screen.getByText("Build the matrix view")).toBeTruthy();
      expect(screen.getByText("Alice")).toBeTruthy();
    });
  });
});
```

- [ ] **Step 7.2: Run test, confirm fail**

Run: `cd frontend/task-tracker && npx vitest --run src/__tests__/components/pace/dailyStandupPage.smoke.test.tsx`
Expected: 2 new tests FAIL (toggle buttons not found, "Build the matrix view" never appears).

- [ ] **Step 7.3: Modify `DailyStandupPage.tsx` to add toggle and matrix view**

Open `frontend/task-tracker/src/pages/DailyStandupPage.tsx` and apply the changes below.

a) Add imports at the top (after the existing `DailyStandupAddModal` import):

```tsx
import { DailyStandupMatrixView } from "@/components/pace/DailyStandupMatrixView";
import { useAttendanceMatrix } from "@/hooks/useAttendanceMatrix";
```

b) Inside `DailyStandupPage`, just after the existing `const [showAdd, setShowAdd] = useState(false);` line, add the view-mode state:

```tsx
  const [viewMode, setViewMode] = useState<"list" | "matrix">("list");
```

c) Also after that, fetch attendance matrix data. React hook rules forbid conditional calls, so we always call the hook; the result is small and reused if the user toggles between views. Whether to render the result is controlled by `viewMode` below.

```tsx
  const { data: attendanceMatrix, loading: attendanceLoading } = useAttendanceMatrix(month);
```

d) Replace the header `<div>` block (the one containing the `📋 Daily Standup` title and the right-aligned controls) with a version that includes the toggle. Find:

```tsx
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div className="page-title">📋 Daily Standup</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            style={{ padding: "6px 10px", fontSize: 13 }}
          />
          {canAdd && (
            <button
              onClick={() => setShowAdd(true)}
              style={{
                padding: "7px 14px", background: "#2563eb", color: "#fff",
                border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 12,
              }}
            >
              + Add Entry
            </button>
          )}
        </div>
      </div>
```

…and replace it with:

```tsx
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div className="page-title">📋 Daily Standup</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div
            style={{
              display: "inline-flex",
              border: "1px solid #cbd5e1",
              borderRadius: 6,
              overflow: "hidden",
            }}
          >
            {(["list", "matrix"] as const).map((mode) => {
              const active = viewMode === mode;
              return (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  style={{
                    padding: "6px 12px",
                    background: active ? "#2563eb" : "#fff",
                    color: active ? "#fff" : "#1e293b",
                    border: "none",
                    cursor: "pointer",
                    fontWeight: 700,
                    fontSize: 12,
                    textTransform: "capitalize",
                  }}
                >
                  {mode}
                </button>
              );
            })}
          </div>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            style={{ padding: "6px 10px", fontSize: 13 }}
          />
          {canAdd && (
            <button
              onClick={() => setShowAdd(true)}
              style={{
                padding: "7px 14px", background: "#2563eb", color: "#fff",
                border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 12,
              }}
            >
              + Add Entry
            </button>
          )}
        </div>
      </div>
```

e) Replace the `{dateGroups.map(([date, rows]) => {...})}` block with a conditional render. Find:

```tsx
      {dateGroups.map(([date, rows]) => {
        const pendingCount = rows.reduce(
          (acc, r) => acc + r.approvals.filter((a) => a.status === "Pending").length,
          0,
        );
        return (
          <DailyStandupDateSection
            key={date}
            date={date}
            rows={rows}
            defaultExpanded={date === today}
            adminOrgs={adminOrgs}
            pendingCount={pendingCount}
            isAdmin={isAdmin}
            onSave={handleSave}
            onApprove={handleApprove}
            onReview={handleReview}
            onFinalReview={handleFinalReview}
          />
        );
      })}
```

…and replace it with:

```tsx
      {viewMode === "list" &&
        dateGroups.map(([date, rows]) => {
          const pendingCount = rows.reduce(
            (acc, r) => acc + r.approvals.filter((a) => a.status === "Pending").length,
            0,
          );
          return (
            <DailyStandupDateSection
              key={date}
              date={date}
              rows={rows}
              defaultExpanded={date === today}
              adminOrgs={adminOrgs}
              pendingCount={pendingCount}
              isAdmin={isAdmin}
              onSave={handleSave}
              onApprove={handleApprove}
              onReview={handleReview}
              onFinalReview={handleFinalReview}
            />
          );
        })}

      {viewMode === "matrix" && (
        <DailyStandupMatrixView
          month={month}
          standups={standups}
          attendanceMatrix={attendanceMatrix}
          loading={attendanceLoading}
        />
      )}
```

- [ ] **Step 7.4: Run smoke tests, confirm pass**

Run: `cd frontend/task-tracker && npx vitest --run src/__tests__/components/pace/dailyStandupPage.smoke.test.tsx`
Expected: all 3 tests PASS.

- [ ] **Step 7.5: Commit Task 7**

```bash
git add frontend/task-tracker/src/pages/DailyStandupPage.tsx \
        frontend/task-tracker/src/__tests__/components/pace/dailyStandupPage.smoke.test.tsx
git commit -m "feat(pace): List/Matrix toggle on Daily Standup page"
```

---

## Task 8: Final verification and push

**Files:** none new.

- [ ] **Step 8.1: Run the full frontend test suite**

Run: `cd frontend/task-tracker && npm test`
Expected: every test PASS, no warnings about act() or unhandled promises.

- [ ] **Step 8.2: TypeScript build**

Run: `cd frontend/task-tracker && npm run build`
Expected: no type errors, build completes.

- [ ] **Step 8.3: Lint**

Run: `cd frontend/task-tracker && npm run lint`
Expected: no errors.

- [ ] **Step 8.4: Pre-commit (per `feedback_run_precommit_before_push.md`)**

Run from repo root: `uv run pre-commit run --all-files`
Expected: all hooks PASS. This is what CI runs — covers ruff, format, line-endings, mypy, pyright, eslint, tsc, and frontend build.

- [ ] **Step 8.5: Push (per `feedback_auto_push.md`)**

Run: `git push -u origin StandingMeet_Rpt`
Expected: branch tracked on origin.

---

## Notes for the executing engineer

- **Why two endpoints, not one?** The spec rejected a backend matrix endpoint to avoid duplicating the attendance-matrix wiring. Both endpoints are already served and tested; we're consumers. If you find yourself tempted to write Python, stop and re-read the spec.
- **`useAttendanceMatrix` is always called.** Hooks must be called unconditionally. The data is small and the WS subscription is already in place; calling it in List view costs nothing perceptible and keeps the hook order stable.
- **Don't truncate `priorities`.** The user explicitly asked for the full text to wrap. The `max-width: 280px` cap is to keep the table from blowing out horizontally — text wraps inside that bound.
- **Sticky positioning.** The employee column uses `position: sticky; left: 0` and the header row uses `position: sticky; top: 0`. The corner cell needs `zIndex: 3` so it sits on top of both axes.
- **No edit-from-matrix.** Editing remains a List-view affordance. If a user clicks a matrix cell, nothing happens — that's intentional.
