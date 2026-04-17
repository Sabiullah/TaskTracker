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
}

/** Body for `POST /api/work_plans/`. `created_by` is auto-set. */
export interface WorkPlanCreate {
  readonly assigned_to: Uid;
  readonly date: IsoDate;
  readonly task_description: string;
  readonly planned_hours: string;
  readonly client?: Uid;
  readonly org?: Uid;
}

/** Body for `PATCH /api/work_plans/<uid>/`. */
export type WorkPlanUpdate = Partial<WorkPlanCreate>;
