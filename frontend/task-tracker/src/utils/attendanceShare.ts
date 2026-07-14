import { computeWorkedHours, fmtClockTime } from "@/utils/time";
import type { AttendanceRecord } from "@/types";

// Only text-font symbols (— → · •) are used in the message: they render
// reliably everywhere, including the WhatsApp Windows desktop client.
const DIVIDER = "———————————————";

/**
 * Format today's attendance as a WhatsApp-ready message (uses WhatsApp's
 * ``*bold*``/``_italic_`` markup). Shared by the Attendance page header
 * button and the global mobile punch/share FAB.
 */
export function buildAttendanceShareText(
  records: AttendanceRecord[],
  today: string,
  reportedBy?: string,
): string {
  const todays = records
    .filter((r) => r.date === today)
    .sort((a, b) =>
      (a.employee_name || "").localeCompare(b.employee_name || ""),
    );
  const count = (s: string) => todays.filter((r) => r.status === s).length;
  const wfh = todays.filter(
    (r) => r.work_location === "WFH" && r.approval_state === "Approved",
  ).length;

  const dateLabel = new Date(today + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const lines: string[] = ["*ATTENDANCE REPORT*", `_${dateLabel}_`];
  if (reportedBy) lines.push(`Reported by: *${reportedBy}*`);
  lines.push(DIVIDER, "*Summary*");

  // Only the lines that carry information — zero counts are noise.
  const summary: Array<[string, number]> = [
    ["Present", count("Present")],
    ["WFH", wfh],
    ["Half Day", count("Half Day")],
    ["Leave", count("Leave")],
    ["Absent", count("Absent")],
  ];
  summary
    .filter(([, n]) => n > 0)
    .forEach(([label, n]) => lines.push(`• ${label} — ${n}`));
  lines.push(`• Total — ${todays.length}`, DIVIDER);

  if (todays.length > 0) {
    lines.push("*Details*");
    todays.forEach((r, i) => {
      const hrs =
        r.total_hours ?? computeWorkedHours(r.login_time, r.logout_time);
      // Location (Office / WFH / Client Site) on every row, with the
      // approval marker when a WFH day isn't approved yet.
      const locTag = r.work_location
        ? ` · ${r.work_location}${
            r.work_location === "WFH" &&
            r.approval_state &&
            r.approval_state !== "Approved"
              ? ` (${r.approval_state})`
              : ""
          }`
        : "";
      lines.push(`${i + 1}. *${r.employee_name}* — ${r.status}${locTag}`);
      if (r.login_time) {
        const logout = r.logout_time ? fmtClockTime(r.logout_time) : "…";
        lines.push(
          `    ${fmtClockTime(r.login_time)} → ${logout}${hrs != null ? ` · ${hrs.toFixed(2)} hrs` : ""}`,
        );
      }
    });
  } else {
    lines.push("No attendance records yet for today.");
  }

  return lines.join("\n");
}

/**
 * Open WhatsApp with the given message pre-filled (user picks the chat).
 *
 * Mobile uses ``wa.me`` (hands off to the app). Desktop targets WhatsApp
 * *Web* so the message is composed in the browser rather than through the
 * desktop app's URL-protocol hand-off.
 */
export function openWhatsAppShare(text: string): void {
  const encoded = encodeURIComponent(text);
  const isMobile =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 640px)").matches;
  const url = isMobile
    ? `https://wa.me/?text=${encoded}`
    : `https://web.whatsapp.com/send?text=${encoded}`;
  window.open(url, "_blank", "noopener");
}
