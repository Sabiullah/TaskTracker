import type {
  OperationalStandupApprovalDto,
  OperationalStandupDto,
} from "@/types/api";
import type { CellPayload } from "@/utils/matrixCells";

export interface MatrixEmployee {
  readonly uid: string;
  readonly full_name: string;
  readonly org_names: readonly string[];
}

export function uniqueSubmittedEmployees(
  standups: readonly OperationalStandupDto[],
): MatrixEmployee[] {
  const byUid = new Map<string, { full_name: string; orgs: Set<string> }>();
  for (const s of standups) {
    const ref = s.profile_detail;
    const name = ref.full_name || ref.username || "";
    let entry = byUid.get(ref.uid);
    if (!entry) {
      entry = { full_name: name, orgs: new Set<string>() };
      byUid.set(ref.uid, entry);
    }
    for (const a of s.approvals) entry.orgs.add(a.org_name);
  }
  return [...byUid.entries()]
    .map(([uid, v]) => ({
      uid,
      full_name: v.full_name,
      org_names: [...v.orgs].sort(),
    }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
}

export interface FallbackLabel {
  readonly text: string;
  readonly color: string;
}

export function attendanceFallbackLabel(
  cell: CellPayload | undefined,
): FallbackLabel | null {
  if (!cell) return null;
  switch (cell.code) {
    case "L":
    case "L½":
    case "L½+H":
      return { text: "Leave", color: "#7c3aed" };
    case "WFH":
    case "WP":
      return { text: "WFH", color: "#0e7490" };
    case "H":
      return { text: "Half Day", color: "#92400e" };
    case "HD":
      return { text: cell.holiday_name ?? "Holiday", color: "#64748b" };
    case "HW":
      return { text: "Worked on holiday", color: "#155e75" };
    case "?":
      return { text: "Open punch", color: "#dc2626" };
    case "P":
    case "A":
    default:
      return null;
  }
}

export function approvalTint(
  approvals: readonly OperationalStandupApprovalDto[],
): string {
  if (approvals.length === 0) return "transparent";
  const anyPending = approvals.some((a) => a.status === "Pending");
  return anyPending ? "#d97706" : "#16a34a";
}
