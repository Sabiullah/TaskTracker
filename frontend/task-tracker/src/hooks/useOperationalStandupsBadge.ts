import { useEffect, useState } from "react";
import { apiGet, ws } from "@/lib/api";
import type { PendingCountResponse } from "@/types/api";

/**
 * Live count of Pending Operational Standup rows the caller can act on for the
 * NavMenu badge. Backend scopes the count by role: managers/admins see org-wide
 * pending, employees see their own only. Mirrors the shape of useApprovalsBadge:
 * fetch once on mount, refetch on the matching ws channel.
 */
export function useOperationalStandupsBadge(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const refresh = async (): Promise<void> => {
      try {
        const r = await apiGet<PendingCountResponse>(
          "/operational_standups/pending_count/",
        );
        if (!cancelled) setCount(r.count);
      } catch {
        // Auth/network errors — leave count at 0; nav menu stays clean.
      }
    };

    void refresh();
    const unsubscribe = ws.subscribe("pace-operational-standups", () => {
      void refresh();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return count;
}
