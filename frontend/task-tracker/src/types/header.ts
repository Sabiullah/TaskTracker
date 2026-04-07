import type { Dispatch, SetStateAction } from "react";
import type { Profile } from "./auth";

export type ViewId =
  | "board"
  | "dashboard"
  | "calendar"
  | "worklog"
  | "leads"
  | "notice"
  | "invoice"
  | "masters"
  | "users";

export type ImportMode = "update" | "replace";
export type RestoreMode = "upsert" | "replace";

export interface HeaderFilters {
  client: string;
  category: string;
  responsible: string;
}

export interface HeaderImportTask {
  id: string;
  s_no: number;
  client: string;
  category: string;
  description: string;
  status: string;
  target_date: string;
  expected_date: string;
  comp_date: string;
  responsible: string;
  remarks: string;
  recurrence: string;
}

export interface BackupFile {
  exported_at: string;
  tables: Record<string, Record<string, unknown>[]>;
}

export interface RestoreLogEntry {
  table: string;
  status: "ok" | "skipped" | "error";
  msg: string;
}

export interface HeaderProps {
  view: ViewId;
  onViewChange: (view: ViewId) => void;
  search: string;
  onSearchChange: (value: string) => void;
  filters: HeaderFilters;
  onFiltersChange: Dispatch<SetStateAction<HeaderFilters>>;
  onAddTask: () => void;
  onImport: (tasks: HeaderImportTask[], mode: ImportMode) => void;
  profile: Profile | null;
  onSignOut: () => void;
  onOpenAdmin: () => void;
  adminEmployee: string;
  onClearAdminFilter?: () => void;
  theme: string;
  onToggleTheme: () => void;
  memberOptions?: string[];
  hasInvoiceAccess: boolean;
  hasNoticeAccess: boolean;
}
