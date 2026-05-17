import type { Task } from "@/types";

/**
 * Predicates for the three "overdue" buckets surfaced on the Team Dashboard.
 *
 * These intentionally overlap — they are *views*, not a partition. See
 * docs/superpowers/specs/2026-05-17-dashboard-expected-date-overdue-filter-design.md
 */

/** Status-based overdue: the existing definition (targetDate < today AND not completed). */
export function isOverduePerTarget(task: Task): boolean {
  return task.status === "Overdue";
}

/**
 * Revised-ETA overdue: an `expectedDate` was committed AND has lapsed AND the
 * task isn't completed. Does NOT require `targetDate < today` — a future-target
 * row with an already-lapsed expectedDate still counts.
 */
export function isOverduePerExpected(task: Task, today: Date): boolean {
  if (!task.expectedDate) return false;
  if (task.completedDate) return false;
  const expected = new Date(task.expectedDate);
  expected.setHours(0, 0, 0, 0);
  return expected < today;
}

/** Overdue per target AND no revised ETA recorded yet. */
export function isOverdueNoExpectedSet(task: Task): boolean {
  return task.status === "Overdue" && !task.expectedDate;
}
