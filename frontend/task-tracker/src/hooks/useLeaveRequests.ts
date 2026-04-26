import { useCallback, useEffect, useState } from "react";
import {
  apiGet,
  apiPost,
  dtoToLeaveRequest,
  toast,
  ws,
} from "@/lib/api";
import type { LeaveRequest } from "@/types";
import type { LeaveRequestCreate, LeaveRequestDto } from "@/types/api/leave";

export interface UseLeaveRequestsReturn {
  items: LeaveRequest[];
  loading: boolean;
  reload: () => Promise<void>;
  create: (body: LeaveRequestCreate) => Promise<LeaveRequest>;
  approve: (uid: string) => Promise<LeaveRequest>;
  reject: (uid: string, reason: string) => Promise<LeaveRequest>;
  withdraw: (uid: string) => Promise<LeaveRequest>;
}

export function useLeaveRequests(): UseLeaveRequestsReturn {
  const [items, setItems] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const dtos = await apiGet<LeaveRequestDto[]>("/leave-requests/");
    setItems(dtos.map(dtoToLeaveRequest));
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

    const unsub = ws.subscribe<LeaveRequestDto>("leave", (evt) => {
      if (evt.event === "INSERT" && evt.record) {
        const next = dtoToLeaveRequest(evt.record);
        setItems((prev) => (prev.some((r) => r.id === next.id) ? prev : [next, ...prev]));
      } else if (evt.event === "UPDATE" && evt.record) {
        const next = dtoToLeaveRequest(evt.record);
        setItems((prev) => prev.map((r) => (r.id === next.id ? next : r)));
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

  const create = useCallback(async (body: LeaveRequestCreate): Promise<LeaveRequest> => {
    const dto = await apiPost<LeaveRequestDto>("/leave-requests/", body);
    return dtoToLeaveRequest(dto);
  }, []);

  const approve = useCallback(async (uid: string): Promise<LeaveRequest> => {
    const dto = await apiPost<LeaveRequestDto>(`/leave-requests/${uid}/approve/`, {});
    toast.show("Leave approved", "ok");
    return dtoToLeaveRequest(dto);
  }, []);

  const reject = useCallback(async (uid: string, reason: string): Promise<LeaveRequest> => {
    const dto = await apiPost<LeaveRequestDto>(`/leave-requests/${uid}/reject/`, { reason });
    toast.show("Leave rejected", "ok");
    return dtoToLeaveRequest(dto);
  }, []);

  const withdraw = useCallback(async (uid: string): Promise<LeaveRequest> => {
    const dto = await apiPost<LeaveRequestDto>(`/leave-requests/${uid}/withdraw/`, {});
    toast.show("Leave withdrawn", "ok");
    return dtoToLeaveRequest(dto);
  }, []);

  return { items, loading, reload, create, approve, reject, withdraw };
}
