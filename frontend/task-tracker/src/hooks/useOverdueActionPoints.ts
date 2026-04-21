import { useCallback, useEffect, useState } from "react";
import { apiGet, ws } from "@/lib/api";
import type { ClientActionPointDto } from "@/types/api/clients";

export interface UseOverdueActionPointsReturn {
  overdue: ClientActionPointDto[];
  loading: boolean;
  reload: () => Promise<void>;
}

export function useOverdueActionPoints(): UseOverdueActionPointsReturn {
  const [overdue, setOverdue] = useState<ClientActionPointDto[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const data = await apiGet<ClientActionPointDto[]>("/client-action-points/overdue/");
    setOverdue(data);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reload();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    // Any action-point mutation could change the overdue list — refetch on every event.
    const unsub = ws.subscribe<ClientActionPointDto>("client-action-points", () => {
      void reload();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [reload]);

  return { overdue, loading, reload };
}
