import { useCallback, useEffect, useState } from "react";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  ws,
} from "@/lib/api";
import type {
  ClientRoadmapDto,
  ClientRoadmapWrite,
} from "@/types/api/clients";

export interface UseClientRoadmapReturn {
  items: ClientRoadmapDto[];
  loading: boolean;
  reload: (clientUid?: string) => Promise<void>;
  create: (body: ClientRoadmapWrite) => Promise<ClientRoadmapDto>;
  update: (uid: string, body: Partial<ClientRoadmapWrite>) => Promise<ClientRoadmapDto>;
  remove: (uid: string) => Promise<void>;
}

export function useClientRoadmap(clientUid?: string): UseClientRoadmapReturn {
  const [items, setItems] = useState<ClientRoadmapDto[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(
    async (uid?: string): Promise<void> => {
      const effective = uid ?? clientUid;
      const query = effective ? { client_uid: effective } : undefined;
      const data = await apiGet<ClientRoadmapDto[]>("/client-roadmap/", query);
      setItems(data);
    },
    [clientUid],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reload();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const unsub = ws.subscribe<ClientRoadmapDto>("client-roadmap", (evt) => {
      if (evt.event === "INSERT" && evt.record) {
        const next = evt.record;
        if (clientUid && next.client !== clientUid) return;
        setItems((prev) => (prev.some((r) => r.uid === next.uid) ? prev : [next, ...prev]));
      } else if (evt.event === "UPDATE" && evt.record) {
        const next = evt.record;
        setItems((prev) => prev.map((r) => (r.uid === next.uid ? next : r)));
      } else if (evt.event === "DELETE" && evt.record) {
        const deletedUid = (evt.record as { uid?: string }).uid;
        if (deletedUid) setItems((prev) => prev.filter((r) => r.uid !== deletedUid));
      }
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [reload, clientUid]);

  const create = useCallback(async (body: ClientRoadmapWrite) => {
    const dto = await apiPost<ClientRoadmapDto>("/client-roadmap/", body);
    setItems((prev) => [dto, ...prev]);
    return dto;
  }, []);

  const update = useCallback(
    async (uid: string, body: Partial<ClientRoadmapWrite>) => {
      const dto = await apiPatch<ClientRoadmapDto>(`/client-roadmap/${uid}/`, body);
      setItems((prev) => prev.map((r) => (r.uid === uid ? dto : r)));
      return dto;
    },
    [],
  );

  const remove = useCallback(async (uid: string) => {
    await apiDelete(`/client-roadmap/${uid}/`);
    setItems((prev) => prev.filter((r) => r.uid !== uid));
  }, []);

  return { items, loading, reload, create, update, remove };
}
