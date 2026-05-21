/**
 * PACE DTOs — mirrors the (planned) endpoints documented in `docs/pace_api.md`.
 *
 * Resources: `pace_goals`, `pace_goal_reviews`, `pace_meetings`,
 * `pace_checklist`, `client_classifications`.
 */

import type {
  BaseDto,
  IsoDate,
  IsoTime,
  MasterRefDto,
  Pk,
  Uid,
  UserRefDto,
} from "./common";

// ─── pace_goals ──────────────────────────────────────────────────────────────

export type PaceGoalTypeValue = "Result" | "Skill" | "Attitude";
export type PaceGoalStatusValue =
  | "Not Started"
  | "In Progress"
  | "Achieved"
  | "Needs Attention";
export type PaceGoalPriorityValue = "Critical" | "Development" | "Stretch";
export type PaceIcebergLevelValue =
  | "Skill"
  | "Knowledge"
  | "Self-Image"
  | "Trait"
  | "Motive";
export type PaceFocusAreaValue =
  | "Practice"
  | "Build Habit"
  | "Strengthen"
  | "Deepen"
  | "Develop";
export type PaceFrequencyValue =
  | "Weekly"
  | "Monthly"
  | "Quarterly"
  | "45 Days"
  | "Fortnightly";

export interface PaceGoalDto extends BaseDto {
  readonly profile: Uid;
  readonly profile_detail: UserRefDto;
  readonly goal_type: PaceGoalTypeValue;
  readonly title: string;
  readonly description: string;
  readonly status: PaceGoalStatusValue;
  readonly priority: PaceGoalPriorityValue;
  readonly current_rating: number;
  readonly target_rating: number;

  readonly success_criteria: string;
  readonly frequency: PaceFrequencyValue | "";
  readonly target: string;
  readonly tracking_method: string;

  readonly learning_action: string;
  readonly completion_by: IsoDate | null;

  readonly iceberg_level: PaceIcebergLevelValue | "";
  readonly focus_area: PaceFocusAreaValue | "";
  readonly daily_practice: string;

  readonly org: Uid;
  readonly org_uid: Uid;
  readonly created_by_detail: UserRefDto | null;
}

export interface PaceGoalCreate {
  readonly profile?: Uid;
  readonly goal_type: PaceGoalTypeValue;
  readonly title: string;
  readonly description?: string;
  readonly status?: PaceGoalStatusValue;
  readonly priority?: PaceGoalPriorityValue;
  readonly current_rating?: number;
  readonly target_rating?: number;
  readonly success_criteria?: string;
  readonly frequency?: PaceFrequencyValue;
  readonly target?: string;
  readonly tracking_method?: string;
  readonly learning_action?: string;
  readonly completion_by?: IsoDate;
  readonly iceberg_level?: PaceIcebergLevelValue;
  readonly focus_area?: PaceFocusAreaValue;
  readonly daily_practice?: string;
}

export type PaceGoalUpdate = Partial<PaceGoalCreate>;

// ─── pace_goal_reviews ───────────────────────────────────────────────────────

export interface PaceGoalReviewDto extends BaseDto {
  readonly goal: Pk;
  readonly goal_uid: Uid;
  readonly review_date: IsoDate;
  readonly previous_rating: number;
  readonly new_rating: number;
  readonly reviewer_name: string;
  readonly reviewed_by_detail: UserRefDto | null;
  readonly comments: string;
}

export interface PaceGoalReviewCreate {
  readonly goal: Uid;
  readonly review_date: IsoDate;
  readonly previous_rating: number;
  readonly new_rating: number;
  readonly reviewer_name?: string;
  readonly comments?: string;
}

// ─── pace_meetings ───────────────────────────────────────────────────────────

export type PaceMeetingTypeValue = "Strategic" | "Tactical" | "Operational";
export type PaceMeetingStatusValue =
  | "Scheduled"
  | "In Progress"
  | "Completed"
  | "Cancelled";
export type PaceActionItemStatusValue = "Open" | "Done";

export interface PaceActionItem {
  readonly task: string;
  readonly assignee: string;
  readonly due_date: IsoDate | "";
  readonly status: PaceActionItemStatusValue;
}

export interface PaceMeetingDto extends BaseDto {
  readonly title: string;
  readonly meeting_type: PaceMeetingTypeValue;
  readonly scheduled_date: IsoDate;
  readonly scheduled_time: IsoTime | null;
  readonly duration_minutes: number;
  readonly status: PaceMeetingStatusValue;
  readonly agenda: string;
  readonly minutes: string;
  readonly attendees: readonly string[];
  readonly action_items: readonly PaceActionItem[];
  readonly conducted_by: string;
  readonly org: Uid;
  readonly org_uid: Uid;
  readonly created_by_detail: UserRefDto | null;
}

export interface PaceMeetingCreate {
  readonly title: string;
  readonly meeting_type: PaceMeetingTypeValue;
  readonly scheduled_date: IsoDate;
  readonly scheduled_time?: IsoTime;
  readonly duration_minutes?: number;
  readonly status?: PaceMeetingStatusValue;
  readonly agenda?: string;
  readonly minutes?: string;
  readonly attendees?: readonly string[];
  readonly action_items?: readonly PaceActionItem[];
  readonly conducted_by?: string;
}

