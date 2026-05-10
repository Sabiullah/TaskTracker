import { useCallback, useEffect, useState } from "react";
import { apiGet, dtoToWorkPlan, ws } from "@/lib/api";
import type { WorkPlanDto } from "@/types/api";
import type { WorkPlan } from "@/types";
import { getDayName } from "@/utils/date";

export interface UseWorkPlansReturn {
  plans: WorkPlan[];
  loading: boolean;
  reload: () => Promise<void>;
}

/**
 * Loads /work_plans/ (server filters by visibility) and live-updates via the
 * `work-plans` WS topic. Plans are sorted ascending by date and have `day`
 * filled from `date`.
 */
export function useWorkPlans(): UseWorkPlansReturn {
  const [plans, setPlans] = useState<WorkPlan[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (): Promise<void> => {
    const dtos = await apiGet<WorkPlanDto[]>("/work_plans/");
    const mapped = dtos.map(dtoToWorkPlan);
    mapped.forEach((p) => {
      p.day = getDayName(p.date);
    });
    mapped.sort((a, b) => a.date.localeCompare(b.date));
    setPlans(mapped);
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

    const unsubscribe = ws.subscribe<WorkPlanDto>("work-plans", () => {
      void reload();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [reload]);

  return { plans, loading, reload };
}
