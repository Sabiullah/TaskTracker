import { localDateStr } from "@/utils/date";

/**
 * Build the list of dates a work plan should be created for.
 *
 * - `onetime` → just `startDate`.
 * - `daily` → every day from `startDate` through `endDate`, skipping Sundays
 *   and any date present in `skipDates` (typically holidays).
 * - `weekly` → same weekday, every 7 days, until `endDate`.
 * - `monthly` → same day-of-month, every month, until `endDate`.
 *
 * `endDate` is `YYYY-MM-DD`. `endDate` is required for everything except
 * `onetime`; if missing, the generator returns an empty list.
 */
export function generatePlanDates(
  startDate: string,
  recur: string,
  endDate: string,
  skipDates: ReadonlySet<string> = new Set<string>(),
): string[] {
  if (!startDate) return [];
  if (recur === "onetime") return [startDate];
  if (!endDate) return [];

  const start = new Date(startDate + "T00:00:00"); // local midnight — no UTC shift
  const end = new Date(endDate + "T00:00:00");
  if (start > end) return [];

  const dates: string[] = [];

  if (recur === "daily") {
    const cur = new Date(start);
    while (cur <= end) {
      const ds = localDateStr(cur);
      // Skip Sundays (getDay() === 0) and any date the caller flagged
      // (holidays). Saturdays remain working days here — match the rest of
      // the worklog UI which only treats Sunday as a hard non-working day
      // in the recurring planner.
      if (cur.getDay() !== 0 && !skipDates.has(ds)) {
        dates.push(ds);
      }
      cur.setDate(cur.getDate() + 1);
    }
  } else if (recur === "weekly") {
    const cur = new Date(start);
    while (cur <= end) {
      dates.push(localDateStr(cur));
      cur.setDate(cur.getDate() + 7);
    }
  } else if (recur === "monthly") {
    const dayOfMonth = start.getDate();
    let y = start.getFullYear();
    let m = start.getMonth();
    while (true) {
      const daysInM = new Date(y, m + 1, 0).getDate();
      const d = new Date(y, m, Math.min(dayOfMonth, daysInM));
      if (d > end) break;
      dates.push(localDateStr(d));
      m++;
      if (m > 11) {
        m = 0;
        y++;
      }
    }
  }
  return dates;
}
