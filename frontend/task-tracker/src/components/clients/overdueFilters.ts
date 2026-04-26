import type { ClientActionPointDto, ClientMeetingDto } from "@/types/api/clients";

// Shared between ClientsPage (header counter) and OverdueActionPointsPanel
// (rendered list) so both stay consistent.
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
