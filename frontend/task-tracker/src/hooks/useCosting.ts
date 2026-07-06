import { useCallback, useEffect, useState } from "react";
import { ws } from "@/lib/api";
import {
  createCostingEntry,
  deleteCostingEntry,
  editCostingEntry,
  listCostingEntries,
} from "@/lib/api/costing";
import type {
  CostingEntryCreateForm,
  CostingEntryDto,
  CostingEntryEditForm,
} from "@/types/api/costing";

export interface UseCostingReturn {
  entries: CostingEntryDto[];
  loading: boolean;
  saving: boolean;
  reload: () => Promise<void>;
  createEntry: (form: CostingEntryCreateForm) => Promise<CostingEntryDto>;
  editEntry: (uid: string, form: CostingEntryEditForm) => Promise<CostingEntryDto>;
  removeEntry: (uid: string) => Promise<void>;
}

export function useCosting(clientUid: string | null): UseCostingReturn {
  const [entries, setEntries] = useState<CostingEntryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!clientUid) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rows = await listCostingEntries(clientUid);
      setEntries(rows);
    } finally {
      setLoading(false);
    }
  }, [clientUid]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    return ws.subscribe<CostingEntryDto>("costing-entries", (msg) => {
      const record = msg.record;
      if (!record || record.client !== clientUid) return;
      if (msg.event === "DELETE") {
        setEntries((prev) => prev.filter((e) => e.uid !== record.uid));
        return;
      }
      if (msg.event === "INSERT" || msg.event === "UPDATE") {
        setEntries((prev) => {
          const idx = prev.findIndex((e) => e.uid === record.uid);
          if (idx === -1) return [...prev, record];
          const next = [...prev];
          next[idx] = record;
          return next;
        });
      }
    });
  }, [clientUid]);

  const createEntry = useCallback(async (form: CostingEntryCreateForm) => {
    setSaving(true);
    try {
      const created = await createCostingEntry(form);
      setEntries((prev) => [...prev, created]);
      return created;
    } finally {
      setSaving(false);
    }
  }, []);

  const editEntry = useCallback(async (uid: string, form: CostingEntryEditForm) => {
    setSaving(true);
    try {
      const updated = await editCostingEntry(uid, form);
      setEntries((prev) => prev.map((e) => (e.uid === uid ? updated : e)));
      return updated;
    } finally {
      setSaving(false);
    }
  }, []);

  const removeEntry = useCallback(async (uid: string) => {
    setSaving(true);
    try {
      await deleteCostingEntry(uid);
      setEntries((prev) => prev.filter((e) => e.uid !== uid));
    } finally {
      setSaving(false);
    }
  }, []);

  return { entries, loading, saving, reload, createEntry, editEntry, removeEntry };
}
