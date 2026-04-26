import type { ClientMeetingDto } from "@/types/api/clients";

export interface MeetingGroup {
  clientUid: string;
  clientName: string;
  meetings: ClientMeetingDto[];
}

const UNASSIGNED_LABEL = "(Unassigned)";

export function groupMeetingsByClient(
  meetings: readonly ClientMeetingDto[],
  selectedOrg: string | null,
): MeetingGroup[] {
  const filtered = selectedOrg
    ? meetings.filter((m) => m.org_uid === selectedOrg)
    : meetings;

  const byUid = new Map<string, MeetingGroup>();
  for (const m of filtered) {
    const uid = m.client ?? "unassigned";
    const name = m.client_detail?.name ?? UNASSIGNED_LABEL;
    const bucket = byUid.get(uid) ?? { clientUid: uid, clientName: name, meetings: [] };
    bucket.meetings.push(m);
    byUid.set(uid, bucket);
  }

  for (const g of byUid.values()) {
    g.meetings.sort((a, b) => (a.meeting_date < b.meeting_date ? 1 : a.meeting_date > b.meeting_date ? -1 : 0));
  }

  return Array.from(byUid.values()).sort((a, b) => {
    if (a.clientName === UNASSIGNED_LABEL) return 1;
    if (b.clientName === UNASSIGNED_LABEL) return -1;
    return a.clientName.localeCompare(b.clientName);
  });
}
