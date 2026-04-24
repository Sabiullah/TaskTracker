import { apiDelete, apiGet, apiPatch, apiPost, apiPostForm } from "@/lib/api";
import type {
  ConveyanceAttachment,
  ConveyanceEntry,
  SummaryGroupBy,
  SummaryMode,
  SummaryResponse,
} from "@/types/api/conveyance";

export interface ListFilters {
  employee_uid?: string;
  client_uid?: string;
  status?: "pending" | "approved" | "rejected";
  claimable?: "true" | "false";
  month?: string;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
}

function cleanQuery(filters: ListFilters): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null || v === "") continue;
    out[k] = typeof v === "number" ? v : String(v);
  }
  return out;
}

/**
 * Returns the full list of visible conveyance entries matching the filters.
 *
 * The backend paginates (StandardPagination, 50/page) but the shared
 * ``apiRequest`` helper in ``@/lib/api`` transparently follows ``next``
 * links and unwraps the ``{count, next, previous, results}`` envelope
 * into a flat array before returning — matching the convention used by
 * every other list hook in this app (tasks, worklog, leads, etc.).
 */
export function listEntries(filters: ListFilters = {}): Promise<ConveyanceEntry[]> {
  return apiGet<ConveyanceEntry[]>("/conveyance_entries/", cleanQuery(filters));
}

export function createEntry(form: FormData): Promise<ConveyanceEntry> {
  return apiPostForm<ConveyanceEntry>("/conveyance_entries/", form);
}

export function updateEntry(
  uid: string,
  body: Partial<Pick<ConveyanceEntry, "date" | "reason" | "amount" | "claimable">> & { client?: string },
): Promise<ConveyanceEntry> {
  return apiPatch<ConveyanceEntry>(`/conveyance_entries/${uid}/`, body);
}

export function deleteEntry(uid: string): Promise<void> {
  return apiDelete(`/conveyance_entries/${uid}/`);
}

export function approveEntry(uid: string, reviewNote: string = ""): Promise<ConveyanceEntry> {
  return apiPost<ConveyanceEntry>(`/conveyance_entries/${uid}/approve/`, {
    review_note: reviewNote,
  });
}

export function rejectEntry(uid: string, reviewNote: string): Promise<ConveyanceEntry> {
  return apiPost<ConveyanceEntry>(`/conveyance_entries/${uid}/reject/`, {
    review_note: reviewNote,
  });
}

export function addAttachment(
  entryUid: string,
  file: File,
  label: string = "",
): Promise<ConveyanceAttachment> {
  const form = new FormData();
  form.append("entry_uid", entryUid);
  form.append("file", file);
  form.append("label", label);
  return apiPostForm<ConveyanceAttachment>("/conveyance_attachments/", form);
}

export function deleteAttachment(uid: string): Promise<void> {
  return apiDelete(`/conveyance_attachments/${uid}/`);
}

export interface SummaryParams {
  group_by: SummaryGroupBy;
  mode: SummaryMode;
  month?: string;
  months?: number;
  end?: string;
}

export function fetchSummary(params: SummaryParams): Promise<SummaryResponse> {
  const q: Record<string, string | number> = {
    group_by: params.group_by,
    mode: params.mode,
  };
  if (params.month) q.month = params.month;
  if (params.months !== undefined) q.months = params.months;
  if (params.end) q.end = params.end;
  return apiGet<SummaryResponse>("/conveyance_entries/summary/", q);
}
