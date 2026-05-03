/**
 * Attendance DTOs — mirrors `/api/attendance/`.
 *
 * Django splits what used to be a single `status="WFH"` row on Supabase into
 * two orthogonal fields: `status` (presence) and `work_location` (where).
 * Round-tripping to the app's legacy `"WFH"` status happens in the mapper
 * layer (`src/lib/api/mappers.ts`).
 */

import type {
  BaseDto,
  IsoDate,
  IsoDateTime,
  IsoTime,
  Uid,
  UserRefDto,
} from "./common";

/** Presence values. */
export type AttendanceStatusValue = "Present" | "Absent" | "Half Day" | "Leave";

/** Location values. */
export type WorkLocationValue =
  | "Office"
  | "WFH"
  | "Client Site"
  | "Field"
  | "Other";

/** Approval state for WFH attendance rows (null for non-WFH). */
export type AttendanceApprovalState = "Pending" | "Approved" | "Rejected" | null;

/** Half-day discriminator on rows materialised from a half-day leave. */
export type LeaveSession = "First Half" | "Second Half";

/** Full attendance payload. */
export interface AttendanceDto extends BaseDto {
  readonly user_detail: UserRefDto;
  readonly date: IsoDate;
  readonly status: AttendanceStatusValue;
  /** True when an admin pinned the status — server skipped hours-based
   *  auto-derivation on the last save. */
  readonly manual_status_override: boolean;
  readonly work_location: WorkLocationValue;
  readonly login_time: IsoTime | null;
  readonly logout_time: IsoTime | null;
  /** logout - login in hours (rounded to 2dp). null when either time is missing. */
  readonly total_hours: number | null;
  readonly remarks: string;
  readonly approval_state: AttendanceApprovalState;
  readonly approver: number | null;
  readonly approver_detail: UserRefDto | null;
  readonly approved_at: IsoDateTime | null;
  readonly rejection_reason: string;
  readonly leave_session: LeaveSession | null;
}

/** Body for `POST /api/attendance/`. `created_by` is auto-set. */
export interface AttendanceCreate {
  readonly date: IsoDate;
  readonly status: AttendanceStatusValue;
  /** Admin opts the row out of hours-based auto-derivation. */
  readonly manual_status_override?: boolean;
  readonly work_location?: WorkLocationValue;
  readonly login_time?: IsoTime;
  readonly logout_time?: IsoTime;
  readonly remarks?: string;
  /** Admins may target another user; otherwise the server auto-sets to caller. */
  readonly user?: Uid;
}

/** Body for `PATCH /api/attendance/<uid>/`. */
export type AttendanceUpdate = Partial<AttendanceCreate>;

/**
 * Body for `POST /api/attendance/quick_punch/` (see `docs/misc_endpoints.md`).
 * Empty object — server decides whether to create or update today's row.
 */
export type AttendanceQuickPunchRequest = Record<string, never>;
