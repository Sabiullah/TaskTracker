/**
 * Work plan DTOs — mirrors `/api/work_plans/`.
 *
 * `planned_hours` is a decimal string like `"2.00"` on the wire, same
 * constraint as `WorkLogDto.hours_worked`.
 */

import type {
  BaseDto,
  IsoDate,
  MasterRefDto,
  Uid,
  UserRefDto,
} from "./common";

export type WorkPlanRecurrenceValue = "" | "daily" | "weekly" | "monthly";

/** Full work-plan payload. */
export interface WorkPlanDto extends BaseDto {
  readonly assigned_to_detail: UserRefDto;
  readonly created_by_detail: UserRefDto | null;
  readonly date: IsoDate;
  readonly task_description: string;
  /** Decimal string, `"0.01".."24.00"`. */
  readonly planned_hours: string;

  readonly client: Uid | null;
  readonly client_detail: MasterRefDto | null;

  readonly org: Uid;
  readonly org_uid: Uid;

  /** Series tag — null for one-time rows and all legacy rows. */
  readonly series_uid: Uid | null;
  readonly recurrence: WorkPlanRecurrenceValue;
  readonly recurrence_end_date: IsoDate | null;
}

/** Body for `POST /api/work_plans/`. `created_by` is auto-set. */
export interface WorkPlanCreate {
  readonly assigned_to: Uid;
  readonly date: IsoDate;
  readonly task_description: string;
  readonly planned_hours: string;
  /** `null` explicitly clears the client; `undefined` leaves it unchanged. */
  readonly client?: Uid | null;
  readonly org?: Uid;
  readonly series_uid?: Uid | null;
  readonly recurrence?: WorkPlanRecurrenceValue;
  readonly recurrence_end_date?: IsoDate | null;
}

/** Body for `PATCH /api/work_plans/<uid>/`. */
export type WorkPlanUpdate = Partial<WorkPlanCreate>;

/** Body for `POST /api/work_plans/<uid>/apply_to_following/`. */
export interface WorkPlanApplyToFollowing {
  readonly date?: IsoDate;
  readonly task_description?: string;
  readonly planned_hours?: string;
  readonly client?: Uid | null;
}
