import { useCallback, useEffect, useState } from "react";
import {
  apiGet,
  apiPost,
  dtoToAttendance,
  toast,
  ws,
} from "@/lib/api";
import type { AttendanceRecord } from "@/types";
import type { AttendanceDto } from "@/types/api";

export interface UseWfhApprovalsReturn {
  items: AttendanceRecord[];
  loading: boolean;
  reload: () => Promise<void>;
  approve: (uid: string) => Promise<void>;
  reject: (uid: string, reason: string) => Promise<void>;
}

export function useWfhApprovals(): UseWfhApprovalsReturn {
  const [items, setItems] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const dtos = await apiGet<AttendanceDto[]>("/attendance/");
    const mapped = dtos
      .map(dtoToAttendance)
      .filter((r) => r.work_location === "WFH" && r.approval_state === "Pending");
    setItems(mapped);
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

    const unsub = ws.subscribe<AttendanceDto>("attendance", (evt) => {
      if (evt.event === "INSERT" && evt.record) {
        const next = dtoToAttendance(evt.record);
        if (next.work_location === "WFH" && next.approval_state === "Pending") {
          setItems((prev) =>
            prev.some((r) => r.id === next.id) ? prev : [next, ...prev],
          );
        }
      } else if (evt.event === "UPDATE" && evt.record) {
        const next = dtoToAttendance(evt.record);
        const isPending =
          next.work_location === "WFH" && next.approval_state === "Pending";
        setItems((prev) => {
          const exists = prev.some((r) => r.id === next.id);
          if (isPending) {
            return exists ? prev.map((r) => (r.id === next.id ? next : r)) : [next, ...prev];
          }
          return prev.filter((r) => r.id !== next.id);
        });
      } else if (evt.event === "DELETE" && evt.record) {
        const uid = (evt.record as { uid?: string }).uid;
        if (uid) setItems((prev) => prev.filter((r) => r.id !== uid));
      }
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [reload]);

  const approve = useCallback(async (uid: string): Promise<void> => {
    await apiPost(`/attendance/${uid}/approve_wfh/`, {});
    toast.show("WFH approved", "ok");
  }, []);

  const reject = useCallback(async (uid: string, reason: string): Promise<void> => {
    await apiPost(`/attendance/${uid}/reject_wfh/`, { reason });
    toast.show("WFH rejected", "ok");
  }, []);

  return { items, loading, reload, approve, reject };
}
