/**
 * Lead, lead-status, and lead-history DTOs — mirrors `/api/leads/`,
 * `/api/lead_statuses/`, and `/api/lead_history/`.
 */

import type {
  BaseDto,
  IsoDate,
  MasterRefDto,
  Pk,
  Uid,
  UserRefDto,
} from "./common";

/** Allowed values for `Lead.priority`. */
export type LeadPriorityValue = "High" | "Medium" | "Low";

/** Full lead-status payload. */
export interface LeadStatusDto {
  readonly id: Pk;
  readonly name: string;
  readonly color: string;
  readonly sort_order: number;
  readonly is_active: boolean;
}

/** Body for `POST /api/lead_statuses/`. */
export interface LeadStatusCreate {
  readonly name: string;
  readonly color?: string;
  readonly sort_order?: number;
  readonly is_active?: boolean;
}

/** Body for `PATCH /api/lead_statuses/<id>/`. */
export type LeadStatusUpdate = Partial<LeadStatusCreate>;

/** One history entry embedded on a `LeadDto.history` array. */
export interface LeadHistoryEmbedded {
  readonly id: Pk;
  readonly note: string;
  readonly created_at: string;
  readonly created_by_detail: UserRefDto | null;
}

/** One attachment on a lead. Returned by `/api/leads/<uid>/attachments/`
 *  and embedded on `LeadDto.attachments`. */
export interface LeadAttachmentDto {
  readonly id: Pk;
  readonly uid: Uid;
  /** User-entered display name; required, non-empty. */
  readonly label: string;
  /** Original OS filename. */
  readonly filename: string;
  /** Absolute URL of the raw file (may 401 without auth — use `download_url`). */
  readonly file_url: string | null;
  /** Auth-gated streaming endpoint. Use `openAuthenticatedFile`. */
  readonly download_url: string | null;
  readonly size_bytes: number;
  readonly uploaded_at: string;
  readonly uploaded_by_detail: UserRefDto | null;
}

/** Full lead payload. */
export interface LeadDto extends BaseDto {
  readonly serial_no: number;

  readonly client: Uid | null;
  readonly client_detail: MasterRefDto | null;
  /** Free-text prospect name. Leads are enquiries so the client may not
   *  exist in the master yet; this field holds whatever the user typed. */
  readonly client_name: string;

  readonly contact_person: string;
  readonly contact_email: string;
  readonly contact_phone: string;
  readonly lead_source: string;
  readonly reference_from: string;

  readonly status: Pk;
  readonly status_detail: LeadStatusDto | null;

  readonly priority: LeadPriorityValue;

  readonly assigned_to: Uid | null;
  readonly assigned_to_detail: UserRefDto | null;

  /** Decimal string, `"0.00"..`. */
  readonly estimated_value: string;

  readonly action_taken: string;
  readonly next_step: string;
  readonly next_step_date: IsoDate | null;
  readonly remarks: string;

  readonly history: readonly LeadHistoryEmbedded[];
  readonly attachments: readonly LeadAttachmentDto[];

  readonly created_by_detail: UserRefDto | null;
}

/** Body for `POST /api/leads/`. */
export interface LeadCreate {
  readonly client?: Uid;
  /** Free-text prospect name. Primary way to store the client on a lead
   *  now that leads don't need to be pinned to the master. */
  readonly client_name?: string;
  readonly contact_person?: string;
  readonly contact_email?: string;
  readonly contact_phone?: string;
  readonly lead_source?: string;
  readonly reference_from?: string;
  readonly status: Pk;
  readonly priority?: LeadPriorityValue;
  readonly assigned_to?: Uid;
  readonly estimated_value: string;
  readonly action_taken?: string;
  readonly next_step?: string;
  readonly next_step_date?: IsoDate;
  readonly remarks?: string;
  /** Org uid. Required when the caller belongs to 2+ orgs; ignored when the
   *  caller has exactly one membership (the backend picks it automatically). */
  readonly org?: Uid;
}

/** Body for `PATCH /api/leads/<uid>/`. */
export type LeadUpdate = Partial<LeadCreate>;

/** Full lead-history payload from `/api/lead_history/`. */
export interface LeadHistoryDto extends BaseDto {
  readonly lead: Pk;
  readonly note: string;
  readonly created_by_detail: UserRefDto | null;
}

/** Body for `POST /api/lead_history/`. */
export interface LeadHistoryCreate {
  readonly lead_uid: Uid;
  readonly note: string;
}
