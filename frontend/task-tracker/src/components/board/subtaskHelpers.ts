/**
 * Pure helpers for subtask validation.
 * Kept in a separate module from SubtaskTable.tsx so the component file
 * exports only components (required by react-refresh/only-export-components).
 */
import type { SubtaskItem } from "@/types";

export function hasSubErrors(
  subs: readonly SubtaskItem[],
  mainTargetDate: string,
): boolean {
  return subs.some(
    (s) =>
      (!!s.targetDate && !!mainTargetDate && s.targetDate > mainTargetDate) ||
      (!!s.targetDate && !!s.expectedDate && s.expectedDate < s.targetDate),
  );
}
