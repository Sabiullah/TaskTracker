import { useCallback, useEffect, useState } from "react";
import { createSeatCostSetting, editSeatCostSetting, listSeatCostSettings } from "@/lib/api/seatCost";
import type { SeatCostSettingDto } from "@/types/api/seatCost";

export interface UseSeatCostSettingReturn {
  setting: SeatCostSettingDto | null;
  loading: boolean;
  saving: boolean;
  reload: () => Promise<void>;
  save: (monthlyAmount: string | number, orgUid?: string) => Promise<SeatCostSettingDto>;
}

export function useSeatCostSetting(): UseSeatCostSettingReturn {
  const [setting, setSetting] = useState<SeatCostSettingDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listSeatCostSettings();
      setSetting(rows[0] ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(
    async (monthlyAmount: string | number, orgUid?: string) => {
      setSaving(true);
      try {
        const saved = setting
          ? await editSeatCostSetting(setting.uid, { monthly_amount: monthlyAmount })
          : await createSeatCostSetting({ monthly_amount: monthlyAmount, org: orgUid });
        setSetting(saved);
        return saved;
      } finally {
        setSaving(false);
      }
    },
    [setting],
  );

  return { setting, loading, saving, reload, save };
}
