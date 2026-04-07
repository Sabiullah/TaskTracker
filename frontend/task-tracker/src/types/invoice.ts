import type { CSSProperties } from "react";

export type Periodicity = "Monthly" | "Quarterly" | "Half-yearly" | "Yearly";
export type InvoiceStatus = "Pending" | "Uploaded" | "Approved" | "Rejected";

export interface InvoicePlan {
  id: string;
  s_no?: number;
  client_name: string;
  job_description: string;
  periodicity: Periodicity;
  start_month: string;
  end_month: string;
  invoice_day: number;
  base_amount: number | string;
  created_by?: string;
  updated_at?: string;
}

export interface InvoiceEntry {
  id: string;
  plan_id: string;
  client_name: string;
  invoice_month: string;
  invoice_date: string;
  amount: number | string;
  status: InvoiceStatus;
  file_path?: string;
  file_name?: string;
  invoice_number?: string;
  notes?: string;
  uploaded_by?: string;
  uploaded_at?: string;
  approved_by?: string;
  approved_at?: string;
  rejection_reason?: string;
  updated_at?: string;
}

export interface PlanForm {
  id?: string;
  client_name: string;
  job_description: string;
  periodicity: Periodicity;
  start_month: string;
  end_month: string;
  invoice_day: number;
  base_amount: number | string;
}

export interface AmountSavePayload {
  amount: number;
  scope: "this_month" | "onwards";
  month: string;
}

export interface AmountModalState {
  entry: InvoiceEntry | null;
  plan: Partial<InvoicePlan>;
  month: string;
}

export interface InvModalState {
  entry: InvoiceEntry;
  plan: Partial<InvoicePlan>;
}

export interface StatusConfig {
  color: string;
  bg: string;
  icon: string;
  label: string;
}

export type ThStyle = CSSProperties & {
  textAlign: "left" | "center" | "right";
};
