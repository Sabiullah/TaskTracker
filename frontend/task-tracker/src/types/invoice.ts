import type { ID, DateString } from "./common";

export type InvoiceStatus = "Pending" | "Uploaded" | "Approved" | "Rejected";

export interface InvoicePlan {
  id: ID;
  client_id: string;
  client_name: string;
  job_description: string;
  periodicity: string;
  start_month: string | null;
  end_month: string | null;
  amount: number | null;
  invoice_day: number | null;
  base_amount: number | null;
  serialNo: number | null;
  created_by: ID | null;
  updated_at: string | null;
  project_status: InvoiceProjectStatus;
  default_categories: InvoiceAttributionCategory[];
}

export interface InvoiceEntry {
  id: ID;
  plan_id: ID;
  client_name: string;
  invoice_month: string;
  invoice_date: DateString | null;
  amount: number | null;
  status: InvoiceStatus;
  invoice_number: string | null;
  /** Display-friendly filename (derived from the stored path). Null when
   *  no file is attached. */
  file_name: string | null;
  /** Full auth-gated download URL — ``/api/invoice_entries/<uid>/download/``.
   *  Null when no file is attached. Use this for both the "has a file"
   *  check and for passing to ``openAuthenticatedFile`` (splitting the URL
   *  to get a filename no longer works — the URL ends in ``/download/``). */
  file_url: string | null;
  updated_at: string | null;
  project_status: InvoiceProjectStatus;
  categories: InvoiceAttributionCategory[];
}

/** Grouped invoice row used in the UI (one row per client+month) */
export interface InvoiceGroup {
  primaryEntry: InvoiceEntry;
  totalAmt: number;
  grp: InvoiceEntry[];
}

/** State shape for the amount-edit modal */
export interface AmtModalState {
  entry: InvoiceEntry | null;
  plan: InvoicePlan;
  month: string;
}

/** State shape for the invoice-action modal */
export interface InvModalState {
  entry: InvoiceEntry;
  plan: InvoicePlan;
}

/** Form shape used by PlanModal and ScheduleTab when adding/editing a plan. */
export interface PlanForm {
  client_name: string;
  job_description: string;
  periodicity: string;
  start_month: string;
  end_month: string;
  invoice_day: number;
  base_amount: string;
  id?: string;
  project_status: InvoiceProjectStatus;
  default_categories: InvoiceAttributionCategory[];
}

export type InvoiceProjectStatus = "Confirmed" | "Projected";

export interface InvoiceAttributionOwner {
  user_uid: string;
  user_name: string;
  contribution_pct: number;
}

export interface InvoiceAttributionCategory {
  category_uid: string;
  category_name: string;
  color: string;
  contribution_pct: number;
  /** Owners attached to this category contribution. Must sum to 100% (or
   *  be empty — empty means "this slice is unattributed in owner mode"). */
  owners: InvoiceAttributionOwner[];
}

export interface InvoiceCategory {
  id: string; // uid
  name: string;
  org_uid: string;
  color: string;
  is_active: boolean;
  sort_order: number;
}
