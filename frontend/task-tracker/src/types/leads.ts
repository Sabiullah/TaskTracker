import type { ID } from "./common";

/** Flexible — values come from the lead_statuses table */
export type LeadStatus = string;

export interface LeadStatusRecord {
  id: ID;
  name: string;
  color: string;
  sort_order: number | null;
}

export interface LeadAttachment {
  uid: ID;
  label: string;
  filename: string;
  file_url: string | null;
  download_url: string | null;
  size_bytes: number;
  uploaded_at: string;
  uploaded_by_name: string | null;
}

export interface Lead {
  id: ID;
  serialNo: number | null;
  client: string;
  contact_person: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  lead_source: string | null;
  reference_from: string | null;
  status: LeadStatus;
  priority: string;
  assigned_to: string | null;
  estimated_value: number | null;
  action_taken: string | null;
  next_step: string | null;
  next_step_date: string | null;
  remarks: string | null;
  /** Always populated by ``dtoToLead`` (empty array if none). Marked
   *  optional so existing test fixtures and other Lead-shape constructors
   *  don't need to be updated. */
  attachments?: LeadAttachment[];
  created_by: ID | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface LeadPriority {
  value: string;
  color: string;
  bg: string;
}

export interface LeadHistory {
  id: ID;
  lead_id: ID;
  note: string;
  created_by: ID;
  created_at: string;
}
