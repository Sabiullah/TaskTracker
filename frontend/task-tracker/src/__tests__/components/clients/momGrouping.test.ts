import { describe, expect, it } from "vitest";
import { groupMeetingsByClient } from "@/components/clients/momGrouping";
import type { ClientMeetingDto } from "@/types/api/clients";

function meeting(
  uid: string,
  client: string | null,
  clientName: string | null,
  org_uid: string | null,
  meeting_date: string,
): ClientMeetingDto {
  return {
    id: parseInt(uid.replace(/\D/g, ""), 10) || 1,
    uid,
    org_uid,
    client,
    client_detail: clientName
      ? { id: 1, uid: client ?? "", name: clientName, type: "Client", color: "#fff" }
      : null,
    meeting_date,
    meeting_time: null,
    meeting_type: "Review",
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
  } as unknown as ClientMeetingDto;
}

describe("groupMeetingsByClient", () => {
  it("returns empty array when no meetings", () => {
    expect(groupMeetingsByClient([], null)).toEqual([]);
  });

  it("groups meetings by client uid and labels with client_detail.name", () => {
    const meetings = [
      meeting("m1", "c-a", "Acme", "org1", "2026-04-20"),
      meeting("m2", "c-b", "Beta", "org1", "2026-04-21"),
      meeting("m3", "c-a", "Acme", "org1", "2026-04-22"),
    ];
    const groups = groupMeetingsByClient(meetings, null);
    expect(groups).toHaveLength(2);
    const acme = groups.find((g) => g.clientUid === "c-a")!;
    expect(acme.clientName).toBe("Acme");
    expect(acme.meetings.map((m) => m.uid)).toEqual(["m3", "m1"]);
  });

  it("sorts groups alphabetically by client name", () => {
    const meetings = [
      meeting("m1", "c-z", "Zeta", "org1", "2026-04-20"),
      meeting("m2", "c-a", "Acme", "org1", "2026-04-20"),
      meeting("m3", "c-m", "Midco", "org1", "2026-04-20"),
    ];
    const groups = groupMeetingsByClient(meetings, null);
    expect(groups.map((g) => g.clientName)).toEqual(["Acme", "Midco", "Zeta"]);
  });

  it("sorts meetings within a group by meeting_date descending", () => {
    const meetings = [
      meeting("old", "c-a", "Acme", "org1", "2026-01-10"),
      meeting("new", "c-a", "Acme", "org1", "2026-04-25"),
      meeting("mid", "c-a", "Acme", "org1", "2026-03-15"),
    ];
    const groups = groupMeetingsByClient(meetings, null);
    expect(groups[0].meetings.map((m) => m.uid)).toEqual(["new", "mid", "old"]);
  });

  it("buckets meetings with null client into '(Unassigned)' last", () => {
    const meetings = [
      meeting("orphan", null, null, "org1", "2026-04-20"),
      meeting("m1", "c-a", "Acme", "org1", "2026-04-20"),
    ];
    const groups = groupMeetingsByClient(meetings, null);
    expect(groups.map((g) => g.clientName)).toEqual(["Acme", "(Unassigned)"]);
    expect(groups[1].clientUid).toBe("unassigned");
  });

  it("filters by selectedOrg when provided", () => {
    const meetings = [
      meeting("m1", "c-a", "Acme", "org1", "2026-04-20"),
      meeting("m2", "c-b", "Beta", "org2", "2026-04-21"),
    ];
    const groups = groupMeetingsByClient(meetings, "org1");
    expect(groups).toHaveLength(1);
    expect(groups[0].clientName).toBe("Acme");
  });

  it("returns all meetings when selectedOrg is null", () => {
    const meetings = [
      meeting("m1", "c-a", "Acme", "org1", "2026-04-20"),
      meeting("m2", "c-b", "Beta", "org2", "2026-04-21"),
    ];
    const groups = groupMeetingsByClient(meetings, null);
    expect(groups).toHaveLength(2);
  });
});
