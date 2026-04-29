import type { MasterDto } from "./master";

export interface UserMinDto {
  readonly id: number;
  readonly uid: string;
  readonly full_name: string;
  readonly username: string;
  readonly avatar_color?: string;
}

export type VisitStatus = "Draft" | "Pending" | "Approved" | "Rejected";

export type VisitAuditEventType =
  | "created"
  | "submitted"
  | "approved"
  | "rejected"
  | "resubmitted"
  | "sent_to_client"
  | "voice_note_marked";

export interface VisitReportAuditEventDto {
  readonly id: number;
  readonly uid: string;
  readonly visit_uid: string;
  readonly report_uid: string | null;
  readonly event_type: VisitAuditEventType;
  readonly actor_detail: UserMinDto | null;
  readonly comment: string;
  readonly created_at: string;
}

export interface VisitReportAttachmentDto {
  readonly id: number;
  readonly uid: string;
  readonly report: number;
  readonly filename: string;
  readonly size_bytes: number;
  readonly uploaded_by_detail: UserMinDto | null;
  readonly uploaded_at: string;
  readonly download_url: string;
}

export interface VisitReportDto {
  readonly id: number;
  readonly uid: string;
  readonly visit: number;
  readonly revision_number: number;
  readonly key_points: string;
  readonly status: VisitStatus;
  readonly submitted_at: string | null;
  readonly reviewed_at: string | null;
  readonly reviewed_by_detail: UserMinDto | null;
  readonly manager_comment: string;
  readonly created_by_detail: UserMinDto | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly attachments: readonly VisitReportAttachmentDto[];
}

export interface ClientVisitDto {
  readonly id: number;
  readonly uid: string;
  readonly org_uid: string | null;
  readonly client: string | null;
  readonly client_detail: Pick<MasterDto, "id" | "uid" | "name" | "type" | "color"> | null;
  readonly visit_date: string;
  readonly prepared_by: string | null;
  readonly prepared_by_detail: UserMinDto | null;
  readonly assigned_manager: string | null;
  readonly assigned_manager_detail: UserMinDto | null;
  readonly current_status: VisitStatus;
  readonly report_sent_date: string | null;
  readonly voice_note_sent: boolean;
  readonly voice_note_summary: string;
  readonly created_by_detail: UserMinDto | null;
  readonly reports: readonly VisitReportDto[];
  readonly audit_events: readonly VisitReportAuditEventDto[];
  readonly is_overdue: boolean;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ClientVisitCreateForm {
  readonly client: string;
  readonly visit_date: string;
  readonly assigned_manager: string;
  readonly key_points: string;
  readonly org?: string;
}

export interface VisitReportEditForm {
  readonly key_points?: string;
}

export interface VisitSentInfoForm {
  readonly report_sent_date?: string | null;
  readonly voice_note_sent?: boolean;
  readonly voice_note_summary?: string;
}

export interface DirectedNotificationPayload {
  readonly to_user_uid: string;
  readonly kind: string;
  readonly title: string;
  readonly body: string;
  readonly link?: { tab?: string; visit_uid?: string };
}
