export type ConveyanceStatus = "pending" | "approved" | "rejected";
export type ConveyanceFrequency = "one_time" | "monthly" | "half_yearly" | "yearly";

export interface UserMin {
  uid: string;
  username: string;
  full_name: string;
}

export interface MasterMin {
  uid: string;
  name: string;
  type: string;
}

export interface ConveyanceAttachment {
  uid: string;
  label: string;
  file_url: string | null;
  filename: string | null;
  uploaded_by_detail: UserMin | null;
  created_at: string;
}

export interface ConveyanceEntry {
  uid: string;
  date: string;
  employee_detail: UserMin;
  client_detail: MasterMin;
  reason: string;
  amount: string;
  claimable: boolean;
  status: ConveyanceStatus;
  review_note: string;
  reviewed_by_detail: UserMin | null;
  reviewed_at: string | null;
  attachments: ConveyanceAttachment[];
  frequency: ConveyanceFrequency;
  series_uid: string | null;
  start_month: string | null;   // YYYY-MM-DD (1st of month) or null
  end_month: string | null;
  created_by_detail: UserMin | null;
  created_at: string;
  updated_at: string;
}

export type SummaryGroupBy = "employee" | "client";
export type SummaryMode = "single" | "trailing";

export interface SummaryTopEntry {
  uid: string;
  date: string;
  reason: string;
  amount: string;
}

export interface SummarySingleRow {
  key_uid: string;
  key_label: string;
  total: string;
  entry_count: number;
  top_entries: SummaryTopEntry[];
}

export interface SummarySingleResponse {
  mode: "single";
  month: string;
  group_by: SummaryGroupBy;
  rows: SummarySingleRow[];
  grand_total: string;
}

export interface SummaryTrailingRow {
  key_uid: string;
  key_label: string;
  monthly: Record<string, string>;
  total: string;
}

export interface SummaryTrailingResponse {
  mode: "trailing";
  months: string[];
  group_by: SummaryGroupBy;
  rows: SummaryTrailingRow[];
  column_totals: Record<string, string>;
  grand_total: string;
}

export type SummaryResponse = SummarySingleResponse | SummaryTrailingResponse;

export interface ConveyanceListPage {
  count: number;
  next: string | null;
  previous: string | null;
  results: ConveyanceEntry[];
}
