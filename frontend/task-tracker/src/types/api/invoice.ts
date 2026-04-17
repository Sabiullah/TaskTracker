/**
 * Invoice plan and entry DTOs — mirrors `/api/invoice_plans/` and
 * `/api/invoice_entries/`.
 *
 * `file_url` on `InvoiceEntryDto` is a short-lived JWT-signed URL
 * (TTL `FILE_SIGNED_URL_TTL`, default 300s). Never cache it — fetch a fresh
 * entry row before rendering a download link. See `docs/API_USAGE_GUIDE.md`.
 */

import type {
  BaseDto,
  IsoDate,
  IsoDateTime,
  MasterRefDto,
  Uid,
  UserRefDto,
} from "./common";

/** Allowed values for `InvoicePlan.periodicity`. */
export type InvoicePeriodicityValue =
  | "Monthly"
  | "Quarterly"
  | "Half-yearly"
  | "Yearly";

/** Allowed values for `InvoiceEntry.status`. */
export type InvoiceEntryStatusValue =
  | "Pending"
  | "Uploaded"
  | "Approved"
  | "Rejected";

/** One embedded entry inside `InvoicePlanDto.entries`. */
export interface InvoiceEntryEmbedded {
  readonly id: number;
  readonly uid: Uid;
  readonly invoice_month: IsoDate;
  readonly status: InvoiceEntryStatusValue;
}

/** Full invoice-plan payload. */
export interface InvoicePlanDto extends BaseDto {
  readonly client: Uid;
  readonly client_detail: MasterRefDto;
  readonly job_description: string;
  readonly periodicity: InvoicePeriodicityValue;
  readonly start_month: IsoDate;
  readonly end_month: IsoDate | null;
  readonly invoice_day: number;
  /** Decimal string, `"0.00"..`. */
  readonly base_amount: string;
  readonly entries: readonly InvoiceEntryEmbedded[];
  readonly created_by_detail: UserRefDto | null;
}

/** Body for `POST /api/invoice_plans/`. */
export interface InvoicePlanCreate {
  readonly client: Uid;
  readonly job_description: string;
  readonly periodicity: InvoicePeriodicityValue;
  readonly start_month: IsoDate;
  readonly end_month?: IsoDate;
  readonly invoice_day: number;
  readonly base_amount: string;
}

/** Body for `PATCH /api/invoice_plans/<uid>/`. */
export type InvoicePlanUpdate = Partial<InvoicePlanCreate>;

/** Full invoice-entry payload. */
export interface InvoiceEntryDto extends BaseDto {
  readonly invoice_month: IsoDate;
  readonly invoice_date: IsoDate | null;
  /** Decimal string, `"0.00"..`, or `null` if not yet set. */
  readonly amount: string | null;
  readonly status: InvoiceEntryStatusValue;
  readonly invoice_number: string;
  readonly notes: string;
  /** Short-lived signed URL, re-fetch for every user action. */
  readonly file_url: string | null;
  readonly rejection_reason: string;
  readonly uploaded_by_detail: UserRefDto | null;
  readonly uploaded_at: IsoDateTime | null;
  readonly approved_by_detail: UserRefDto | null;
  readonly approved_at: IsoDateTime | null;
}

/** Body for `PATCH /api/invoice_entries/<uid>/`. */
export interface InvoiceEntryUpdate {
  readonly invoice_date?: IsoDate;
  readonly amount?: string;
  readonly invoice_number?: string;
  readonly notes?: string;
}

/** Body for `POST /api/invoice_entries/<id>/reject/`. */
export interface InvoiceRejectRequest {
  readonly reason: string;
}

/**
 * Body for `POST /api/invoice_entries/<id>/upload/` — multipart form with
 * `file`, `invoice_number`, `notes`.
 */
export interface InvoiceUploadFields {
  readonly invoice_number: string;
  readonly notes: string;
}

/** Body for `POST /api/invoice_entries/generate/` (see `docs/misc_endpoints.md`). */
export interface InvoiceGenerateRequest {
  readonly plan_uid: Uid;
}

/** Response from `POST /api/invoice_entries/generate/`. */
export interface InvoiceGenerateResponse {
  readonly plan_uid: Uid;
  readonly created: number;
  readonly skipped_existing: number;
  readonly entries: readonly InvoiceEntryDto[];
}
