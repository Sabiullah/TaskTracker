import type {
  GrowthPlanPriorityValue,
  GrowthPlanStatusValue,
} from "./api";

/** Row shape used by the GrowthPlan table. `assigned_to` is the display name;
 *  `assigned_to_uid` is the FK we send on save. */
export interface PlanRow {
  id: string;
  activity: string;
  target_month: string;
  steps_taken: string;
  steps_to_take: string;
  status: GrowthPlanStatusValue;
  priority: GrowthPlanPriorityValue;
  assigned_to: string;
  assigned_to_uid: string | null;
  remarks: string;
}
