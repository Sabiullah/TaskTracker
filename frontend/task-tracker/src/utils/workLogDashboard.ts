import { toMins } from "@/utils/time";
import type { WorkLog } from "@/types";
import type {
  ClientStat,
  DailyStat,
  MemberStat,
  MonthlyStat,
  WeeklyStat,
} from "@/types/workLogDashboard";

export function computeMemberStats(rows: WorkLog[]): MemberStat[] {
  const map: Record<string, MemberStat> = {};
  rows.forEach((r) => {
    if (!r.name) return;
    if (!map[r.name])
      map[r.name] = {
        name: r.name,
        mins: 0,
        count: 0,
        days: new Set(),
        clients: new Set(),
      };
    map[r.name].mins += toMins(r.hours_worked);
    map[r.name].count += 1;
    map[r.name].days.add(r.date);
    if (r.client) map[r.name].clients.add(r.client);
  });
  return Object.values(map).sort((a, b) => b.mins - a.mins);
}

export function computeClientStats(rows: WorkLog[]): ClientStat[] {
  const map: Record<string, ClientStat> = {};
  rows.forEach((r) => {
    const c = r.client || "No Client";
    if (!map[c]) map[c] = { client: c, mins: 0, count: 0, members: new Set() };
    map[c].mins += toMins(r.hours_worked);
    map[c].count += 1;
    map[c].members.add(r.name);
  });
  return Object.values(map).sort((a, b) => b.mins - a.mins);
}

/** Last 14 days of daily totals. */
export function computeDailyStats(rows: WorkLog[]): DailyStat[] {
  const map: Record<string, DailyStat> = {};
  rows.forEach((r) => {
    if (!r.date) return;
    if (!map[r.date]) map[r.date] = { date: r.date, mins: 0, count: 0 };
    map[r.date].mins += toMins(r.hours_worked);
    map[r.date].count += 1;
  });
  return Object.values(map)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-14);
}

/** Last 10 Mon-based weeks. */
export function computeWeeklyStats(rows: WorkLog[]): WeeklyStat[] {
  const map: Record<string, WeeklyStat> = {};
  rows.forEach((r) => {
    if (!r.date) return;
    const d = new Date(r.date);
    const day = d.getDay() || 7; // Mon=1..Sun=7
    const mon = new Date(d);
    mon.setDate(d.getDate() - day + 1);
    const key = mon.toISOString().slice(0, 10);
    if (!map[key]) map[key] = { week: key, mins: 0, count: 0 };
    map[key].mins += toMins(r.hours_worked);
    map[key].count += 1;
  });
  return Object.values(map)
    .sort((a, b) => a.week.localeCompare(b.week))
    .slice(-10);
}

/** Last 12 months of YYYY-MM totals. */
export function computeMonthlyStats(rows: WorkLog[]): MonthlyStat[] {
  const map: Record<string, MonthlyStat> = {};
  rows.forEach((r) => {
    if (!r.date) return;
    const key = r.date.slice(0, 7);
    if (!map[key]) map[key] = { month: key, mins: 0, count: 0 };
    map[key].mins += toMins(r.hours_worked);
    map[key].count += 1;
  });
  return Object.values(map)
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-12);
}
