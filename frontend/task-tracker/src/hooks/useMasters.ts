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
import type {
  MasterCreate,
  MasterDto,
  MasterTypeValue,
  MasterUpdate,
} from "@/types/api";

function dtoToMasterItem(dto: MasterDto): MasterItem {
  // Server returns both the legacy single `org` (nullable FK) and the new
  // `orgs` list. Expose both so callers can keep using `item.org` as a
  // "primary org" display while new filter logic uses `orgs` for real
  // membership checks. Fall back: if the DTO is missing `orgs` (older
  // server), seed it from `org` so the domain shape is always populated.
  const orgs: string[] = Array.isArray(dto.orgs)
    ? [...dto.orgs]
    : dto.org_uid
      ? [dto.org_uid]
      : [];
  return {
    id: dto.uid,
    name: dto.name,
    type: dto.type,
    org: dto.org_uid ?? null,
    orgs,
    color: dto.color || null,
    parent: dto.parent ?? null,
  };
}

export type MasterKind = MasterTypeValue; // "client" | "category"

export interface UseMastersReturn {
  clients: MasterItem[];
  cats: MasterItem[];
  loading: boolean;
  saving: boolean;
  reload: () => Promise<void>;
  saveItem: (
    type: MasterKind,
    existing: MasterItem | null,
    name: string,
    color: string | null,
    orgUids: readonly string[],
    parent?: string | null,
  ) => Promise<boolean>;
  deleteItem: (id: ID) => Promise<void>;
}

const sortByName = (arr: MasterItem[]): MasterItem[] =>
  [...arr].sort((a, b) => a.name.localeCompare(b.name));

function applyUpsert(
  list: MasterItem[],
  item: MasterItem,
  existingId: ID | null,
): MasterItem[] {
  const next = existingId
    ? list.map((m) => (m.id === existingId ? item : m))
    : list.some((m) => m.id === item.id)
      ? list.map((m) => (m.id === item.id ? item : m))
      : [...list, item];
  return sortByName(next);
}

export function useMasters(): UseMastersReturn {
  const [clients, setClients] = useState<MasterItem[]>([]);
  const [cats, setCats] = useState<MasterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    const dtos = await apiGet<MasterDto[]>("/masters/");
    const items = dtos.map(dtoToMasterItem);
    // ``type='team'`` masters are a legacy duplicate of User + OrgMembership
    // and are being phased out. Filter them out defensively so any rows
    // that still exist in the DB don't leak into client/category views.
    setClients(sortByName(items.filter((m) => m.type === "client")));
    setCats(sortByName(items.filter((m) => m.type === "category")));
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

    const unsubscribe = ws.subscribe<MasterDto>("masters", (evt) => {
      if (evt.event === "INSERT" && evt.record) {
        const item = dtoToMasterItem(evt.record);
        if (item.type === "client")
          setClients((prev) => applyUpsert(prev, item, null));
        else if (item.type === "category")
          setCats((prev) => applyUpsert(prev, item, null));
      } else if (evt.event === "UPDATE" && evt.record) {
        const item = dtoToMasterItem(evt.record);
        const remover = (prev: MasterItem[]) =>
          prev.filter((m) => m.id !== item.id);
        setClients(remover);
        setCats(remover);
        if (item.type === "client")
          setClients((prev) => applyUpsert(prev, item, null));
        else if (item.type === "category")
          setCats((prev) => applyUpsert(prev, item, null));
      } else if (evt.event === "DELETE" && evt.record) {
        const deletedId = (evt.record as { uid?: string }).uid;
        if (!deletedId) return;
        const remover = (prev: MasterItem[]) =>
          prev.filter((m) => m.id !== deletedId);
        setClients(remover);
        setCats(remover);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [reload]);

  const saveItem = useCallback(
    async (
      type: MasterKind,
      existing: MasterItem | null,
      name: string,
      color: string | null,
      orgUids: readonly string[],
      parent: string | null = null,
    ): Promise<boolean> => {
      const trimmed = name.trim();
      if (!trimmed) {
        alert("Name is required");
        return false;
      }
      // Pick a "primary" org for the legacy FK. The backend promotes the
      // first entry in ``orgs`` when ``org`` is unset anyway, but passing
      // both keeps audit queries that still read the FK working.
      const primaryOrg = orgUids[0];
      // Only categories can have a parent — silently drop it for clients
      // so a stale state doesn't leak through.
      const parentForBody = type === "category" ? parent : null;
      setSaving(true);
      try {
        let saved: MasterDto;
        if (existing) {
          const body: MasterUpdate = {
            name: trimmed,
            type,
            color: color ?? undefined,
            org: primaryOrg,
            orgs: orgUids,
            parent: parentForBody,
          };
          saved = await apiPatch<MasterDto>(`/masters/${existing.id}/`, body);
        } else {
          const body: MasterCreate = {
            name: trimmed,
            type,
            color: color ?? undefined,
            org: primaryOrg,
            orgs: orgUids,
            parent: parentForBody ?? undefined,
          };
          saved = await apiPost<MasterDto>("/masters/", body);
        }

        const item = dtoToMasterItem(saved);
        const existingId = existing?.id ?? null;
        if (type === "client")
          setClients((prev) => applyUpsert(prev, item, existingId));
        else setCats((prev) => applyUpsert(prev, item, existingId));
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

  const deleteItem = useCallback(async (id: ID): Promise<void> => {
    if (!window.confirm("Delete this item?")) return;
    try {
      await apiDelete(`/masters/${id}/`);
      const remover = (prev: MasterItem[]) => prev.filter((m) => m.id !== id);
      setClients(remover);
      setCats(remover);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : String(err);
      alert(`Delete failed: ${msg}`);
    }
  }, []);

  return {
    clients,
    cats,
    loading,
    saving,
    reload,
    saveItem,
    deleteItem,
  };
}
