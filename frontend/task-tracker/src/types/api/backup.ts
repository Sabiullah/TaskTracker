/**
 * Backup / restore DTOs — mirrors the (planned) endpoints in
 * `docs/backup_restore_api.md`.
 */

import type { AppSettingDto } from "./appSetting";
import type { AttendanceDto } from "./attendance";
import type { ChatMemberDto, ChatMessageDto, ChatRoomDto } from "./chat";
import type { IsoDateTime, Uid } from "./common";
import type { EmployeeDto, EmployeeSalaryDto } from "./employee";
import type { GrowthPlanDto } from "./growthPlan";
import type { HolidayDto } from "./holiday";
import type { InvoiceEntryDto, InvoicePlanDto } from "./invoice";
import type { LeadDto, LeadHistoryDto, LeadStatusDto } from "./lead";
import type { MasterDto } from "./master";
import type { NoticeDto } from "./notice";
import type { OrgDto } from "./org";
import type {
  ClientClassificationDto,
  PaceChecklistDto,
  PaceGoalDto,
  PaceGoalReviewDto,
  PaceMeetingDto,
} from "./pace";
import type { ProfileDto } from "./profile";
import type { TaskDto, TaskLogDto } from "./task";
import type { WorkLogDto } from "./workLog";
import type { WorkPlanDto } from "./workPlan";

/** The `resources` object returned by `GET /api/backup/`. */
export interface BackupResources {
  readonly orgs: readonly OrgDto[];
  readonly profiles: readonly ProfileDto[];
  readonly masters: readonly MasterDto[];
  readonly app_settings: readonly AppSettingDto[];
  readonly tasks: readonly TaskDto[];
  readonly task_logs: readonly TaskLogDto[];
  readonly work_logs: readonly WorkLogDto[];
  readonly work_plans: readonly WorkPlanDto[];
  readonly attendance: readonly AttendanceDto[];
  readonly holidays: readonly HolidayDto[];
  readonly notices: readonly NoticeDto[];
  readonly leads: readonly LeadDto[];
  readonly lead_statuses: readonly LeadStatusDto[];
  readonly lead_history: readonly LeadHistoryDto[];
  readonly invoice_plans: readonly InvoicePlanDto[];
  readonly invoice_entries: readonly InvoiceEntryDto[];
  readonly chat_rooms: readonly ChatRoomDto[];
  readonly chat_members: readonly ChatMemberDto[];
  readonly chat_messages: readonly ChatMessageDto[];
  readonly employees: readonly EmployeeDto[];
  readonly employee_salary: readonly EmployeeSalaryDto[];
  readonly growth_plans: readonly GrowthPlanDto[];
  readonly pace_goals: readonly PaceGoalDto[];
  readonly pace_goal_reviews: readonly PaceGoalReviewDto[];
  readonly pace_meetings: readonly PaceMeetingDto[];
  readonly pace_checklist: readonly PaceChecklistDto[];
  readonly client_classifications: readonly ClientClassificationDto[];
}

/** Minimal "who exported this" marker inside the backup payload. */
export interface BackupGeneratedBy {
  readonly uid: Uid;
  readonly username: string;
}

/** Full `GET /api/backup/` response body. */
export interface BackupPayload {
  readonly schema_version: number;
  readonly generated_at: IsoDateTime;
  readonly generated_by: BackupGeneratedBy;
  readonly org_uid: Uid;
  readonly counts: Readonly<Record<string, number>>;
  readonly resources: BackupResources;
}

/** Mode for `POST /api/backup/restore/`. */
export type BackupRestoreMode = "upsert" | "replace";

/** Body for `POST /api/backup/restore/`. */
export interface BackupRestoreRequest {
  readonly confirm: true;
  readonly mode: BackupRestoreMode;
  readonly schema_version: number;
  readonly resources: BackupResources;
}

/** Per-resource aggregate in the restore response. */
export interface BackupRestoreResourceSummary {
  readonly inserted: number;
  readonly updated: number;
  readonly failed: number;
}

/** One error entry in the restore response. */
export interface BackupRestoreError {
  readonly resource: string;
  readonly index: number;
  readonly error: string;
  readonly row: unknown;
}

/** Full `POST /api/backup/restore/` response body. */
export interface BackupRestoreResponse {
  readonly mode: BackupRestoreMode;
  readonly summary: {
    readonly resources_processed: number;
    readonly total_rows: number;
    readonly inserted: number;
    readonly updated: number;
    readonly failed: number;
  };
  readonly per_resource: Readonly<
    Record<string, BackupRestoreResourceSummary>
  >;
  readonly errors: readonly BackupRestoreError[];
}
