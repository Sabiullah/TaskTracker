import type { Task } from "@/types/task";

/**
 * Auto-compute task status from target_date and comp_date.
 * G = target_date, I = comp_date
 */
export function computeStatus(
  task: Partial<Pick<Task, "target_date" | "comp_date">>,
): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const G = task.target_date
    ? (() => {
        const d = new Date(task.target_date);
        d.setHours(0, 0, 0, 0);
        return d;
      })()
    : null;
  const I = task.comp_date
    ? (() => {
        const d = new Date(task.comp_date);
        d.setHours(0, 0, 0, 0);
        return d;
      })()
    : null;

  if (G && (G.getTime() - today.getTime()) / 86400000 === 1) return "Tomorrow";
  if (!G) return "TBC";
  if (!I && G.getTime() === today.getTime()) return "TodayTask";
  if (!I && G < today) return "Overdue";
  if (!I && G > today) return "Pending";
  if (I && I <= G) return "Ontime";
  if (I && I > G) return "Completed Delay";
  return "Pending";
}

/** Returns YYYY-MM string for a date string, or null if invalid. */
export function getMonthKey(dateStr: string): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Returns true if a recurring task has an instance in the given year/month.
 * month is 0-based (0 = Jan).
 */
export function hasRecurringInstance(
  task: Task,
  year: number,
  month: number,
): boolean {
  const r = task.recurrence || "Onetime";
  if (r === "Onetime" || !task.target_date) return false;

  const base = new Date(task.target_date);
  const diff = (year - base.getFullYear()) * 12 + (month - base.getMonth());
  if (diff < 0) return false;

  switch (r) {
    case "Monthly":
      return true;
    case "Quarterly":
      return diff % 3 === 0;
    case "Halfyearly":
      return diff % 6 === 0;
    case "Yearly":
      return diff % 12 === 0;
    default:
      return false;
  }
}

/**
 * Returns the projected YYYY-MM-DD date for a recurring task in the given year/month.
 * Day is clamped to the last day of the month.
 */
export function getProjectedDate(
  task: Task,
  year: number,
  month: number,
): string {
  const base = new Date(task.target_date);
  const day = Math.min(base.getDate(), new Date(year, month + 1, 0).getDate());
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Returns true if a recurring task should be visible on the board
 * (has an instance this month or next month).
 */
export function isRecurrenceVisible(task: Task): boolean {
  const r = task.recurrence || "Onetime";
  if (r === "Onetime" || !task.target_date) return true;

  const today = new Date();
  const cy = today.getFullYear(),
    cm = today.getMonth();
  const ny = cm === 11 ? cy + 1 : cy;
  const nm = cm === 11 ? 0 : cm + 1;

  return (
    hasRecurringInstance(task, cy, cm) || hasRecurringInstance(task, ny, nm)
  );
}
