import { useEffect, useState } from "react";
import { apiGet, ws } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import type { KaizenDto } from "@/types/api";

/**
 * Live count of Pending Kaizen entries for the NavMenu badge. Returns 0 for
 * non-admins (they don't see the approval queue, so no badge). Mirrors the
 * shape of useLeadsBadgeCount.
 */
export function useKaizenPendingBadge(): number {
  const { isAdminInAny } = useAuth();
  const isAdmin = isAdminInAny();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!isAdmin) {
      setCount(0);
      return;
    }
    let cancelled = false;

    const refresh = async () => {
      try {
        const dtos = await apiGet<KaizenDto[]>("/kaizens/?status=Pending");
        if (!cancelled) setCount(dtos.length);
      } catch {
        if (!cancelled) setCount(0);
      }
    };

    void refresh();

    const unsub = ws.subscribe<KaizenDto>("kaizen", () => {
      void refresh();
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [isAdmin]);

  return count;
}
