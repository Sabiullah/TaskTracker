import { useCallback, useEffect, useMemo, useState } from "react";
import { createSeatCostSetting, editSeatCostSetting, listSeatCostSettings } from "@/lib/api/seatCost";
import type { SeatCostSettingDto } from "@/types/api/seatCost";

export interface UseSeatCostSettingReturn {
  /** The setting for `orgUid` specifically, or `null` if that org has no
   *  setting yet (or `orgUid` is `null`). */
  setting: SeatCostSettingDto | null;
  /** Every seat cost setting the caller can see, across every org they're
   *  admin of — unfiltered. Used where a per-employee, per-org lookup is
   *  needed (see `computeProfitability`). */
  settings: SeatCostSettingDto[];
  loading: boolean;
  saving: boolean;
  reload: () => Promise<void>;
  /** PATCHes the existing row for `orgUid` if one exists, otherwise POSTs a
   *  new one for `orgUid`. */
  save: (monthlyAmount: string | number) => Promise<SeatCostSettingDto>;
}

/**
 * Fetches every seat cost setting the caller (an org admin) can see, and
 * resolves the one for `orgUid` specifically. A multi-org admin sees one row
 * per org they administer — `rows[0]` is NOT a safe stand-in for "the org
 * currently being configured", so callers must pass the org uid they mean.
 */
export function useSeatCostSetting(orgUid: string | null): UseSeatCostSettingReturn {
  const [settings, setSettings] = useState<SeatCostSettingDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listSeatCostSettings();
      setSettings(rows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setting = useMemo(
    () => (orgUid ? (settings.find((r) => r.org === orgUid) ?? null) : null),
    [settings, orgUid],
  );

  const save = useCallback(
    async (monthlyAmount: string | number) => {
      setSaving(true);
      try {
        const saved = setting
          ? await editSeatCostSetting(setting.uid, { monthly_amount: monthlyAmount })
          : await createSeatCostSetting({ monthly_amount: monthlyAmount, org: orgUid ?? undefined });
        setSettings((prev) =>
          prev.some((s) => s.uid === saved.uid)
            ? prev.map((s) => (s.uid === saved.uid ? saved : s))
            : [...prev, saved],
        );
        return saved;
      } finally {
        setSaving(false);
      }
    },
    [setting, orgUid],
  );

  return { setting, settings, loading, saving, reload, save };
}
