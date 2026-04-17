import { localDateStr } from "@/utils/date";

/**
 * Validate a date against a backdate window.
 *
 * Returns `null` when the date is allowed, or a human-readable error string
 * when it violates the window. `backdateDays = -1` means no limit.
 *
 * Used by both work logs and attendance entries — any form that restricts how
 * far into the past a non-admin can record an event.
 */
export function checkBackdate(
  dateStr: string | null | undefined,
  backdateDays: number,
  isAdmin: boolean,
): string | null {
  if (backdateDays < 0) return null;
  if (!dateStr) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const entry = new Date(dateStr);
  entry.setHours(0, 0, 0, 0);
  if (isNaN(entry.getTime())) return null;
  if (entry.getTime() >= today.getTime()) return null;

  const diffDays = Math.floor((today.getTime() - entry.getTime()) / 86400000);
  if (diffDays <= backdateDays) return null;

  const hint = isAdmin
    ? " Change the Backdate dropdown to relax the restriction."
    : " Ask an admin to relax the restriction.";

  if (backdateDays === 0) {
    return `Backdated entries are not allowed. Only today's date (${localDateStr(today)}) is accepted.${hint}`;
  }
  return `This entry is ${diffDays} day(s) in the past, but the current rule allows only up to ${backdateDays} day(s) of backdating.${hint}`;
}
