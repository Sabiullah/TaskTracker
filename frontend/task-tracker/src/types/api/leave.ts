/**
 * LeaveRequest DTOs — mirrors `/api/leave-requests/`.
 *
 * The viewset surfaces `total_days` as a DRF DecimalField, which serialises to
 * a string. The mapper layer parses it to a number for app-side use.
 */

import type {
  BaseDto,
  IsoDate,
  IsoDateTime,
  Pk,
  Uid,
  UserRefDto,
} from "./common";

export type LeaveSessionValue = "Full" | "First Half" | "Second Half";
export type LeaveStatusValue =
  | "Pending"
  | "Approved"
  | "Rejected"
  | "Withdrawn";
export type LeaveRequestTypeValue = "Leave" | "WFH";

export interface LeaveRequestDto extends BaseDto {
  readonly org_uid: Uid | null;
  readonly user: Uid;
  readonly user_detail: UserRefDto;
  readonly from_date: IsoDate;
  readonly to_date: IsoDate;
  readonly from_session: LeaveSessionValue;
  readonly to_session: LeaveSessionValue;
  readonly reason: string;
  readonly request_type: LeaveRequestTypeValue;
  readonly status: LeaveStatusValue;
  readonly approver: Pk | null;
  readonly approver_detail: UserRefDto | null;
  readonly approved_at: IsoDateTime | null;
  readonly rejection_reason: string;
  /** DRF DecimalField — serialised as a string on the wire. */
  readonly total_days: string;
}

/** Body for `POST /api/leave-requests/`. The server reads `user` from raw
 *  request data, so it can be passed for admin-on-behalf-of flows. */
export interface LeaveRequestCreate {
  readonly user: Uid;
  readonly org: Uid;
  readonly from_date: IsoDate;
  readonly to_date: IsoDate;
  readonly from_session: LeaveSessionValue;
  readonly to_session: LeaveSessionValue;
  readonly reason: string;
  readonly request_type?: LeaveRequestTypeValue;
}

/** Body for `POST /api/leave-requests/<uid>/reject/`. */
export interface LeaveRequestReject {
  readonly reason: string;
}
