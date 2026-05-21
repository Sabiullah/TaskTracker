import { useCallback, useEffect, useState } from "react";
import { apiGet, ws } from "@/lib/api";
import type {
  OperationalStandupDto,
  OperationalStandupRosterRow,
} from "@/types/api";

export interface UseMyTodayStandupResult {
  entry: OperationalStandupDto | null;
  loading: boolean;
  refresh: () => void;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function useMyTodayStandup(profileId: string | null): UseMyTodayStandupResult {
  const [entry, setEntry] = useState<OperationalStandupDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  // Fetch on mount, when profileId changes, or when refresh() is called
  // (manually or via the WS subscription below).
  useEffect(() => {
    if (!profileId) {
      setEntry(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const date = todayISO();

    const doFetch = async (): Promise<void> => {
      setLoading(true);
      try {
        const rows = await apiGet<OperationalStandupRosterRow[]>(
          `/operational_standups/roster/?date=${encodeURIComponent(date)}`,
        );
        if (cancelled) return;
        // One row per (profile, date) — pick the matching one.
        const mine = rows.find((r) => r.profile.uid === profileId);
        setEntry(mine?.entry ?? null);
      } catch {
        // Passive widget: swallow errors, keep last-known entry.
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void doFetch();
    return () => {
      cancelled = true;
    };
  }, [profileId, refreshKey]);

  // Subscribe to WS for this user only; re-creates only when profileId changes.
  useEffect(() => {
    if (!profileId) return;
    const unsubscribe = ws.subscribe<OperationalStandupDto>(
      "pace-operational-standups",
      (evt) => {
        if (evt.record?.profile !== profileId) return;
        setRefreshKey((k) => k + 1);
      },
    );
    return unsubscribe;
  }, [profileId]);

  return { entry, loading, refresh };
}
