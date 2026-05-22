import type {
  LeaveRequestTypeValue,
  LeaveSessionValue,
  LeaveStatusValue,
} from "./api/leave";

export type {
  LeaveRequestTypeValue,
  LeaveSessionValue,
  LeaveStatusValue,
} from "./api/leave";

export interface LeaveRequest {
  /** UUID — primary identifier in app code. */
  id: string;
  user_uid: string;
  user_name: string;
  org_uid: string | null;
  from_date: string;
  to_date: string;
  from_session: LeaveSessionValue;
  to_session: LeaveSessionValue;
  reason: string;
  request_type: LeaveRequestTypeValue;
  status: LeaveStatusValue;
  approver_name: string | null;
  approved_at: string | null;
  rejection_reason: string;
  total_days: number;
}
