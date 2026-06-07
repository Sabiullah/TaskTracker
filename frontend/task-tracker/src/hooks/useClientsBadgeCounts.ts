import { useMemo } from "react";
import { useClientMeetings } from "@/hooks/useClientMeetings";
import { useClientRoadmap } from "@/hooks/useClientRoadmap";
import { useClientVisits } from "@/hooks/useClientVisits";
import { useOverdueActionPoints } from "@/hooks/useOverdueActionPoints";
import { computeBadgeCounts, type BadgeCounts } from "@/components/clients/clientsBadgeCounts";

export interface UseClientsBadgeCountsArgs {
  readonly myUid: string | null;
  // Pass a stable reference (useCallback / useMemo). An inline closure
  // produces a new function each render and defeats memoization here.
  readonly isAdminFor: (orgUid: string | null) => boolean;
  // Whether the caller may approve observation reports in the given org (manager
  // or admin). Stable reference, same as ``isAdminFor``. Optional — defaults to
  // ``isAdminFor`` inside ``computeBadgeCounts`` when omitted.
  readonly canApproveVisitFor?: (orgUid: string | null) => boolean;
  readonly selectedOrg: string | null;
  readonly clientUid: string | null;
}

const ZERO_COUNTS: BadgeCounts = {
  roadmapOverdue: 0,
  momOverdue: 0,
  internalCombined: 0,
  total: 0,
};

export function useClientsBadgeCounts(args: UseClientsBadgeCountsArgs): BadgeCounts {
  const { items: roadmapItems, loading: roadmapLoading } = useClientRoadmap();
  const { overdue, loading: overdueLoading } = useOverdueActionPoints();
  const { meetings, loading: meetingsLoading } = useClientMeetings();
  const { visits, loading: visitsLoading } = useClientVisits();

  return useMemo(() => {
    if (roadmapLoading || overdueLoading || meetingsLoading || visitsLoading) {
      return ZERO_COUNTS;
    }
    return computeBadgeCounts({
      myUid: args.myUid,
      isAdminFor: args.isAdminFor,
      canApproveVisitFor: args.canApproveVisitFor,
      selectedOrg: args.selectedOrg,
      clientUid: args.clientUid,
      roadmapItems,
      overdueAPs: overdue,
      meetings,
      visits,
    });
  }, [
    args.myUid,
    args.isAdminFor,
    args.canApproveVisitFor,
    args.selectedOrg,
    args.clientUid,
    roadmapItems,
    overdue,
    meetings,
    visits,
    roadmapLoading,
    overdueLoading,
    meetingsLoading,
    visitsLoading,
  ]);
}
