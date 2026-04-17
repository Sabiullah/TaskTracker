import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  ApiError,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  dtoToWorkLog,
  ws,
  type WorkLogWriteRefs,
} from "@/lib/api";
import type { ID, WorkLog } from "@/types";
import type {
  WorkLogDto,
  WorkLogReorderRequest,
  WorkLogReorderResponse,
  WorkLogUpdate,
} from "@/types/api";
import { hoursToDecimal } from "@/utils/hours";

export interface UseWorkLogsReturn {
  logs: WorkLog[];
  loading: boolean;
  setLogs: Dispatch<SetStateAction<WorkLog[]>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  reload: () => Promise<void>;
  saveEdit: (
    id: ID,
    data: Partial<WorkLog>,
    refs: WorkLogWriteRefs,
  ) => Promise<boolean>;
  deleteRow: (id: ID) => Promise<void>;
  moveRow: (
    id: ID,
    direction: "up" | "down",
    filteredIds: ID[],
  ) => Promise<void>;
}

export function useWorkLogs(): UseWorkLogsReturn {
  const [logs, setLogs] = useState<WorkLog[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (): Promise<void> => {
    const dtos = await apiGet<WorkLogDto[]>("/work_logs/");
    setLogs(dtos.map(dtoToWorkLog));
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

    const unsubscribe = ws.subscribe<WorkLogDto>("work-logs", (evt) => {
      if (evt.event === "INSERT" && evt.record) {
        const next = dtoToWorkLog(evt.record);
        setLogs((prev) =>
          prev.some((r) => r.id === next.id) ? prev : [...prev, next],
        );
      } else if (evt.event === "UPDATE" && evt.record) {
        const next = dtoToWorkLog(evt.record);
        setLogs((prev) => prev.map((r) => (r.id === next.id ? next : r)));
      } else if (evt.event === "DELETE" && evt.record) {
        const deletedId = (evt.record as { uid?: string }).uid;
        if (deletedId)
          setLogs((prev) => prev.filter((r) => r.id !== deletedId));
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [reload]);

  const saveEdit = useCallback(
    async (
      id: ID,
      data: Partial<WorkLog>,
      refs: WorkLogWriteRefs,
    ): Promise<boolean> => {
      const body: WorkLogUpdate = {
        date: data.date,
        task_description: data.task_description,
        hours_worked: data.hours_worked
          ? hoursToDecimal(data.hours_worked)
          : undefined,
        priority: data.priority as WorkLogUpdate["priority"],
        sort_order: data.sort_order ?? undefined,
        client: refs.client ?? undefined,
        org: refs.org ?? data.organization ?? undefined,
      };
      try {
        const dto = await apiPatch<WorkLogDto>(`/work_logs/${id}/`, body);
        const next = dtoToWorkLog(dto);
        setLogs((prev) => prev.map((r) => (r.id === id ? next : r)));
        return true;
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : String(err);
        alert(`Save failed: ${msg}`);
        return false;
      }
    },
    [],
  );

  const deleteRow = useCallback(async (id: ID): Promise<void> => {
    if (!window.confirm("Delete this entry?")) return;
    await apiDelete(`/work_logs/${id}/`);
    setLogs((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const moveRow = useCallback(
    async (
      id: ID,
      direction: "up" | "down",
      filteredIds: ID[],
    ): Promise<void> => {
      const idx = filteredIds.indexOf(id);
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= filteredIds.length) return;

      const reordered = [...filteredIds];
      [reordered[idx], reordered[swapIdx]] = [
        reordered[swapIdx],
        reordered[idx],
      ];

      // Optimistic UI update
      setLogs((prev) => {
        const filteredSet = new Set(reordered);
        const nonFiltered = prev.filter((r) => !filteredSet.has(r.id));
        const sorted: WorkLog[] = reordered.flatMap((rid, i) => {
          const row = prev.find((r) => r.id === rid);
          return row ? [{ ...row, sort_order: i + 1 }] : [];
        });
        return [...sorted, ...nonFiltered];
      });

      const body: WorkLogReorderRequest = {
        rows: reordered.map((rid, i) => ({ uid: rid, sort_order: i + 1 })),
      };
      await apiPost<WorkLogReorderResponse>("/work_logs/reorder/", body);
    },
    [],
  );

  return {
    logs,
    loading,
    setLogs,
    setLoading,
    reload,
    saveEdit,
    deleteRow,
    moveRow,
  };
}
