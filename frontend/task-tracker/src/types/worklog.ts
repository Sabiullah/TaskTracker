import type { ID, DateString } from "./common";

export interface WorkLog {
  id: ID;
  name: string;
  date: DateString;
  day: string;
  client: string;
  task_description: string;
  /** `"H:MM"` string (e.g. `"3:30"`). Converted to decimal at the API boundary. */
  hours_worked: string;
  priority: string;
  organization: string;
  sort_order: number | null;
}

export interface WorkLogFilter {
  name: string;
  client: string;
  dateFrom: DateString;
  dateTo: DateString;
}

export interface WorkPlan {
  id: ID;
  user_id: ID;
  name: string;
  date: DateString;
  day: string;
  client: string;
  task_description: string;
  /** `"H:MM"` string. Converted to decimal at the API boundary. */
  hours_planned: string;
  priority: string;
  organization: string;
  sort_order: number | null;
  /** Null for one-time and legacy rows. */
  series_uid: string | null;
  /** `""` for one-time. */
  recurrence: "" | "daily" | "weekly" | "monthly";
  /** `"YYYY-MM-DD"` or null. */
  recurrence_end_date: DateString | null;
}
