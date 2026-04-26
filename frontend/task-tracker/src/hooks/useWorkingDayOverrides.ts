import { useCallback, useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import type {
  WorkingDayOverrideCreate,
  WorkingDayOverrideDto,
} from "@/types/api";

export interface UseWorkingDayOverridesReturn {
  items: WorkingDayOverrideDto[];
  loading: boolean;
  reload: () => Promise<void>;
  create: (body: WorkingDayOverrideCreate) => Promise<WorkingDayOverrideDto>;
  remove: (uid: string) => Promise<void>;
}

export function useWorkingDayOverrides(): UseWorkingDayOverridesReturn {
  const [items, setItems] = useState<WorkingDayOverrideDto[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (): Promise<void> => {
    const data = await apiGet<WorkingDayOverrideDto[] | { results: WorkingDayOverrideDto[] }>(
      "/working-day-overrides/",
    );
    const rows = Array.isArray(data) ? data : data.results;
    setItems(rows);
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
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const create = useCallback(
    async (body: WorkingDayOverrideCreate): Promise<WorkingDayOverrideDto> => {
      const dto = await apiPost<WorkingDayOverrideDto>(
        "/working-day-overrides/",
        body,
      );
      setItems((prev) => [dto, ...prev]);
      return dto;
    },
    [],
  );

  const remove = useCallback(async (uid: string): Promise<void> => {
    await apiDelete(`/working-day-overrides/${uid}/`);
    setItems((prev) => prev.filter((r) => r.uid !== uid));
  }, []);

  return { items, loading, reload, create, remove };
}
