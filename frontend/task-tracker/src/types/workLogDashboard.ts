import type { WorkLog } from "./worklog";

export type ChartMode = "daily" | "weekly" | "monthly";

export interface MemberStat {
  name: string;
  mins: number;
  count: number;
  days: Set<string>;
  clients: Set<string>;
}

export interface ClientStat {
  client: string;
  mins: number;
  count: number;
  members: Set<string>;
}

export interface DailyStat {
  date: string;
  mins: number;
  count: number;
}

export interface WeeklyStat {
  week: string;
  mins: number;
  count: number;
}

export interface MonthlyStat {
  month: string;
  mins: number;
  count: number;
}

export interface DrillState {
  title: string;
  rows: WorkLog[];
}
