/**
 * Growth plan DTOs — mirrors `/api/growth_plans/`.
 */

import type {
  BaseDto,
  IsoDate,
  Uid,
  UserRefDto,
} from "./common";

/** Allowed values for `GrowthPlan.status`. */
export type GrowthPlanStatusValue =
  | "Open"
  | "Under Progress"
  | "Completed"
  | "On Hold"
  | "Cancelled";

/** Allowed values for `GrowthPlan.priority`. */
export type GrowthPlanPriorityValue = "High" | "Medium" | "Low";

/** Full growth-plan payload. */
export interface GrowthPlanDto extends BaseDto {
  readonly activity: string;
  readonly target_month: IsoDate;
  readonly steps_taken: string;
  readonly steps_to_take: string;
  readonly status: GrowthPlanStatusValue;
  readonly priority: GrowthPlanPriorityValue;
  readonly remarks: string;
  readonly assigned_to: Uid | null;
  readonly assigned_to_detail: UserRefDto | null;
  readonly created_by_detail: UserRefDto | null;
}

/** Body for `POST /api/growth_plans/`. */
export interface GrowthPlanCreate {
  readonly activity: string;
  readonly target_month: IsoDate;
  readonly steps_taken?: string;
  readonly steps_to_take?: string;
  readonly status?: GrowthPlanStatusValue;
  readonly priority?: GrowthPlanPriorityValue;
  readonly remarks?: string;
  readonly assigned_to?: Uid;
  /** Org uid. Required when the caller belongs to 2+ orgs; ignored when the
   *  caller has exactly one membership (the backend picks it automatically). */
  readonly org?: Uid;
}

/** Body for `PATCH /api/growth_plans/<uid>/`. */
export type GrowthPlanUpdate = Partial<GrowthPlanCreate>;
