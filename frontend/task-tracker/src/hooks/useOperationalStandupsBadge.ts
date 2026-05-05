import { useCallback, useEffect, useState } from "react";
import { apiGet, ws } from "@/lib/api";
import type { PendingCountResponse } from "@/types/api";

export function useOperationalStandupsBadge(): number {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const r = await apiGet<PendingCountResponse>(
        "/operational_standups/pending_count/",
      );
      setCount(r.count);
    } catch {
      // Auth/network errors — leave count at 0; nav menu stays clean.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unsubscribe = ws.subscribe("pace-operational-standups", () => {
      void refresh();
    });
    return unsubscribe;
  }, [refresh]);

  return count;
}
