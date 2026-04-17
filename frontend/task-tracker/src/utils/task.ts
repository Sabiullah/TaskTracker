import type { Task, TaskStatus } from "@/types";

/** Kanban board columns — order here is the visible order on the board. */
export const COLUMNS = [
  {
    id: "Future Task/Goals",
    title: "Future Goals",
    color: "#0052cc",
    bg: "#dbeafe",
  },
  { id: "TBC", title: "TBC", color: "#6b7280", bg: "#f3f4f6" },
  { id: "Pending", title: "Pending", color: "#d97706", bg: "#fef3c7" },
  { id: "Tomorrow", title: "Tomorrow", color: "#0891b2", bg: "#e0f2fe" },
  { id: "TodayTask", title: "Today", color: "#ea580c", bg: "#ffedd5" },
  { id: "Overdue", title: "Overdue", color: "#dc2626", bg: "#fee2e2" },
  { id: "Ontime", title: "On Time", color: "#16a34a", bg: "#dcfce7" },
  { id: "Completed", title: "Completed", color: "#15803d", bg: "#d1fae5" },
  {
    id: "Completed Delay",
    title: "Done (Delayed)",
    color: "#7c3aed",
    bg: "#ede9fe",
  },
];

/** Recurrence options for Task.recurrence. */
export const RECURRENCE_OPTIONS = [
  { value: "Onetime", label: "One-time", color: "#64748b" },
  { value: "Weekly", label: "Weekly", color: "#d97706" },
  { value: "Monthly", label: "Monthly", color: "#2563eb" },
  { value: "Quarterly", label: "Quarterly", color: "#7c3aed" },
  { value: "Halfyearly", label: "Half-yearly", color: "#0891b2" },
  { value: "Yearly", label: "Yearly", color: "#16a34a" },
];

/**
 * Auto-compute status from dates.
 * G = targetDate, I = completedDate
 */
export function computeStatus(
  task: Pick<Task, "targetDate" | "completedDate">,
): TaskStatus {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const G = task.targetDate
    ? (() => {
        const d = new Date(task.targetDate);
        d.setHours(0, 0, 0, 0);
        return d;
      })()
    : null;
  const I = task.completedDate
    ? (() => {
        const d = new Date(task.completedDate);
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

/**
 * Returns YYYY-MM string for a date string, or null if invalid.
 */
export function getMonthKey(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Check if a recurring task has an instance in a specific year/month.
 *  - Monthly:    every month on the same day
 *  - Quarterly:  every 3 months on the same day
 *  - Halfyearly: every 6 months on the same day
 *  - Yearly:     every 12 months on the same day
 */
export function hasRecurringInstance(
  task: Pick<Task, "recurrence" | "targetDate">,
  year: number,
  month: number,
): boolean {
  const r = task.recurrence || "Onetime";
  if (r === "Onetime" || !task.targetDate) return false;

  const base = new Date(task.targetDate);
  const baseYear = base.getFullYear();
  const baseMonth = base.getMonth();

  const diff = (year - baseYear) * 12 + (month - baseMonth);
  if (diff < 0) return false;

  switch (r) {
    case "Weekly":
      return true;
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
 * Return the projected targetDate string (YYYY-MM-DD) for a recurring task
 * in the given year/month. The day is taken from the base targetDate and
 * clamped to the last day of the target month.
 */
export function getProjectedDate(
  task: Pick<Task, "targetDate">,
  year: number,
  month: number,
): string {
  const base = new Date(task.targetDate);
  const baseDay = base.getDate();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const day = Math.min(baseDay, daysInMonth);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * For the "All months" board view: show a recurring task only if it has an
 * instance in the current month or the next month.
 */
export function isRecurrenceVisible(
  task: Pick<Task, "recurrence" | "targetDate">,
): boolean {
  const r = task.recurrence || "Onetime";
  if (r === "Onetime") return true;
  if (!task.targetDate) return true;

  const today = new Date();
  const curYear = today.getFullYear();
  const curMonth = today.getMonth();

  const thisMonth = hasRecurringInstance(task, curYear, curMonth);
  const nextYear = curMonth === 11 ? curYear + 1 : curYear;
  const nextMonth = curMonth === 11 ? 0 : curMonth + 1;
  const nxtMonth = hasRecurringInstance(task, nextYear, nextMonth);

  return thisMonth || nxtMonth;
}

/**
 * Returns a CSS class name for a task's date urgency:
 * "overdue" | "today" | "due-soon" | "ontime" | ""
 */
export function dateStatus(
  dateStr: string | null | undefined,
  status: string,
): string {
  if (!dateStr) return "";
  if (["Completed", "Completed Delay", "Ontime"].includes(status))
    return "ontime";
  const d = new Date(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  const diff = (d.getTime() - now.getTime()) / 86400000;
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff <= 3) return "due-soon";
  return "";
}
