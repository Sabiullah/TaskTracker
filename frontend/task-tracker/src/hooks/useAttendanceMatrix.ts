import { useCallback, useEffect, useState } from "react";
import { apiGet, ws } from "@/lib/api";
import type { CellPayload } from "@/utils/matrixCells";

export interface MatrixEmployee {
  uid: string;
  full_name: string;
  org_uids: string[];
}

export interface MatrixDate {
  date: string;
  weekday: string;
  is_holiday: boolean;
  is_override: boolean;
  holiday_name: string | null;
}

export interface MatrixPayload {
  employees: MatrixEmployee[];
  dates: MatrixDate[];
  cells: Record<string, Record<string, CellPayload>>;
}

export interface UseAttendanceMatrixReturn {
  data: MatrixPayload | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useAttendanceMatrix(
  month: string,
  orgUid?: string,
): UseAttendanceMatrixReturn {
  const [data, setData] = useState<MatrixPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    if (!month) return;
    const params = new URLSearchParams({ month });
    if (orgUid) params.set("org_uid", orgUid);
    try {
      const payload = await apiGet<MatrixPayload>(
        `/attendance/matrix/?${params.toString()}`,
      );
      setData(payload);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [month, orgUid]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        await reload();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    // Refetch on any related event — small payload, simplest invalidation.
    const unsubA = ws.subscribe("attendance", () => {
      void reload();
    });
    const unsubL = ws.subscribe("leave", () => {
      void reload();
    });
    return () => {
      cancelled = true;
      unsubA();
      unsubL();
    };
  }, [reload]);

  return { data, loading, error, reload };
}
