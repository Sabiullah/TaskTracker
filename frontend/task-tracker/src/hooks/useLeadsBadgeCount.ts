import { useMemo } from "react";
import { useLeads } from "@/hooks/useLeads";
import { computeLeadsBadgeCount } from "@/components/leads/leadsBadgeCount";

/**
 * Live count of overdue Open leads — used as the red pill on the NavMenu
 * "Leads" tab. Returns 0 while the initial fetch is in flight to avoid a
 * flash of stale-data on first render.
 */
export function useLeadsBadgeCount(): number {
  const { leads, loading } = useLeads();
  return useMemo(
    () => (loading ? 0 : computeLeadsBadgeCount(leads)),
    [leads, loading],
  );
}
