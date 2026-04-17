import { localDateStr } from "@/utils/date";

export function generatePlanDates(
  startDate: string,
  recur: string,
  endMonth: string,
): string[] {
  if (recur === "onetime") return [startDate];
  const dates: string[] = [];
  const start = new Date(startDate + "T00:00:00"); // local midnight — no UTC shift
  const [ey, em] = endMonth.split("-").map(Number);
  const endLimit = new Date(ey, em, 0); // last day of end month (local)
  if (recur === "weekly") {
    const cur = new Date(start);
    while (cur <= endLimit) {
      dates.push(localDateStr(cur)); // ✅ local date, not UTC
      cur.setDate(cur.getDate() + 7);
    }
  } else if (recur === "monthly") {
    const dayOfMonth = start.getDate();
    let y = start.getFullYear(),
      m = start.getMonth();
    while (true) {
      const daysInM = new Date(y, m + 1, 0).getDate();
      const d = new Date(y, m, Math.min(dayOfMonth, daysInM));
      if (d > endLimit) break;
      dates.push(localDateStr(d)); // ✅ local date, not UTC
      m++;
      if (m > 11) {
        m = 0;
        y++;
      }
    }
  }
  return dates;
}
