import { toMins, fromMins } from "@/utils/time";
import type { WorkLog } from "@/types";

// Only text-font symbols (— → · •) are used in the message: they render
// reliably everywhere, including the WhatsApp Windows desktop client.
const DIVIDER = "———————————————";

/** Priority tag, emoji-free. */
const PR_TAG: Record<string, string> = {
  "Top Priority": "TOP PRIORITY",
  Priority: "Priority",
  "Not Urgent": "Not urgent",
};

/**
 * Format one day's work log as a WhatsApp-ready message (uses WhatsApp's
 * ``*bold*``/``_italic_`` markup). Entries are grouped per member with
 * per-member and grand hour totals.
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
    month: "short",
    year: "numeric",
  });

  const lines: string[] = ["*WORK LOG REPORT*", ` _${dateLabel}_`];
  if (reportedBy) lines.push(`Reported by: *${reportedBy}*`);
  lines.push(DIVIDER);

  if (days.length === 0) {
    lines.push("No work log entries for this day.");
    return lines.join("\n");
  }

  const byName = new Map<string, WorkLog[]>();
  days.forEach((r) => {
    const key = r.name || "—";
    const arr = byName.get(key);
    if (arr) arr.push(r);
    else byName.set(key, [r]);
  });

  let grandMins = 0;
  const names = [...byName.keys()].sort((a, b) => a.localeCompare(b));
  names.forEach((name, nameIdx) => {
    const rows = byName.get(name)!;
    const totMins = rows.reduce((s, r) => s + toMins(r.hours_worked), 0);
    grandMins += totMins;
    if (nameIdx > 0) lines.push("");
    lines.push(`*${name}* — ${fromMins(totMins)} hrs`);
    rows.forEach((r, i) => {
      const prTag = PR_TAG[r.priority] ? ` · ${PR_TAG[r.priority]}` : "";
      lines.push(
        `${i + 1}. ${r.client ? `[${r.client}] ` : ""}${r.task_description || "—"}${
          r.hours_worked ? ` · ${r.hours_worked} hrs` : ""
        }${prTag}`,
      );
    });
  });

  // The footer only adds information when several members are listed —
  // for a single member it just repeats their own total.
  if (byName.size > 1) {
    lines.push(
      DIVIDER,
      `${byName.size} members · Total: ${fromMins(grandMins)} hrs`,
    );
  }
  return lines.join("\n");
}
