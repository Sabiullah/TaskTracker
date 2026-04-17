import type {
  PaceFocusAreaValue,
  PaceFrequencyValue,
  PaceGoalDto,
  PaceGoalPriorityValue,
  PaceGoalStatusValue,
  PaceGoalTypeValue,
  PaceIcebergLevelValue,
} from "./api";

/**
 * Goal form used by Add/Edit modal. `employee_name` is the display name —
 * the save flow resolves it to a `profile` uid against the profiles list.
 */
export interface GoalForm {
  id?: string;
  employee_name: string;
  goal_type: PaceGoalTypeValue;
  status: PaceGoalStatusValue;
  priority: PaceGoalPriorityValue;
  current_rating: number;
  target_rating: number;
  title?: string;
  description?: string;
  success_criteria?: string;
  frequency?: PaceFrequencyValue | "";
  target?: string;
  tracking_method?: string;
  learning_action?: string;
  completion_by?: string;
  iceberg_level?: PaceIcebergLevelValue | "";
  focus_area?: PaceFocusAreaValue | "";
  daily_practice?: string;
}

export interface ReviewForm {
  goal_id: string;
  review_date: string;
  previous_rating: number;
  new_rating: number;
  reviewer_name: string;
  comments: string;
}

/** `PaceGoalDto` augmented with a display `employee_name` derived from `profile_detail.full_name`. */
export type GoalRow = PaceGoalDto & { employee_name: string };
