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
  file_name: string | null;
  updated_at: string | null;
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
}
