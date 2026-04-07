import type { CSSProperties } from "react";

export interface LeadStatus {
  id?: string;
  name: string;
  color: string;
  sort_order?: number;
}

export interface Lead {
  id?: string;
  s_no?: number;
  client: string;
  contact_person?: string;
  contact_email?: string;
  contact_phone?: string;
  lead_source?: string;
  reference_from?: string;
  status?: string;
  priority?: string;
  assigned_to?: string;
  estimated_value?: string | number;
  action_taken?: string;
  next_step?: string;
  next_step_date?: string;
  remarks?: string;
  created_at?: string;
  updated_at?: string;
  created_by?: string;
}

export interface FollowupLog {
  id: string;
  lead_id: string;
  note: string;
  created_at: string;
}

export interface StatusMasterModalProps {
  statuses: LeadStatus[];
  onClose: () => void;
  onRefresh: () => void;
}

export interface LeadModalProps {
  lead: Partial<Lead> | null;
  statuses: LeadStatus[];
  memberOptions: string[];
  onSave: (form: Lead) => Promise<void>;
  onClose: () => void;
}

export interface HistoryModalProps {
  lead: Lead;
  onClose: () => void;
}

export interface PipelineViewProps {
  leads: Lead[];
  statuses: LeadStatus[];
  onEdit: (lead: Lead) => void;
}

export type InputStyle = CSSProperties & { boxSizing: "border-box" };
