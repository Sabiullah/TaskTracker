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

/** Full lead payload. */
export interface LeadDto extends BaseDto {
  readonly serial_no: number;

  readonly client: Uid | null;
  readonly client_detail: MasterRefDto | null;

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

  readonly created_by_detail: UserRefDto | null;
}

/** Body for `POST /api/leads/`. */
export interface LeadCreate {
  readonly client?: Uid;
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
