import type { Task } from "@/types";
import { workMonthLabel } from "@/utils/date";

/**
 * Description as shown to users. For a Monthly *occurrence* — a materialized
 * child row (has a parent) with a target date — append the work-month it
 * covers, e.g. "BRS — Jun 2026". Main goals (no parent), Weekly/Onetime
 * tasks, and rows without a target date are returned unchanged.
 *
 * The month is derived live from target_date and never stored, so it cannot
 * go stale. This is the single source of truth for the on-screen label and
 * the Dashboard CSV export.
 */
export function taskDisplayDescription(task: Task): string {
  const base = task.description || "";
  if (task.recurrence !== "Monthly" || task.parentId == null || !task.targetDate) {
    return base;
  }
  const label = workMonthLabel(task.targetDate);
  return label ? `${base} — ${label}` : base;
}
