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
