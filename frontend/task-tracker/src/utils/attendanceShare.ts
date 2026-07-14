import { computeWorkedHours, fmtClockTime } from "@/utils/time";
import type { AttendanceRecord } from "@/types";

// Only text-font symbols are used in the message: they render reliably
// everywhere, including the WhatsApp Windows desktop client.
// NB: the dashes are EN DASHES (–), not hyphens — WhatsApp turns any line
// starting with "- " into an indented bullet-list item ("· - - -").
const DIVIDER = "– – – – – – – – – – – – – – – – – – – –";

/** "Label: value" — the value rendered bold-italic via WhatsApp markup.
 * No padding: WhatsApp's proportional font can't align columns anyway. */
const kv = (label: string, value: string): string => `${label}: *_${value}_*`;

/**
 * Format today's attendance as a WhatsApp-ready message (uses WhatsApp's
 * ``*bold*`` markup). Shared by the Attendance page header button and the
 * global mobile punch/share FAB.
 */
export function buildAttendanceShareText(
  records: AttendanceRecord[],
  today: string,
  reportedBy?: string,
): string {
  // The share is a PERSONAL report: managers/admins can see the whole
  // team's records, but the message only covers the sharer's own rows.
  const mine = reportedBy
    ? records.filter((r) => r.employee_name === reportedBy)
    : records;
  const todays = mine
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
    month: "long",
    year: "numeric",
  });

  const lines: string[] = ["*ATTENDANCE REPORT*", dateLabel];
  if (reportedBy) lines.push(`        Reported by: *${reportedBy}*`);
  lines.push(DIVIDER, "*DETAILS*");

  if (todays.length > 0) {
    todays.forEach((r, i) => {
      const hrs =
        r.total_hours ?? computeWorkedHours(r.login_time, r.logout_time);
      // Client-site punches carry the client's name in remarks
      // ("Client: <name>") — show the client instead of "Client Site".
      const clientMatch =
        r.work_location === "Client Site"
          ? /^Client:\s*(.+)$/.exec(r.remarks || "")
          : null;
      const location = clientMatch
        ? clientMatch[1]
        : r.work_location || "—";
      const wfhTag =
        r.work_location === "WFH" &&
        r.approval_state &&
        r.approval_state !== "Approved"
          ? ` (${r.approval_state})`
          : "";

      if (i > 0) lines.push("");
      lines.push(
        // kv("Name", r.employee_name || "—"),
        kv("    Status", r.status || "—"),
        kv("    Location", `${location}${wfhTag}`),
      );
      if (r.login_time) {
        const logout = r.logout_time ? fmtClockTime(r.logout_time) : "…";
        lines.push(kv("    Time", `${fmtClockTime(r.login_time)} – ${logout}`));
      }
      if (hrs != null) {
        lines.push(kv("    Duration", `${hrs.toFixed(2)} hrs`));
      }
    });
  } else {
    lines.push("No attendance records yet for today.");
  }

  lines.push(DIVIDER, "*SUMMARY*");

  // Only the lines that carry information — zero counts are noise.
  const summary: Array<[string, number]> = [
    ["    Present", count("Present")],
    ["    WFH", wfh],
    ["    Half Day", count("Half Day")],
    ["    Leave", count("Leave")],
    ["    Absent", count("Absent")],
  ];
  summary
    .filter(([, n]) => n > 0)
    .forEach(([label, n]) => lines.push(kv(label, String(n))));

  // Month-to-date attendance: days the user actually turned up (punched
  // in) or was marked Present. Counting by status alone under-reports —
  // short-hours days get auto-set to Absent even though the user punched
  // in. Unapproved WFH days still don't count.
  const monthPrefix = today.slice(0, 7);
  const monthPresent = mine.filter(
    (r) =>
      (r.date || "").startsWith(monthPrefix) &&
      (r.login_time || r.status === "Present") &&
      !(
        r.work_location === "WFH" &&
        r.approval_state &&
        r.approval_state !== "Approved"
      ),
  ).length;
  lines.push(
    kv(
      "    Present This Month",
      `${monthPresent} day${monthPresent === 1 ? "" : "s"}`,
    ),
    DIVIDER,
  );

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
