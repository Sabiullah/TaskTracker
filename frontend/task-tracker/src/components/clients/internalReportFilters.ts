import type { ClientVisitDto, VisitStatus } from "@/types/api/internalReports";

export interface PendingMyApprovalConfig {
  /** Current user's UID. */
  readonly myUid: string;
  /** Resolves whether the current user may approve reports in the given org —
   *  i.e. they are a manager or admin there. */
  readonly canApproveForOrg: (orgUid: string | null) => boolean;
}

export interface InternalReportFilters {
  preparedByUids: string[];
  assignedManagerUids: string[];
  statuses: VisitStatus[] | string[];
  visitMonth: string; // "YYYY-MM" or empty
  overdueOnly: boolean;
  /**
   * When non-null, restrict to visits the current user can act on as approver:
   * status="Pending" AND (assigned_manager == myUid OR manager/admin in
   * visit.org). This mirrors the backend ``_review`` permission rule, so any
   * manager sees every pending visit in their orgs — not only ones where
   * they're explicitly the assigned manager.
   */
  pendingMyApproval: PendingMyApprovalConfig | null;
}

export function isInternalReportFilterActive(f: InternalReportFilters): boolean {
  return (
    f.preparedByUids.length > 0
    || f.assignedManagerUids.length > 0
    || f.statuses.length > 0
    || f.visitMonth !== ""
    || f.overdueOnly
    || f.pendingMyApproval !== null
  );
}

export function matchesPendingMyApproval(
  v: ClientVisitDto,
  cfg: PendingMyApprovalConfig,
): boolean {
  if (v.current_status !== "Pending") return false;
  if (cfg.canApproveForOrg(v.org_uid)) return true;
  return v.assigned_manager === cfg.myUid;
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
  if (f.pendingMyApproval && !matchesPendingMyApproval(v, f.pendingMyApproval)) return false;
  return true;
}
