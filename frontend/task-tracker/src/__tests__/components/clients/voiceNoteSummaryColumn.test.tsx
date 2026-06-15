// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ClientVisitGroupedView from "@/components/clients/ClientVisitGroupedView";
import type { VisitGroup } from "@/components/clients/internalReportGrouping";
import type { ClientVisitDto } from "@/types/api/internalReports";

afterEach(() => cleanup());

function visit(uid: string, over: Partial<ClientVisitDto> = {}): ClientVisitDto {
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
    is_overdue: false,
    created_at: "", updated_at: "",
    ...over,
  };
}

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

function renderOpenGroup(visits: ClientVisitDto[]) {
  const group: VisitGroup = { clientUid: "c-1", clientName: "Acme", visits };
  render(
    <ClientVisitGroupedView
      groups={[group]}
      currentUserUid="me"
      isManagerInOrg={() => true}
      isAdminInOrg={() => true}
      {...noopHandlers}
    />,
  );
  // Expand the client group so its visit rows render.
  fireEvent.click(screen.getByText("Acme"));
}

describe("Voice Note column reflects the summary", () => {
  it("shows the summary text in the list even when the voice note is not marked sent", () => {
    renderOpenGroup([visit("v-1", { voice_note_summary: "Discussed Q2 roadmap" })]);
    expect(screen.getByText("Discussed Q2 roadmap")).toBeTruthy();
  });

  it("shows both the Sent pill and the summary text when both are present", () => {
    renderOpenGroup([
      visit("v-1", { voice_note_sent: true, voice_note_summary: "All points covered" }),
    ]);
    expect(screen.getByText("✓ Sent")).toBeTruthy();
    expect(screen.getByText("All points covered")).toBeTruthy();
  });

  it("exposes the full summary via a title tooltip for truncation", () => {
    renderOpenGroup([visit("v-1", { voice_note_summary: "A rather long summary line" })]);
    const el = screen.getByText("A rather long summary line");
    expect(el.getAttribute("title")).toBe("A rather long summary line");
  });
});
