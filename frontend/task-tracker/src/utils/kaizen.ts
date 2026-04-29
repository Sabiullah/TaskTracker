import type { KaizenRow, KaizenStatusValue } from "@/types/kaizen";
import type { KaizenDto } from "@/types/api";

export const STATUSES: KaizenStatusValue[] = [
  "Pending",
  "Approved",
  "Rejected",
];

/** Status pill colours. ``Rejected`` is included for the admin "show rejected"
 *  toggle — the default list filters those rows out. */
export const STATUS_CFG: Record<
  KaizenStatusValue,
  { color: string; bg: string; icon: string }
> = {
  Pending: { color: "#d97706", bg: "#fef3c7", icon: "🟡" },
  Approved: { color: "#16a34a", bg: "#f0fdf4", icon: "🟢" },
  Rejected: { color: "#dc2626", bg: "#fef2f2", icon: "🔴" },
};

export const BLANK_KAIZEN_ROW: KaizenRow = {
  id: "",
  raised_by: "",
  raised_by_uid: null,
  entry_date: "",
  client: "",
  client_uid: "",
  area: "",
  description: "",
  takeaway: "",
  status: "Pending",
  reviewed_by: "",
  reviewed_at: null,
  rejection_reason: "",
  org_uid: null,
};

export function dtoToKaizenRow(dto: KaizenDto): KaizenRow {
  return {
    id: dto.uid,
    raised_by: dto.raised_by_detail?.full_name ?? "",
    raised_by_uid: dto.raised_by_detail?.uid ?? null,
    entry_date: dto.entry_date,
    client: dto.client_detail?.name ?? "",
    client_uid: dto.client ?? "",
    area: dto.area,
    description: dto.description,
    takeaway: dto.takeaway,
    status: dto.status,
    reviewed_by: dto.reviewed_by_detail?.full_name ?? "",
    reviewed_at: dto.reviewed_at,
    rejection_reason: dto.rejection_reason,
    org_uid: dto.org_uid,
  };
}
