import { useEffect, useState } from "react";
import { apiGet, ws } from "@/lib/api";

interface ApprovalsPendingResponse {
  wfh_count: number;
  leave_count: number;
}

/**
 * Returns the live count of WFH + Leave requests the caller can approve.
 *
 * Strategy: fetch once on mount, subscribe to "attendance" and "leave" SSE
 * channels and refetch on any event. Cheaper than maintaining a derived
 * client-side count because the per-user `can_approve` filter is server-side.
 * A 60s interval acts as a safety net for missed events.
 */
export function useApprovalsBadge(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const refresh = async (): Promise<void> => {
      try {
        const data = await apiGet<ApprovalsPendingResponse>(
          "/attendance/approvals_pending/",
        );
        if (!cancelled) {
          setCount(data.wfh_count + data.leave_count);
        }
      } catch {
        /* network blip; safety-net interval will retry */
      }
    };

    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 60_000);
    const unsubA = ws.subscribe("attendance", () => {
      void refresh();
    });
    const unsubL = ws.subscribe("leave", () => {
      void refresh();
    });

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      unsubA();
      unsubL();
    };
  }, []);

  return count;
}
