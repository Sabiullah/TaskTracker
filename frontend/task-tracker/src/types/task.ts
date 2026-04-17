import type { ID, DateString } from "./common";

// TaskStatus values must exactly match the `id` fields of COLUMNS in src/data/initialData.js
export type TaskStatus =
  | "Future Task/Goals"
  | "TBC"
  | "Pending"
  | "Tomorrow"
  | "TodayTask"
  | "Overdue"
  | "Ontime"
  | "Completed"
  | "Completed Delay";

// RecurrenceType values must exactly match the `value` fields of RECURRENCE_OPTIONS in src/data/initialData.js
export type RecurrenceType =
  | "Onetime"
  | "Weekly"
  | "Monthly"
  | "Quarterly"
  | "Halfyearly"
  | "Yearly";

export interface Task {
  id: ID;
  serialNo: number | null;
  client: string;
  category: string;
  description: string;
  status: TaskStatus;
  targetDate: DateString;
  expectedDate: DateString;
  completedDate: DateString;
  responsible: string;
  remarks: string;
  recurrence: RecurrenceType;
  organization: string;
  createdBy: ID | null;
  createdAt: string | null;
}

export interface TaskDbRow {
  id: ID;
  s_no: number | null;
  client: string | null;
  category: string | null;
  description: string | null;
  status: string | null;
  target_date: DateString | null;
  expected_date: DateString | null;
  comp_date: DateString | null;
  responsible: string | null;
  remarks: string | null;
  recurrence: string | null;
  organization: string | null;
  created_by: ID | null;
  created_at: string | null;
}

export interface ParsedTask {
  id: string;
  serialNo: number;
  client: string;
  category: string;
  description: string;
  status: string;
  targetDate: string;
  expectedDate: string;
  completedDate: string;
  responsible: string;
  remarks: string;
  recurrence: string;
}

export interface TaskLogEntry {
  id: ID;
  task_id: ID;
  changed_by: ID | null;
  changed_by_name: string;
  changed_at: string;
  changes: Array<{ field: string; from: string; to: string }>;
}
