import { toMins, fromMins } from "@/utils/time";
import type { WorkLog } from "@/types";

// Only text-font symbols are used in the message: they render reliably
// everywhere, including the WhatsApp Windows desktop client.
// NB: the dashes are EN DASHES (–), not hyphens — WhatsApp turns any line
// starting with "- " into an indented bullet-list item ("· - - -").
const DIVIDER = "– – – – – – – – – – – – – – – – – – – –";

/** Priority tag, emoji-free. */
const PR_TAG: Record<string, string> = {
  "Top Priority": "TOP PRIORITY",
  Priority: "Priority",
  "Not Urgent": "Not urgent",
};

export interface DashboardCaptionInput {
  subtitle: string;
  reportedBy?: string;
  totalHours: string;
  entries: number;
  members: number;
  clients: number;
  topMembers: Array<{ name: string; hours: string }>;
}

/**
 * WhatsApp caption that accompanies the dashboard image — mirrors the
 * ATTENDANCE/WORK LOG report style so the details are readable even if the
 * image preview is collapsed.
 */
export function buildDashboardCaption(d: DashboardCaptionInput): string {
  const lines: string[] = ["*WORK LOG DASHBOARD*"];
  if (d.subtitle) lines.push(d.subtitle);
  if (d.reportedBy) lines.push(`Reported by: *${d.reportedBy}*`);
  lines.push(
    DIVIDER,
    `Total Hours: *${d.totalHours}*`,
    `Entries: *${d.entries}*`,
    `Members: *${d.members}*`,
    `Clients: *${d.clients}*`,
  );
  if (d.topMembers.length) {
    lines.push(DIVIDER, "*Top Members*");
    d.topMembers.forEach((m, i) =>
      lines.push(`${i + 1}. ${m.name} — ${m.hours} hrs`),
    );
  }
  lines.push(DIVIDER);
  return lines.join("\n");
}

/** One numbered entry: client - italic description - hours - priority. */
const entryLine = (r: WorkLog, i: number): string => {
  const prTag = PR_TAG[r.priority] ? ` - ${PR_TAG[r.priority]}` : "";
  return `${i + 1}. ${r.client ? `[${r.client}] - ` : ""}_${r.task_description || "—"}_${
    r.hours_worked ? ` - ${r.hours_worked} hrs` : ""
  }${prTag}`;
};

/**
 * Format one day's work log as a WhatsApp-ready message (uses WhatsApp's
 * ``*bold*``/``_italic_`` markup). A single member gets a compact layout
 * with the day total on top; multiple members get per-member sections.
 */
export function buildWorkLogShareText(
  logs: WorkLog[],
  date: string,
  reportedBy?: string,
): string {
  const days = logs.filter((r) => r.date === date);

  const dateLabel = new Date(date + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const lines: string[] = ["*WORK LOG REPORT*", dateLabel];
  if (reportedBy) lines.push(`Reported by: *${reportedBy}*`);
  lines.push(DIVIDER);

  if (days.length === 0) {
    lines.push("No work log entries for this day.", DIVIDER);
    return lines.join("\n");
  }

  const byName = new Map<string, WorkLog[]>();
  days.forEach((r) => {
    const key = r.name || "—";
    const arr = byName.get(key);
    if (arr) arr.push(r);
    else byName.set(key, [r]);
  });

  const names = [...byName.keys()].sort((a, b) => a.localeCompare(b));

  // Single member: compact layout — day total on top, then the entries.
  if (names.length === 1) {
    const rows = byName.get(names[0])!;
    const totMins = rows.reduce((s, r) => s + toMins(r.hours_worked), 0);
    lines.push(`Total: *_${fromMins(totMins)} hrs_*`);
    rows.forEach((r, i) => lines.push(entryLine(r, i)));
    lines.push(DIVIDER);
    return lines.join("\n");
  }

  // Multiple members: per-member sections plus a grand total footer.
  let grandMins = 0;
  names.forEach((name, nameIdx) => {
    const rows = byName.get(name)!;
    const totMins = rows.reduce((s, r) => s + toMins(r.hours_worked), 0);
    grandMins += totMins;
    if (nameIdx > 0) lines.push(" ");
    lines.push(`*${name}* — Total: *_${fromMins(totMins)} hrs_*`);
    rows.forEach((r, i) => lines.push(entryLine(r, i)));
  });
  lines.push(
    DIVIDER,
    `${names.length} members · Grand Total: *_${fromMins(grandMins)} hrs_*`,
  );
  return lines.join("\n");
}
