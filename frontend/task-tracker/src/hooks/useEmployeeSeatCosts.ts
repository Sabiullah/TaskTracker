import { useCallback, useEffect, useState } from "react";
import {
  createEmployeeSeatCost,
  deleteEmployeeSeatCost,
  editEmployeeSeatCost,
  listEmployeeSeatCosts,
} from "@/lib/api/seatCost";
import type {
  EmployeeSeatCostCreateForm,
  EmployeeSeatCostDto,
  EmployeeSeatCostEditForm,
} from "@/types/api/seatCost";

export interface UseEmployeeSeatCostsReturn {
  entries: EmployeeSeatCostDto[];
  loading: boolean;
  saving: boolean;
  reload: () => Promise<void>;
  createEntry: (form: EmployeeSeatCostCreateForm) => Promise<EmployeeSeatCostDto>;
  editEntry: (uid: string, form: EmployeeSeatCostEditForm) => Promise<EmployeeSeatCostDto>;
  removeEntry: (uid: string) => Promise<void>;
}

export function useEmployeeSeatCosts(): UseEmployeeSeatCostsReturn {
  const [entries, setEntries] = useState<EmployeeSeatCostDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listEmployeeSeatCosts();
      setEntries(rows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const createEntry = useCallback(async (form: EmployeeSeatCostCreateForm) => {
    setSaving(true);
    try {
      const created = await createEmployeeSeatCost(form);
      setEntries((prev) => [...prev, created]);
      return created;
    } finally {
      setSaving(false);
    }
  }, []);

  const editEntry = useCallback(async (uid: string, form: EmployeeSeatCostEditForm) => {
    setSaving(true);
    try {
      const updated = await editEmployeeSeatCost(uid, form);
      setEntries((prev) => prev.map((e) => (e.uid === uid ? updated : e)));
      return updated;
    } finally {
      setSaving(false);
    }
  }, []);

  const removeEntry = useCallback(async (uid: string) => {
    setSaving(true);
    try {
      await deleteEmployeeSeatCost(uid);
      setEntries((prev) => prev.filter((e) => e.uid !== uid));
    } finally {
      setSaving(false);
    }
  }, []);

  return { entries, loading, saving, reload, createEntry, editEntry, removeEntry };
}
