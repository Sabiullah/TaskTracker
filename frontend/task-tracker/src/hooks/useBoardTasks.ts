import { useMemo } from "react";
import type { Task } from "@/types";
import { computeStatus, getMonthKey, getProjectedDate, hasRecurringInstance, isRecurrenceVisible } from "@/utils/task";

export function useBoardTasks(baseTasks: Task[], selectedMonth: string) {
  const availableMonths = useMemo(() => {
    const keys = new Set<string>();
    const today = new Date();
    baseTasks.forEach((t) => {
      if ((t.recurrence || "Onetime") === "Onetime") {
        const mk = getMonthKey(t.targetDate);
        if (mk) keys.add(mk);
      } else {
        for (let offset = -1; offset <= 18; offset++) {
          const d = new Date(today.getFullYear(), today.getMonth() + offset, 1);
          if (hasRecurringInstance(t, d.getFullYear(), d.getMonth()))
            keys.add(
              `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
            );
        }
      }
    });
    return [...keys].sort();
  }, [baseTasks]);

  const boardTasks = useMemo(() => {
    if (!selectedMonth) return baseTasks.filter((t) => isRecurrenceVisible(t));
    const [y, m] = selectedMonth.split("-");
    const selYear = Number(y),
      selMonth = Number(m) - 1;
    return baseTasks
      .filter((t) =>
        (t.recurrence || "Onetime") === "Onetime"
          ? getMonthKey(t.targetDate) === selectedMonth
          : hasRecurringInstance(t, selYear, selMonth),
      )
      .map((t) => {
        if ((t.recurrence || "Onetime") === "Onetime") return t;
        const projectedDate = getProjectedDate(t, selYear, selMonth);
        const isDiffCycle = (t.targetDate || "").slice(0, 7) !== selectedMonth;
        const projected = {
          ...t,
          targetDate: projectedDate,
          ...(isDiffCycle
            ? { expectedDate: "", completedDate: "", remarks: "" }
            : {}),
        };
        return { ...projected, status: computeStatus(projected) };
      });
  }, [baseTasks, selectedMonth]);

  return { boardTasks, availableMonths };
}
