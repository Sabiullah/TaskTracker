import { describe, expect, it } from "vitest";
import { groupVisitsByClient } from "@/components/clients/internalReportGrouping";
import type { ClientVisitDto } from "@/types/api/internalReports";

function v(client_uid: string, visit_date: string, name: string): ClientVisitDto {
  return {
    id: 0, uid: `${client_uid}-${visit_date}`, org_uid: null,
    client: client_uid,
    client_detail: { id: 0, uid: client_uid, name, type: "client", color: "" },
    visit_date,
    prepared_by: null, prepared_by_detail: null,
    assigned_manager: null, assigned_manager_detail: null,
    current_status: "Draft", report_sent_date: null,
    voice_note_sent: false, voice_note_summary: "",
    created_by_detail: null,
    reports: [], audit_events: [],
    is_overdue: false,
    created_at: "", updated_at: "",
  };
}

describe("groupVisitsByClient", () => {
  it("groups by client and sorts visits by descending date inside each group", () => {
    const groups = groupVisitsByClient([
      v("c-1", "2026-04-10", "Acme"),
      v("c-2", "2026-04-15", "Globex"),
      v("c-1", "2026-04-25", "Acme"),
    ]);
    expect(groups).toHaveLength(2);
    const acme = groups.find((g) => g.clientUid === "c-1")!;
    expect(acme.visits.map((x) => x.visit_date)).toEqual(["2026-04-25", "2026-04-10"]);
  });

  it("buckets visits with no client_detail under 'unassigned'", () => {
    const orphan = v("", "2026-04-25", "");
    const orphan2: ClientVisitDto = { ...orphan, client: null, client_detail: null };
    const groups = groupVisitsByClient([orphan2]);
    expect(groups[0].clientUid).toBe("unassigned");
  });
});
