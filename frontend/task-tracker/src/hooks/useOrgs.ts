import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  ws,
} from "@/lib/api";
import type { ID, MasterItem } from "@/types";
import type { OrgCreate, OrgDto, OrgUpdate } from "@/types/api";

function dtoToOrgItem(dto: OrgDto): MasterItem {
  return {
    id: dto.uid,
    name: dto.name,
    type: "org",
    org: null,
    // Orgs themselves don't belong to orgs — the field exists on the
    // shared ``MasterItem`` shape but is meaningless here. Keep the
    // array empty so callers that iterate ``item.orgs`` don't crash.
    orgs: [],
    color: null,
  };
}

export interface UseOrgsReturn {
  orgs: MasterItem[];
  loading: boolean;
  saving: boolean;
  reload: () => Promise<void>;
  saveOrg: (existing: MasterItem | null, name: string) => Promise<boolean>;
  deleteOrg: (id: ID) => Promise<void>;
}

const sortByName = (arr: MasterItem[]): MasterItem[] =>
  [...arr].sort((a, b) => a.name.localeCompare(b.name));

export function useOrgs(): UseOrgsReturn {
  const [orgs, setOrgs] = useState<MasterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    const dtos = await apiGet<OrgDto[]>("/orgs/");
    setOrgs(sortByName(dtos.map(dtoToOrgItem)));
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

    const unsubscribe = ws.subscribe<OrgDto>("orgs", (evt) => {
      if (evt.event === "INSERT" && evt.record) {
        const next = dtoToOrgItem(evt.record);
        setOrgs((prev) =>
          sortByName(
            prev.some((o) => o.id === next.id) ? prev : [...prev, next],
          ),
        );
      } else if (evt.event === "UPDATE" && evt.record) {
        const next = dtoToOrgItem(evt.record);
        setOrgs((prev) =>
          sortByName(prev.map((o) => (o.id === next.id ? next : o))),
        );
      } else if (evt.event === "DELETE" && evt.record) {
        const deletedId = (evt.record as { uid?: string }).uid;
        if (deletedId)
          setOrgs((prev) => prev.filter((o) => o.id !== deletedId));
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [reload]);

  const saveOrg = useCallback(
    async (existing: MasterItem | null, name: string): Promise<boolean> => {
      const trimmed = name.trim();
      if (!trimmed) {
        alert("Name is required");
        return false;
      }
      setSaving(true);
      try {
        if (existing) {
          const body: OrgUpdate = { name: trimmed };
          const dto = await apiPatch<OrgDto>(`/orgs/${existing.id}/`, body);
          const next = dtoToOrgItem(dto);
          setOrgs((prev) =>
            sortByName(prev.map((o) => (o.id === existing.id ? next : o))),
          );
        } else {
          const body: OrgCreate = { name: trimmed };
          const dto = await apiPost<OrgDto>("/orgs/", body);
          const next = dtoToOrgItem(dto);
          setOrgs((prev) => sortByName([...prev, next]));
        }
        return true;
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : String(err);
        alert(`Save failed: ${msg}`);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const deleteOrg = useCallback(async (id: ID): Promise<void> => {
    if (!window.confirm("Delete this organisation?")) return;
    try {
      await apiDelete(`/orgs/${id}/`);
      setOrgs((prev) => prev.filter((o) => o.id !== id));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Delete failed: ${msg}`);
    }
  }, []);

  return { orgs, loading, saving, reload, saveOrg, deleteOrg };
}
