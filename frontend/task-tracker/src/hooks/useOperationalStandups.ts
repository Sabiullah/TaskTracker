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
  refresh: () => Promise<void>;
}

export function useOperationalStandups({
  month,
  rosterDate,
}: UseOperationalStandupsArgs): UseOperationalStandupsResult {
  const [standups, setStandups] = useState<OperationalStandupDto[]>([]);
  const [roster, setRoster] = useState<OperationalStandupRosterRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.all([
        apiGet<OperationalStandupDto[]>(
          `/operational_standups/?month=${encodeURIComponent(month)}`,
        ),
        rosterDate
          ? apiGet<OperationalStandupRosterRow[]>(
              `/operational_standups/roster/?date=${encodeURIComponent(rosterDate)}`,
            )
          : Promise.resolve<OperationalStandupRosterRow[]>([]),
      ]);
      setStandups(results[0]);
      setRoster(results[1]);
    } finally {
      setLoading(false);
    }
  }, [month, rosterDate]);

  useEffect(() => {
    void refresh();
    const unsubscribe = ws.subscribe<OperationalStandupDto>(
      "pace-operational-standups",
      () => {
        void refresh();
      },
    );
    return unsubscribe;
  }, [refresh]);

  return { standups, roster, loading, refresh };
}
