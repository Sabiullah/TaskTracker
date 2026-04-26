import type { AttendanceRecord } from "@/types";
import { TODAY } from "@/utils/date";

export { thS, tdS, inpS } from "@/utils/tableStyles";

export const STATUSES: string[] = [
  "Present",
  "Absent",
  "Half Day",
  "Leave",
];
export const STATUS_CFG: Record<
  string,
  { color: string; bg: string; icon: string }
> = {
  Present: { color: "#16a34a", bg: "#f0fdf4", icon: "🟢" },
  Absent: { color: "#dc2626", bg: "#fef2f2", icon: "🔴" },
  "Half Day": { color: "#d97706", bg: "#fef3c7", icon: "🟡" },
  Leave: { color: "#7c3aed", bg: "#f5f3ff", icon: "🟣" },
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
 * Domain → wire passthrough.
 *
 * Historical note: an earlier model used `status="WFH"` to mean "present but
 * remote". The current schema splits that into `status="Present"` plus
 * `work_location="WFH"`, and the UI now exposes both as separate dropdowns.
 * The pack helper is kept as a passthrough so call sites in the mapper layer
 * don't need a sweeping refactor — but it no longer rewrites anything.
 */
export function packAttendanceForServer<T extends AttendanceStatusShape>(
  record: T,
): T {
  return record;
}

/**
 * Wire → domain passthrough. See note on `packAttendanceForServer` above.
 */
export function unpackAttendanceFromServer<T extends AttendanceStatusShape>(
  record: T,
): T {
  return record;
}
