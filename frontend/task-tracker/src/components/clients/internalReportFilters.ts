import type { ClientVisitDto, VisitStatus } from "@/types/api/internalReports";

export interface InternalReportFilters {
  preparedByUids: string[];
  assignedManagerUids: string[];
  statuses: VisitStatus[] | string[];
  visitMonth: string; // "YYYY-MM" or empty
  overdueOnly: boolean;
}

export function isInternalReportFilterActive(f: InternalReportFilters): boolean {
  return (
    f.preparedByUids.length > 0
    || f.assignedManagerUids.length > 0
    || f.statuses.length > 0
    || f.visitMonth !== ""
    || f.overdueOnly
  );
}

export function visitMatches(v: ClientVisitDto, f: InternalReportFilters): boolean {
  if (f.preparedByUids.length && (!v.prepared_by || !f.preparedByUids.includes(v.prepared_by))) {
    return false;
  }
  if (
    f.assignedManagerUids.length
    && (!v.assigned_manager || !f.assignedManagerUids.includes(v.assigned_manager))
  ) {
    return false;
  }
  if (f.statuses.length && !f.statuses.includes(v.current_status)) return false;
  if (f.visitMonth) {
    const ym = v.visit_date.slice(0, 7); // "YYYY-MM"
    if (ym !== f.visitMonth) return false;
  }
  if (f.overdueOnly && !v.is_overdue) return false;
  return true;
}
