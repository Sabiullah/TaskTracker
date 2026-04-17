import type { AttendanceRecord } from "@/types";
import { TODAY } from "@/utils/date";

export { thS, tdS, inpS } from "@/utils/tableStyles";

export const STATUSES: string[] = [
  "Present",
  "Absent",
  "Half Day",
  "Leave",
  "WFH",
];
export const STATUS_CFG: Record<
  string,
  { color: string; bg: string; icon: string }
> = {
  Present: { color: "#16a34a", bg: "#f0fdf4", icon: "🟢" },
  Absent: { color: "#dc2626", bg: "#fef2f2", icon: "🔴" },
  "Half Day": { color: "#d97706", bg: "#fef3c7", icon: "🟡" },
  Leave: { color: "#7c3aed", bg: "#f5f3ff", icon: "🟣" },
  WFH: { color: "#0891b2", bg: "#ecfeff", icon: "🔵" },
};

export const LOCATIONS: string[] = [
  "Office",
  "WFH",
  "Client Site",
  "Field",
  "Other",
];

export const NOW_TIME: string = (() => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
})();

export const BLANK: Omit<AttendanceRecord, "id" | "user_id" | "employee_name"> =
  {
    date: TODAY,
    login_time: NOW_TIME,
    logout_time: "",
    work_location: "Office",
    status: "Present",
    remarks: "",
  };

/**
 * Shape accepted by the pack / unpack helpers. Kept as a structural type so
 * both a domain `AttendanceRecord` and a DTO row satisfy it.
 */
interface AttendanceStatusShape {
  status: string;
  work_location: string | null;
}

/**
 * Domain → wire. The legacy domain model used `status="WFH"` to mean
 * "present but remote"; Django models these orthogonally as
 * `status="Present"` + `work_location="WFH"`. Run outgoing rows through this
 * helper before a POST/PATCH.
 */
export function packAttendanceForServer<T extends AttendanceStatusShape>(
  record: T,
): T {
  if (record.status === "WFH") {
    return { ...record, status: "Present", work_location: "WFH" };
  }
  return record;
}

/**
 * Wire → domain. Undo the split so pre-migration UI code can keep displaying
 * `"WFH"` as a first-class status value.
 */
export function unpackAttendanceFromServer<T extends AttendanceStatusShape>(
  record: T,
): T {
  if (record.status === "Present" && record.work_location === "WFH") {
    return { ...record, status: "WFH" };
  }
  return record;
}
