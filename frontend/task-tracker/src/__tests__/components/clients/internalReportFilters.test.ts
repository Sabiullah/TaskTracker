import { describe, expect, it } from "vitest";
import {
  isInternalReportFilterActive,
  matchesPendingMyApproval,
  visitMatches,
  type InternalReportFilters,
} from "@/components/clients/internalReportFilters";
import type { ClientVisitDto } from "@/types/api/internalReports";

function visit(overrides: Partial<ClientVisitDto> = {}): ClientVisitDto {
  return {
    id: 1,
    uid: "v-1",
    org_uid: "org-1",
    client: "c-1",
    client_detail: { id: 10, uid: "c-1", name: "Acme", type: "client", color: "" },
    visit_date: "2026-04-25",
    prepared_by: "u-1",
    prepared_by_detail: null,
    assigned_manager: "u-2",
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

const empty: InternalReportFilters = {
  preparedByUids: [],
  assignedManagerUids: [],
  statuses: [],
  visitMonth: "",
  overdueOnly: false,
  pendingMyApproval: null,
};

describe("isInternalReportFilterActive", () => {
  it("returns false when nothing is set", () => {
    expect(isInternalReportFilterActive(empty)).toBe(false);
  });
  it("returns true when status filter is non-empty", () => {
    expect(isInternalReportFilterActive({ ...empty, statuses: ["Pending"] })).toBe(true);
  });
  it("returns true when overdueOnly is true", () => {
    expect(isInternalReportFilterActive({ ...empty, overdueOnly: true })).toBe(true);
  });
});

describe("visitMatches", () => {
  it("matches when all filters empty", () => {
    expect(visitMatches(visit(), empty)).toBe(true);
  });
  it("excludes when prepared_by uid is filtered out", () => {
    expect(
      visitMatches(visit({ prepared_by: "u-1" }), { ...empty, preparedByUids: ["u-99"] }),
    ).toBe(false);
  });
  it("excludes when status is filtered out", () => {
    expect(
      visitMatches(visit({ current_status: "Approved" }), { ...empty, statuses: ["Pending"] }),
    ).toBe(false);
  });
  it("includes when visit_month matches", () => {
    expect(visitMatches(visit({ visit_date: "2026-04-25" }), { ...empty, visitMonth: "2026-04" })).toBe(true);
  });
  it("excludes when visit_month does not match", () => {
    expect(visitMatches(visit({ visit_date: "2026-03-25" }), { ...empty, visitMonth: "2026-04" })).toBe(false);
  });
  it("includes only overdue when overdueOnly is true", () => {
    expect(visitMatches(visit({ is_overdue: true }), { ...empty, overdueOnly: true })).toBe(true);
    expect(visitMatches(visit({ is_overdue: false }), { ...empty, overdueOnly: true })).toBe(false);
  });
});

describe("matchesPendingMyApproval", () => {
  const approverEverywhere = { myUid: "u-mgr2", canApproveForOrg: () => true };
  const approverNowhere = { myUid: "u-mgr", canApproveForOrg: () => false };

  it("matches when status=Pending and user is the assigned manager", () => {
    expect(
      matchesPendingMyApproval(
        visit({ current_status: "Pending", assigned_manager: "u-mgr" }),
        approverNowhere,
      ),
    ).toBe(true);
  });

  it("matches when status=Pending and user is a manager/admin in the visit's org", () => {
    // Any manager in the org may approve, even when they're not the assigned
    // manager (assigned to u-other here).
    expect(
      matchesPendingMyApproval(
        visit({ current_status: "Pending", assigned_manager: "u-other" }),
        approverEverywhere,
      ),
    ).toBe(true);
  });

  it("does not match when not an org approver and not assigned manager", () => {
    expect(
      matchesPendingMyApproval(
        visit({ current_status: "Pending", assigned_manager: "u-other" }),
        approverNowhere,
      ),
    ).toBe(false);
  });

  it("does not match approved visits even for org approvers", () => {
    expect(
      matchesPendingMyApproval(
        visit({ current_status: "Approved", assigned_manager: "u-other" }),
        approverEverywhere,
      ),
    ).toBe(false);
  });
});

describe("visitMatches with pendingMyApproval", () => {
  const approverEverywhere = { myUid: "u-mgr2", canApproveForOrg: () => true };

  it("an org manager sees a pending visit they don't manage when filter is on", () => {
    expect(
      visitMatches(
        visit({ current_status: "Pending", assigned_manager: "u-other" }),
        { ...empty, pendingMyApproval: approverEverywhere },
      ),
    ).toBe(true);
  });

  it("excludes non-pending visits even for org approvers", () => {
    expect(
      visitMatches(
        visit({ current_status: "Approved", assigned_manager: "u-other" }),
        { ...empty, pendingMyApproval: approverEverywhere },
      ),
    ).toBe(false);
  });

  it("isInternalReportFilterActive is true when pendingMyApproval is set", () => {
    expect(isInternalReportFilterActive({ ...empty, pendingMyApproval: approverEverywhere })).toBe(
      true,
    );
  });
});
