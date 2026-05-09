import type { MasterDto } from "./master";
import type { UserMinDto } from "./internalReports";

export type MonthlyReportStatus =
  | "Draft"
  | "Pending"
  | "Approved"
  | "Reviewed"
  | "Rejected";

export type MonthlyReportEventType =
  | "created"
  | "submitted"
  | "approved"
  | "rejected"
  | "reviewed"
  | "resubmitted"
  | "required_changed";

export interface MonthlyReportAuditEventDto {
  readonly id: number;
  readonly uid: string;
  readonly report_uid: string | null;
  readonly event_type: MonthlyReportEventType;
  readonly actor_detail: UserMinDto | null;
  readonly comment: string;
  readonly created_at: string;
}

export interface MonthlyReportAttachmentDto {
  readonly id: number;
  readonly uid: string;
  readonly report: number;
  readonly filename: string;
  readonly size_bytes: number;
  readonly uploaded_by_detail: UserMinDto | null;
  readonly uploaded_at: string;
  readonly download_url: string;
}

export interface ClientMonthlyReportDto {
  readonly id: number;
  readonly uid: string;
  readonly org_uid: string | null;
  readonly client: string;
  readonly client_detail: Pick<MasterDto, "id" | "uid" | "name" | "type" | "color"> | null;
  readonly year_month: string;
  readonly report_date: string;
  readonly report_name: string;
  readonly key_points: string;
  readonly status: MonthlyReportStatus;
  readonly prepared_by: string | null;
  readonly prepared_by_detail: UserMinDto | null;
  readonly assigned_manager: string | null;
  readonly assigned_manager_detail: UserMinDto | null;
  readonly submitted_at: string | null;
  readonly approved_at: string | null;
  readonly approved_by_detail: UserMinDto | null;
  readonly manager_comment: string;
  readonly reviewed_at: string | null;
  readonly reviewed_by_detail: UserMinDto | null;
  readonly review_comment: string;
  readonly created_by_detail: UserMinDto | null;
  readonly attachments: readonly MonthlyReportAttachmentDto[];
  readonly audit_events: readonly MonthlyReportAuditEventDto[];
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ClientMonthlyReportCreateForm {
  readonly client: string;
  readonly year_month: string;
  readonly report_date: string;
  readonly report_name: string;
  readonly key_points: string;
  readonly assigned_manager: string;
  readonly org?: string;
}

export interface ClientMonthlyReportEditForm {
  readonly report_name?: string;
  readonly report_date?: string;
  readonly key_points?: string;
  readonly assigned_manager?: string;
  readonly year_month?: string;
}

export interface MonthlyReportRequirementDto {
  readonly id: number;
  readonly uid: string;
  readonly org: string;
  readonly org_uid: string;
  readonly client: string;
  readonly client_detail: Pick<MasterDto, "id" | "uid" | "name" | "type" | "color"> | null;
  readonly required: boolean;
  readonly set_by_detail: UserMinDto | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface MonthlyReportRequirementUpsertForm {
  readonly org: string;
  readonly client: string;
  readonly required: boolean;
}
