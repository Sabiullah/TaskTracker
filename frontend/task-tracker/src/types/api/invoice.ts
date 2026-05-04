/**
 * Invoice plan and entry DTOs — mirrors `/api/invoice_plans/` and
 * `/api/invoice_entries/`.
 *
 * `file_url` on `InvoiceEntryDto` is a short, auth-gated URL pointing at
 * `/api/invoice_entries/<uid>/download/`. It doesn't expire — access is
 * controlled by the caller being authenticated and sharing an org with
 * the entry's plan. Append `?download=1` to force a save-as instead of
 * inline browser rendering.
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

export type InvoiceProjectStatus = "Confirmed" | "Projected";

export interface InvoiceCategoryDto extends BaseDto {
  readonly name: string;
  readonly org: Uid;
  readonly color: string;
  readonly is_active: boolean;
  readonly sort_order: number;
}

export interface InvoiceCategoryCreate {
  readonly name: string;
  readonly org: Uid;
  readonly color?: string;
  readonly is_active?: boolean;
  readonly sort_order?: number;
}

export type InvoiceCategoryUpdate = Partial<InvoiceCategoryCreate>;

export interface AttributionOwnerItem {
  readonly user_uid: Uid;
  readonly user_name?: string;
  readonly contribution_pct: string;
}

/** Owners now belong *under* a category — each category contribution
 *  carries its own owner allocation that must sum to 100% (or be empty,
 *  meaning that slice is unattributed in owner-mode reports). */
export interface AttributionCategoryItem {
  readonly category_uid: Uid;
  readonly category_name?: string;
  readonly color?: string;
  readonly contribution_pct: string;
  readonly owners?: readonly AttributionOwnerItem[];
}

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
  readonly project_status: InvoiceProjectStatus;
  readonly default_categories: readonly AttributionCategoryItem[];
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
  readonly project_status?: InvoiceProjectStatus;
  readonly default_categories?: readonly AttributionCategoryItem[];
  /** Org uid. Required for users who belong to 2+ orgs; ignored when the
   *  caller has exactly one membership (the backend picks it automatically). */
  readonly org?: Uid;
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
  readonly project_status: InvoiceProjectStatus;
  readonly categories: readonly AttributionCategoryItem[];
  readonly invoice_number: string;
  readonly notes: string;
  /** Auth-gated download URL — `/api/invoice_entries/<uid>/download/`. */
  readonly file_url: string | null;
  /** Stored basename of the uploaded file (for display only — the URL
   *  alone ends in `.../download/` so you can't derive a name from it). */
  readonly file_name: string | null;
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
  readonly project_status?: InvoiceProjectStatus;
  readonly categories?: readonly AttributionCategoryItem[];
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

export type InvoiceReportGroupBy = "owner" | "category" | "month" | "client";

export interface InvoiceReportRow {
  readonly key: string;
  readonly label: string;
  readonly monthly: Readonly<Record<string, string>>;
  readonly monthly_clients?: Readonly<Record<string, number>>;
  readonly total: string;
  readonly total_clients?: number;
}

export interface InvoiceReportTotals {
  readonly total?: string;
  readonly monthly_clients?: Readonly<Record<string, number>>;
  readonly total_clients?: number;
  readonly [month: string]:
    | string
    | Readonly<Record<string, number>>
    | number
    | undefined;
}

export interface InvoiceReportResponse {
  readonly fy: string;
  readonly group_by: InvoiceReportGroupBy;
  readonly rows: readonly InvoiceReportRow[];
  readonly totals: InvoiceReportTotals;
}

export interface InvoiceReportRequest {
  readonly fy: string;
  readonly group_by: InvoiceReportGroupBy;
  readonly category?: readonly Uid[];
  readonly owner?: readonly Uid[];
  readonly project_status?: InvoiceProjectStatus;
}

export interface InvoiceReportCellRow {
  readonly client: string;
  readonly category: string;
  readonly month: string;
  readonly amount: string;
}

export interface InvoiceReportCellResponse {
  readonly rows: readonly InvoiceReportCellRow[];
  readonly total_amount: string;
  readonly client_count: number;
}
