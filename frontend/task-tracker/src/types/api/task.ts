/**
 * Task DTOs — mirrors `/api/tasks/` and `/api/task_logs/`.
 */

import type {
  BaseDto,
  MasterRefDto,
  OrgRefDto,
  Pk,
  Uid,
  UserRefDto,
  IsoDate,
  IsoDateTime,
} from "./common";

/** Allowed values for `Task.status`. */
export type TaskStatusValue =
  | "pending"
  | "today_task"
  | "tomorrow"
  | "in_progress"
  | "completed"
  | "completed_delay"
  | "overdue"
  | "future_goal"
  | "tbc"
  | "archived";

/** Allowed values for `Task.recurrence`. */
export type TaskRecurrenceValue =
  | "onetime"
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "halfyearly"
  | "yearly";

/** Full task payload. */
export interface TaskDto extends BaseDto {
  readonly serial_no: number;
  readonly title: string;
  readonly description: string;
  readonly status: TaskStatusValue;
  readonly recurrence: TaskRecurrenceValue;
  readonly target_date: IsoDate | null;
  readonly expected_date: IsoDate | null;
  readonly completed_date: IsoDate | null;
  readonly remarks: string;

  readonly client: Uid | null;
  readonly client_detail: MasterRefDto | null;

  readonly category: Uid | null;
  readonly category_detail: MasterRefDto | null;

  readonly org: Uid;
  readonly org_uid: Uid;

  readonly parent: Uid | null;

  readonly responsible: Uid | null;
  readonly responsible_detail: UserRefDto | null;

  readonly reporting_manager: Uid | null;
  readonly reporting_manager_detail: UserRefDto | null;

  readonly created_by_detail: UserRefDto | null;

  /** Canonical link to the plan that produced this child row. NULL for the
   *  main goal and for legacy/manual children with no plan. Used by the
   *  modal to join a row to its plan without relying on category (which is
   *  NULL for free-entry plans). */
  readonly plan_uid: Uid | null;

  readonly engagement_start?: IsoDate | null;
  readonly engagement_end?: IsoDate | null;
}

/** Body for `POST /api/tasks/` — `description` is the one required field. */
export interface TaskCreate {
  readonly description: string;
  readonly title?: string;
  readonly status?: TaskStatusValue;
  readonly recurrence?: TaskRecurrenceValue;
  readonly target_date?: IsoDate | null;
  readonly expected_date?: IsoDate | null;
  readonly completed_date?: IsoDate | null;
  readonly remarks?: string;
  readonly client?: Uid;
  readonly category?: Uid;
  readonly org?: Uid;
  readonly responsible?: Uid;
  readonly reporting_manager?: Uid;
  readonly parent?: Uid | null;
}

/** Body for `PATCH /api/tasks/<uid>/`. `serial_no` is immutable. */
export type TaskUpdate = Partial<TaskCreate>;

/** One change entry inside a `TaskLogDto.changes` array. */
export interface TaskLogChange {
  readonly field: string;
  readonly from: string;
  readonly to: string;
}

/** Full task-log payload from `GET /api/task_logs/`. */
export interface TaskLogDto {
  readonly id: Pk;
  readonly changed_by: UserRefDto | null;
  readonly changed_by_name: string;
  readonly changed_at: IsoDateTime;
  readonly changes: readonly TaskLogChange[];
}

/** Body for `POST /api/task_logs/` — audit rows are append-only. */
export interface TaskLogCreate {
  readonly task_uid: Uid;
  readonly changes: readonly TaskLogChange[];
}

/** One row in the `POST /api/tasks/bulk_create/` request. */
export type TaskBulkCreateRow = TaskCreate;

/**
 * `org_detail` expansion — NOT currently returned by `/api/tasks/` but reserved
 * for the case where the backend later expands `org` into `org_detail`.
 */
export type TaskOrgDetail = OrgRefDto;

/** One sub-row inside a goal-level create/update body. */
export interface SubtaskItemDto {
  readonly uid?: Uid;
  readonly description: string;
  readonly category?: Uid | null;
  readonly responsible?: Uid | null;
  readonly target_date?: IsoDate | null;
  readonly expected_date?: IsoDate | null;
  readonly completed_date?: IsoDate | null;
  readonly remarks?: string;
}

/** Body for `POST/PATCH /api/tasks/` when sending a Main + Subs tree. */
export interface TaskWithSubtasksCreate extends TaskCreate {
  readonly subtasks: readonly SubtaskItemDto[];
}

/** Plan row payload from the server. Mirrors `TaskSubcategoryPlan`. */
export interface TaskSubcategoryPlanDto {
  readonly uid: Uid;
  /** NULL for a free-entry plan; its name lives in `description` instead. */
  readonly subcategory: Uid | null;
  readonly subcategory_detail: MasterRefDto | null;
  readonly description: string;
  readonly recurrence: TaskRecurrenceValue;
  readonly target_day: number | null;
  readonly default_owner: Uid | null;
  readonly default_owner_detail: UserRefDto | null;
  readonly active_from_month: IsoDate;  // First-of-month
  readonly active_until_month: IsoDate | null;
}

/** Body for `POST /api/tasks/<uid>/plans/`. */
export interface PlanAddRequest {
  readonly subcategory: Uid;
  readonly month: string;  // "YYYY-MM"
  readonly default_owner?: Uid;
}

/** Response from `POST /api/tasks/<uid>/plans/`. */
export interface PlanAddResponse {
  readonly plan: TaskSubcategoryPlanDto;
  readonly child: TaskDto | null;
}

/** Response from `DELETE /api/tasks/<uid>/plans/<plan_uid>/?from_month=...`. */
export interface PlanCapResponse {
  readonly plan_capped: boolean;
  readonly plan_deleted: boolean;
  readonly children_deleted: number;
}

/** Body for `POST /api/tasks/` when sending plans (replaces `subtasks`). */
export interface TaskWithPlansCreate extends TaskCreate {
  readonly engagement_start?: IsoDate;
  readonly engagement_end?: IsoDate;
  readonly plans: ReadonlyArray<{
    /** NULL for a free-entry plan (no master sub-category); `description`
     *  carries its name instead. */
    readonly subcategory: Uid | null;
    readonly description?: string;
    readonly default_owner?: Uid;
    /** Per-row recurrence override. Caller should always send the master's
     *  current value so the plan reflects the user's latest configuration —
     *  without it the backend falls back to whatever's on the master, which
     *  can be a stale empty string for legacy rows. Required for free plans. */
    readonly recurrence?: string;
    /** Per-row target-day override. For Weekly this is the ISO weekday
     *  (1=Mon..7=Sun); for cadenced recurrences it's the day-of-month. */
    readonly target_day?: number | null;
    /** First-of-month the plan starts materialising. For free plans the
     *  frontend sets this to the row's target month. */
    readonly active_from_month?: IsoDate;
  }>;
}

/** Response from `GET /api/tasks/<uid>/?month=YYYY-MM`. */
export interface MonthScopedTaskDto extends TaskDto {
  readonly engagement_start: IsoDate | null;
  readonly engagement_end: IsoDate | null;
  readonly subtasks: ReadonlyArray<TaskDto>;
  readonly plans: ReadonlyArray<TaskSubcategoryPlanDto>;
}
