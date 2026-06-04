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
    if (!selectedMonth) {
      // "All months" view: project recurring tasks to the current month so
      // the stored status (often Ontime/Completed from the base cycle) does
      // not mask live overdue instances in the totals and columns.
      const today = new Date();
      const curY = today.getFullYear();
      const curM = today.getMonth();
      const curPeriod = `${curY}-${String(curM + 1).padStart(2, "0")}`;
      return baseTasks
        .filter((t) => isRecurrenceVisible(t))
        .map((t) => {
          const r = t.recurrence || "Onetime";
          if (r === "Onetime") return t;
          if (!hasRecurringInstance(t, curY, curM)) return t;
          const projectedDate = getProjectedDate(t, curY, curM);
          // Blank the recurring fields only when projecting to a cycle the
          // row neither belongs to NOR was completed in. A materialised
          // monthly child carries a real completed_date; wiping it on a
          // different-cycle projection made a just-completed task recompute
          // back to Overdue (mirrors the DashboardPage projection fix).
          const otherCycle =
            (t.targetDate || "").slice(0, 7) !== curPeriod &&
            (t.completedDate || "").slice(0, 7) !== curPeriod;
          const projected = {
            ...t,
            targetDate: projectedDate,
            ...(otherCycle
              ? { expectedDate: "", completedDate: "", remarks: "" }
              : {}),
          };
          return { ...projected, status: computeStatus(projected) };
        });
    }
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
        const otherCycle =
          (t.targetDate || "").slice(0, 7) !== selectedMonth &&
          (t.completedDate || "").slice(0, 7) !== selectedMonth;
        const projected = {
          ...t,
          targetDate: projectedDate,
          ...(otherCycle
            ? { expectedDate: "", completedDate: "", remarks: "" }
            : {}),
        };
        return { ...projected, status: computeStatus(projected) };
      });
  }, [baseTasks, selectedMonth]);

  return { boardTasks, availableMonths };
}
