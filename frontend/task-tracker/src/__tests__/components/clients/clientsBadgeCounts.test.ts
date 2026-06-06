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

  it("non-admin org manager counts pending visits they aren't assigned to via canApproveVisitFor", () => {
    const counts = computeBadgeCounts({
      myUid: "user-mgr2",
      isAdminFor: adminNowhere,
      canApproveVisitFor: adminEverywhere, // manager/admin in the visit's org
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
          assigned_manager: "user-mgr", // NOT user-mgr2
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

  it("returns zeros when myUid is null", () => {
    expect(
      computeBadgeCounts({
        myUid: null,
        isAdminFor: adminEverywhere,
        selectedOrg: null,
        clientUid: null,
        roadmapItems: [roadmap()],
        overdueAPs: [ap()],
        meetings: [meeting()],
        visits: [visit({ is_overdue: true })],
      }),
    ).toEqual({ roadmapOverdue: 0, momOverdue: 0, internalCombined: 0, total: 0 });
  });

  it("excludes roadmap items with null org_uid when selectedOrg is set", () => {
    const counts = computeBadgeCounts({
      myUid: "user-x",
      isAdminFor: adminEverywhere,
      selectedOrg: "org-1",
      clientUid: null,
      roadmapItems: [roadmap({ uid: "r1", org_uid: null })],
      overdueAPs: [],
      meetings: [],
      visits: [],
    });
    expect(counts.roadmapOverdue).toBe(0);
  });
});
