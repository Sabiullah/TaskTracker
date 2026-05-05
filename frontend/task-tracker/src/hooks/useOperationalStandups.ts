import { useCallback, useEffect, useState } from "react";
import { apiGet, ws } from "@/lib/api";
import type {
  OperationalStandupDto,
  OperationalStandupRosterRow,
} from "@/types/api";

export interface UseOperationalStandupsArgs {
  month: string; // YYYY-MM
  rosterDate?: string; // YYYY-MM-DD — when set, also fetches roster
}

export interface UseOperationalStandupsResult {
  standups: OperationalStandupDto[];
  roster: OperationalStandupRosterRow[];
  loading: boolean;
  refresh: () => void;
}

export function useOperationalStandups({
  month,
  rosterDate,
}: UseOperationalStandupsArgs): UseOperationalStandupsResult {
  const [standups, setStandups] = useState<OperationalStandupDto[]>([]);
  const [roster, setRoster] = useState<OperationalStandupRosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Bumping refreshKey re-runs the fetch effect below. Consumers call this
  // after a mutation; the WS subscription also triggers it.
  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const doFetch = async (): Promise<void> => {
      setLoading(true);
      try {
        const [standupRows, rosterRows] = await Promise.all([
          apiGet<OperationalStandupDto[]>(
            `/operational_standups/?month=${encodeURIComponent(month)}`,
          ),
          rosterDate
            ? apiGet<OperationalStandupRosterRow[]>(
                `/operational_standups/roster/?date=${encodeURIComponent(rosterDate)}`,
              )
            : Promise.resolve<OperationalStandupRosterRow[]>([]),
        ]);
        if (!cancelled) {
          setStandups(standupRows);
          setRoster(rosterRows);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void doFetch();
    const unsubscribe = ws.subscribe<OperationalStandupDto>(
      "pace-operational-standups",
      () => {
        if (!cancelled) setRefreshKey((k) => k + 1);
      },
    );
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [month, rosterDate, refreshKey]);

  return { standups, roster, loading, refresh };
}
