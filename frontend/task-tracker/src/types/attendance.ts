import type { ID, DateString } from "./common";

export type AttendanceStatus =
  | "Present"
  | "Absent"
  | "Half Day"
  | "Leave"
  | string;

export type AttendanceApprovalState =
  | "Pending"
  | "Approved"
  | "Rejected"
  | null;

export type AttendanceLeaveSession = "First Half" | "Second Half" | null;

export interface AttendanceRecord {
  id: ID;
  user_id: ID;
  employee_name: string;
  date: DateString;
  login_time: string | null;
  logout_time: string | null;
  total_hours?: number | null;
  work_location: string | null;
  status: AttendanceStatus;
  remarks: string | null;
  updated_at?: string | null;
  approval_state?: AttendanceApprovalState;
  approver_name?: string | null;
  approved_at?: string | null;
  rejection_reason?: string;
  leave_session?: AttendanceLeaveSession;
}
