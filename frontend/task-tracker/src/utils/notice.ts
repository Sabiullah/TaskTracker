import type { NoticeRow } from "@/types/notice";
import type { NoticeDto, NoticeStatusValue } from "@/types/api";

export const STATUSES: NoticeStatusValue[] = [
  "Open",
  "Replied",
  "Appealed",
  "Completed",
];

export const STATUS_CFG: Record<
  NoticeStatusValue,
  { color: string; bg: string; icon: string }
> = {
  Open: { color: "#dc2626", bg: "#fef2f2", icon: "🔴" },
  Replied: { color: "#d97706", bg: "#fef3c7", icon: "🟡" },
  Appealed: { color: "#7c3aed", bg: "#f5f3ff", icon: "🟣" },
  Completed: { color: "#16a34a", bg: "#f0fdf4", icon: "🟢" },
};

export const BLANK_NOTICE_ROW: NoticeRow = {
  id: "",
  serialNo: 0,
  client_uid: null,
  client_name: "",
  dispute_nature: "",
  fy: "",
  status: "Open",
  remarks: "",
  received_date: "",
  replied_date: "",
  next_target_date: "",
};

export function dtoToNoticeRow(dto: NoticeDto): NoticeRow {
  return {
    id: dto.uid,
    serialNo: dto.serial_no,
    client_uid: dto.client,
    // Prefer the stored free-text name; fall back to the registered client
    // master's name for legacy rows created before free-text was supported.
    client_name: dto.client_name || dto.client_detail?.name || "",
    dispute_nature: dto.dispute_nature,
    fy: dto.fy,
    status: dto.status,
    remarks: dto.remarks,
    received_date: dto.received_date ?? "",
    replied_date: dto.replied_date ?? "",
    next_target_date: dto.next_target_date ?? "",
  };
}
