/**
 * Pure cell-rendering helpers for the Attendance Matrix view.
 *
 * Mirrors the backend's `core/attendance/matrix.py` cell shape so the frontend
 * can render the payload directly. Kept pure (no React, no hooks) so it's
 * trivially unit-testable and reusable from CSV / PNG export later.
 */

export type CellCode =
  | "P"
  | "H"
  | "A"
  | "L"
  | "L½"
  | "L½+H"
  | "WFH"
  | "WP"
  | "HW"
  | "?"
  | "HD";

export interface CellPayload {
  code: CellCode;
  hours?: number;
  login?: string | null;
  logout?: string | null;
  location?: string | null;
  approval?: string | null;
  holiday_name?: string | null;
}

/** Style preset per code: background, text colour, optional outline.
 *
 *  WP and "?" use a white background with a coloured outline so they stand
 *  out as "needs attention" without competing visually with the solid-fill
 *  Approved/Pending codes. HD is a neutral gray (Sunday/Holiday).
 */
export const CELL_STYLE: Record<CellCode, { bg: string; color: string; outline?: string }> = {
  P: { bg: "#dcfce7", color: "#166534" },
  H: { bg: "#fef3c7", color: "#92400e" },
  A: { bg: "#fee2e2", color: "#991b1b" },
  L: { bg: "#ede9fe", color: "#5b21b6" },
  "L½": { bg: "#ede9fe", color: "#5b21b6" },
  "L½+H": { bg: "#fef3c7", color: "#5b21b6" },
  WFH: { bg: "#cffafe", color: "#0e7490" },
  WP: { bg: "#fff", color: "#0e7490", outline: "#0e7490" },
  HW: { bg: "#a5f3fc", color: "#155e75" },
  "?": { bg: "#fff", color: "#dc2626", outline: "#dc2626" },
  HD: { bg: "#e2e8f0", color: "#475569" },
};

/** Human-readable label per code, used in the legend. */
export const CELL_LABEL: Record<CellCode, string> = {
  P: "Present (≥ 8.5h)",
  H: "Half day (4–8.5h)",
  A: "Absent",
  L: "Leave (full)",
  "L½": "Half-day leave",
  "L½+H": "Half leave + half worked",
  WFH: "WFH (approved)",
  WP: "WFH pending",
  HW: "Holiday worked",
  "?": "Open punch — needs logout fix",
  HD: "Holiday / Sunday",
};

/** Build a tooltip string for hovering over a cell.
 *
 *  Skips empty / null fields so a cell with only `code` shows just the date.
 */
export function tooltipFor(date: string, c: CellPayload): string {
  const parts: string[] = [date];
  if (c.login || c.logout) {
    parts.push(`${c.login ?? "—"} – ${c.logout ?? "—"}`);
  }
  if (c.location) parts.push(c.location);
  if (c.approval) parts.push(c.approval);
  if (c.holiday_name) parts.push(c.holiday_name);
  return parts.join(" · ");
}

/** Tally cell codes per employee — drives the per-row totals on the right. */
export function totalsFor(cells: Record<string, CellPayload>): Record<CellCode, number> {
  const totals: Record<CellCode, number> = {
    P: 0, H: 0, A: 0, L: 0, "L½": 0, "L½+H": 0, WFH: 0, WP: 0, HW: 0, "?": 0, HD: 0,
  };
  for (const c of Object.values(cells)) {
    totals[c.code] += 1;
  }
  return totals;
}
