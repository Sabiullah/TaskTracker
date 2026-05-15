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

// Mirrors DailyStandupPage.tsx:58-62. Higher score = more informative row.
function rosterScore(r: OperationalStandupRosterRow): number {
  if (!r.entry) return 0;
  if (r.entry.status === "Approved") return 2;
  return 1;
}

export function useMyTodayStandup(profileId: string | null): UseMyTodayStandupResult {
  const [entry, setEntry] = useState<OperationalStandupDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

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
        const mine = rows.filter((r) => r.profile.uid === profileId);
        let picked: OperationalStandupRosterRow | null = null;
        for (const r of mine) {
          if (!picked || rosterScore(r) > rosterScore(picked)) picked = r;
        }
        setEntry(picked?.entry ?? null);
      } catch {
        // Passive widget: swallow errors, keep last-known entry.
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
  }, [profileId, refreshKey]);

  return { entry, loading, refresh };
}
