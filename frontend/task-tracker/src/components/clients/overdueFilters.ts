import type { ClientActionPointDto, ClientMeetingDto } from "@/types/api/clients";

// Used by ClientsPage for the page-header overdue counter.
// (OverdueActionPointsPanel is on disk but no longer rendered — deferred cleanup.)
export function filterOverdue(
  overdue: ClientActionPointDto[],
  meetings: ClientMeetingDto[],
  selectedOrg: string | null,
  selectedClientUid: string,
): ClientActionPointDto[] {
  if (!selectedOrg && !selectedClientUid) return overdue;
  return overdue.filter((ap) => {
    const meeting = meetings.find((m) => m.id === ap.meeting);
    if (!meeting) return false;
    if (selectedClientUid) return meeting.client === selectedClientUid;
    if (selectedOrg) return meeting.org_uid === selectedOrg;
    return true;
  });
}
