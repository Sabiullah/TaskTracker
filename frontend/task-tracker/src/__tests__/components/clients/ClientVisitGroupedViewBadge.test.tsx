// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ClientVisitGroupedView from "@/components/clients/ClientVisitGroupedView";
import type { VisitGroup } from "@/components/clients/internalReportGrouping";
import type { ClientVisitDto } from "@/types/api/internalReports";

afterEach(() => cleanup());

function visit(uid: string, overdue: boolean): ClientVisitDto {
  return {
    id: 0, uid, org_uid: null,
    client: "c-1",
    client_detail: { id: 0, uid: "c-1", name: "Acme", type: "client", color: "" },
    visit_date: "2026-04-10",
    prepared_by: null, prepared_by_detail: null,
    assigned_manager: null, assigned_manager_detail: null,
    current_status: "Draft", report_sent_date: null,
    voice_note_sent: false, voice_note_summary: "",
    created_by_detail: null,
    reports: [], audit_events: [],
    is_overdue: overdue,
    created_at: "", updated_at: "",
  };
}

const group: VisitGroup = {
  clientUid: "c-1",
  clientName: "Acme",
  visits: [visit("v-1", true), visit("v-2", false)],
};

const noopHandlers = {
  onAddVisit: () => {},
  onEditDraft: () => {},
  onSubmit: async () => {},
  onApprove: async () => {},
  onReject: async () => {},
  onResubmit: () => {},
  onSetSentInfo: async () => {},
  onDeleteVisit: async () => {},
} as const;

describe("ClientVisitGroupedView overdue badge", () => {
  it("renders an overdue pill on the client name when overdueByClient has a positive count", () => {
    render(
      <ClientVisitGroupedView
        groups={[group]}
        currentUserUid="me"
        isOrgAdmin
        isAdminInOrg={() => true}
        overdueByClient={new Map([["c-1", 3]])}
        {...noopHandlers}
      />,
    );
    const pill = screen.getByLabelText("3 overdue visits");
    expect(pill.textContent).toBe("3 overdue");
  });

  it("omits the pill when the count is zero or missing", () => {
    render(
      <ClientVisitGroupedView
        groups={[group]}
        currentUserUid="me"
        isOrgAdmin
        isAdminInOrg={() => true}
        {...noopHandlers}
      />,
    );
    expect(screen.queryByLabelText(/overdue visit/i)).toBeNull();
  });

  it("singularises the label when count is 1", () => {
    render(
      <ClientVisitGroupedView
        groups={[group]}
        currentUserUid="me"
        isOrgAdmin
        isAdminInOrg={() => true}
        overdueByClient={new Map([["c-1", 1]])}
        {...noopHandlers}
      />,
    );
    const pill = screen.getByLabelText("1 overdue visit");
    expect(pill.textContent).toBe("1 overdue");
  });
});
