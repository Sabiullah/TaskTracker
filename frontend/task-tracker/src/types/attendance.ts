import type { ID, DateString } from "./common";

export type AttendanceStatus =
  | "Present"
  | "Absent"
  | "Half Day"
  | "Leave"
  | string;

export interface AttendanceRecord {
  id: ID;
  user_id: ID;
  employee_name: string;
  date: DateString;
  login_time: string | null;
  logout_time: string | null;
  work_location: string | null;
  status: AttendanceStatus;
  remarks: string | null;
  updated_at?: string | null;
}