export type PaceMeetingUpdate = Partial<PaceMeetingCreate>;

// ─── pace_checklist ──────────────────────────────────────────────────────────

export interface PaceChecklistDto extends BaseDto {
  readonly fy: string;
  readonly week_number: number;
  readonly item_number: number;
  readonly action_item: string;
  readonly done: boolean;
  readonly notes: string;
  readonly updated_by_detail: UserRefDto | null;
  readonly org: Uid;
  readonly org_uid: Uid;
}

export interface PaceChecklistCreate {
  readonly fy: string;
  readonly week_number: number;
  readonly item_number: number;
  readonly action_item: string;
  readonly done?: boolean;
  readonly notes?: string;
}

export type PaceChecklistUpdate = Partial<PaceChecklistCreate>;

// ─── client_classifications ─────────────────────────────────────────────────

export type ClientClassificationValue = "A" | "B" | "C" | "D";
export type ClientRevenueTierValue = "High" | "Medium" | "Low";
export type ClientStrategicImportanceValue =
  | "Critical"
  | "Important"
  | "Moderate"
  | "Low";
export type ClientRelationshipHealthValue =
  | "Strong"
  | "Good"
  | "At Risk"
  | "Declining";
export type ClientGrowthPotentialValue = "High" | "Medium" | "Low";
export type ClientRiskLevelValue = "High" | "Medium" | "Low";

export interface ClientClassificationDto extends BaseDto {
  readonly client: Uid;
  readonly client_detail: MasterRefDto;
  readonly classification: ClientClassificationValue | "";
  readonly revenue_tier: ClientRevenueTierValue | "";
  readonly strategic_importance: ClientStrategicImportanceValue | "";
  readonly relationship_health: ClientRelationshipHealthValue | "";
  readonly growth_potential: ClientGrowthPotentialValue | "";
  readonly risk_level: ClientRiskLevelValue | "";
  readonly notes: string;
  readonly updated_by_detail: UserRefDto | null;
  readonly org: Uid;
  readonly org_uid: Uid;
}

export interface ClientClassificationCreate {
  readonly client: Uid;
  readonly classification?: ClientClassificationValue;
  readonly revenue_tier?: ClientRevenueTierValue;
  readonly strategic_importance?: ClientStrategicImportanceValue;
  readonly relationship_health?: ClientRelationshipHealthValue;
  readonly growth_potential?: ClientGrowthPotentialValue;
  readonly risk_level?: ClientRiskLevelValue;
  readonly notes?: string;
}

export type ClientClassificationUpdate = Partial<ClientClassificationCreate>;

/** Body for `POST /api/client_classifications/upsert/`. */
export type ClientClassificationUpsertRequest = ClientClassificationCreate;

// ── Operational Standup (daily standup grid) ──────────────────────────────

export type BreakthroughTypeValue = "Breakdown" | "Breakthrough" | "";
export type OperationalStandupApprovalStatus = "Pending" | "Approved";

export interface OperationalStandupApprovalDto {
  readonly uid: string;
  readonly org_uid: string;
  readonly org_name: string;
  readonly status: OperationalStandupApprovalStatus;
  readonly approved_by_detail: UserRefDto | null;
  readonly approved_at: string | null;
  readonly reviewed_by_detail: UserRefDto | null;
  readonly reviewed_at: string | null;
}

export interface OperationalStandupDto extends BaseDto {
  readonly profile: string; // uid
  readonly profile_detail: UserRefDto;
  readonly standup_date: string; // YYYY-MM-DD
  readonly breakthrough_type: BreakthroughTypeValue;
  readonly priorities: string;
  readonly collaboration_need: string;
  readonly remarks: string;
  readonly created_by_detail: UserRefDto | null;
  readonly approvals: readonly OperationalStandupApprovalDto[];
}

export interface OperationalStandupCreate {
  profile: string;
  standup_date: string;
  breakthrough_type: BreakthroughTypeValue;
  priorities: string;
  collaboration_need: string;
  remarks: string;
}

export interface OperationalStandupRosterApproval {
  readonly uid: string;
  readonly org_uid: string;
  readonly org_name: string;
  readonly status: OperationalStandupApprovalStatus;
  readonly approved_by: { uid: string; full_name: string } | null;
  readonly approved_at: string | null;
  readonly reviewed_by: { uid: string; full_name: string } | null;
  readonly reviewed_at: string | null;
  readonly can_act: boolean;
}

export interface OperationalStandupRosterRow {
  readonly profile: UserRefDto;
  readonly entry: OperationalStandupDto | null;
  readonly approvals: readonly OperationalStandupRosterApproval[];
  readonly can_edit: boolean;
}

export interface PendingCountResponse {
  readonly count: number;
}

export interface BulkReviewResponse {
  readonly approved_count: number;
  readonly reviewed_count: number;
}
