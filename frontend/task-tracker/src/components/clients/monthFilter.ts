/**
 * True when the given ISO-date string falls in the selected `YYYY-MM` month.
 *
 * Empty filter (`month === ""`) and null dates both return true so unplanned
 * items remain visible regardless of the active month.
 */
export function matchesMonth(dateStr: string | null, month: string): boolean {
  if (month === "") return true;
  if (dateStr === null) return true;
  return dateStr.startsWith(month);
}
