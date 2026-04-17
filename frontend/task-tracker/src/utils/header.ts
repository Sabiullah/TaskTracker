import { COLUMNS } from "@/utils/task";
import { loadLS, saveLS } from "@/utils/storage";
import type { ParsedTask } from "@/types";

export function loadTabOrder(): string[] | null {
  return loadLS("tt_tab_order", null);
}

export function saveTabOrder(order: string[]): void {
  saveLS("tt_tab_order", order);
}

/** Convert various date formats to YYYY-MM-DD, or '' if invalid/empty */
export const MONTH_MAP: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

export function parseDate(raw: string | null | undefined): string {
  if (!raw) return "";
  const s = raw.trim();
  if (!s) return "";

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // DD/MM/YYYY or DD-MM-YYYY (numeric month)
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy)
    return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;

  // DD-MMM-YY or DD-MMM-YYYY e.g. 09-Apr-26, 09-Apr-2026, 9 Apr 2026
  const dmyText = s.match(/^(\d{1,2})[-/\s]([A-Za-z]{3})[-/\s](\d{2,4})$/);
  if (dmyText) {
    const day = dmyText[1].padStart(2, "0");
    const mon = MONTH_MAP[dmyText[2].toLowerCase()];
    let yr = dmyText[3];
    if (yr.length === 2) yr = (parseInt(yr) >= 50 ? "19" : "20") + yr;
    if (mon) return `${yr}-${mon}-${day}`;
  }

  // Fallback: native Date parse
  const d = new Date(s);
  if (!isNaN(d.getTime()) && d.getFullYear() > 1970)
    return d.toISOString().slice(0, 10);
  return "";
}

/** Split a single CSV line correctly — handles quoted fields with commas inside */
export function splitCSVLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "",
    inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } // escaped quote
      else inQ = !inQ;
    } else if (ch === "," && !inQ) {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

export function parseCSV(text: string): ParsedTask[] | null {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return null;
  const headers = splitCSVLine(lines[0]).map((h) =>
    h.replace(/"/g, "").trim().toLowerCase(),
  );
  const tasks: ParsedTask[] = [];
  const col = (arr: string[], ...names: string[]): number =>
    arr.findIndex((h) => names.some((n) => h.includes(n)));
  const iSNo = col(headers, "s no", "sno", "#");
  const iCli = col(headers, "client");
  const iCat = col(headers, "category");
  const iDesc = col(headers, "description", "desc");
  const iStat = col(headers, "status");
  const iTgt = col(headers, "target");
  const iExp = col(headers, "expected");
  const iComp = col(headers, "comp");
  const iResp = col(headers, "responsible");
  const iRem = col(headers, "remark");
  const iRec = col(headers, "recurrence", "recur");

  const VALID_RECURRENCE = [
    "Onetime",
    "Weekly",
    "Monthly",
    "Quarterly",
    "Halfyearly",
    "Yearly",
  ];

  for (let i = 1; i < lines.length; i++) {
    const cells = splitCSVLine(lines[i]).map((c) =>
      c.replace(/^"|"$/g, "").trim(),
    );
    if (cells.every((c) => !c)) continue;
    const rawStatus = iStat >= 0 ? cells[iStat] || "Pending" : "Pending";
    const matchedStatus =
      (COLUMNS as Array<{ id: string }>).find(
        (c) => c.id.toLowerCase() === rawStatus.toLowerCase(),
      )?.id || "Pending";
    const rawRec = iRec >= 0 ? cells[iRec] || "Onetime" : "Onetime";
    const matchedRec =
      VALID_RECURRENCE.find((r) => r.toLowerCase() === rawRec.toLowerCase()) ||
      "Onetime";
    tasks.push({
      id: `task-${Date.now()}-${i}`,
      serialNo: iSNo >= 0 ? parseInt(cells[iSNo]) || i : i,
      client: iCli >= 0 ? cells[iCli] || "" : "",
      category: iCat >= 0 ? cells[iCat] || "" : "",
      description: iDesc >= 0 ? cells[iDesc] || "" : "",
      status: matchedStatus,
      targetDate: iTgt >= 0 ? parseDate(cells[iTgt]) : "",
      expectedDate: iExp >= 0 ? parseDate(cells[iExp]) : "",
      completedDate: iComp >= 0 ? parseDate(cells[iComp]) : "",
      responsible: iResp >= 0 ? cells[iResp] || "" : "",
      remarks: iRem >= 0 ? cells[iRem] || "" : "",
      recurrence: matchedRec,
    });
  }
  return tasks.length ? tasks : null;
}
