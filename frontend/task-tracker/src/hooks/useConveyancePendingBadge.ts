import { useEffect, useState } from "react";
import { ws } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { listEntries } from "@/utils/conveyanceApi";
import type { ConveyanceEntry } from "@/types/api/conveyance";

/**
 * Live count of pending Conveyance entries the current user can act on, for
 * the NavMenu "Conveyance" badge. Returns 0 for users who can't approve
 * (server enforces visibility, so non-managers never see a queue anyway).
 * Mirrors useKaizenPendingBadge.
 */
export function useConveyancePendingBadge(): number {
  const { isManagerInAny } = useAuth();
  const canApprove = isManagerInAny();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!canApprove) return;

    let cancelled = false;

    const refresh = async () => {
      try {
        const rows = await listEntries({ status: "pending" });
        if (!cancelled) setCount(rows.length);
      } catch {
        if (!cancelled) setCount(0);
      }
    };

    void refresh();

    const unsub = ws.subscribe<ConveyanceEntry>("conveyance-entries", () => {
      void refresh();
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [canApprove]);

  return canApprove ? count : 0;
}
