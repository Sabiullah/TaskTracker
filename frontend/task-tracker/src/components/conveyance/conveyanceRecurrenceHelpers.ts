/**
 * Pure helpers for the recurring-conveyance grouping in the transactions
 * list. No React, no DOM — kept in their own module so the test file can
 * import them without the rest of the dialog component graph.
 */

import type { ConveyanceEntry, ConveyanceFrequency } from "@/types/api/conveyance";

export interface SeriesGroup {
  /** ``null`` for one-time singletons, the shared series_uid otherwise. */
  seriesUid: string | null;
  /** Chronological (ascending by date). One element for one-time. */
  entries: ConveyanceEntry[];
}

export function groupBySeries(rows: ConveyanceEntry[]): SeriesGroup[] {
  const out: SeriesGroup[] = [];
  const bySeries = new Map<string, ConveyanceEntry[]>();
  // Preserve original ordering of "first appearance" for stable list output.
  for (const r of rows) {
    if (r.series_uid == null) {
      out.push({ seriesUid: null, entries: [r] });
    } else {
      let bucket = bySeries.get(r.series_uid);
      if (bucket == null) {
        bucket = [];
        bySeries.set(r.series_uid, bucket);
        // Reserve a slot in the output so the group appears in the order of
        // its first sibling (matches the API's date-desc ordering).
        out.push({ seriesUid: r.series_uid, entries: bucket });
      }
      bucket.push(r);
    }
  }
  // Sort each series' entries chronologically (ascending).
  for (const g of out) {
    if (g.seriesUid != null) {
      g.entries.sort((a, b) => a.date.localeCompare(b.date));
    }
  }
  return out;
}

/**
 * Most recent sibling whose ``date <= today``; if every sibling is in the
 * future, the earliest sibling. ``today`` is normalised to a YYYY-MM-DD
 * string in the user's local timezone for date-string comparison.
 */
export function pickHeadline(entries: ConveyanceEntry[], today: Date): ConveyanceEntry {
  if (entries.length === 0) {
    throw new Error("pickHeadline called with empty entries");
  }
  const todayStr = toLocalISODate(today);
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  // Walk from the latest backwards; first <= today wins.
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    if (sorted[i].date <= todayStr) return sorted[i];
  }
  return sorted[0];
}

const FREQUENCY_LABEL: Record<ConveyanceFrequency, string> = {
  one_time: "One-time",
  monthly: "Monthly",
  half_yearly: "Half-yearly",
  yearly: "Yearly",
};

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function ymToShort(ym: string): { month: string; year: string } {
  // Accepts YYYY-MM-DD or YYYY-MM. Returns "Jan" + "2026".
  const [yearPart, monthPart] = ym.split("-");
  const m = parseInt(monthPart, 10);
  return { month: MONTH_NAMES[m - 1] ?? monthPart, year: yearPart };
}

/**
 * "Monthly · Jan–Dec 2026 · 4/12" or "Yearly · Jan 2026 – Jan 2028 · 2/3".
 * Compact form when start and end fall in the same year.
 */
export function formatSeriesBadge(headline: ConveyanceEntry, total: number): string {
  if (headline.start_month == null || headline.end_month == null) return "";
  const freq = FREQUENCY_LABEL[headline.frequency];
  const start = ymToShort(headline.start_month);
  const end = ymToShort(headline.end_month);
  const range =
    start.year === end.year
      ? `${start.month}–${end.month} ${start.year}`
      : `${start.month} ${start.year} – ${end.month} ${end.year}`;
  // Index = position of the headline within the (chronologically sorted)
  // siblings, 1-based. Caller passes the total count.
  const idx = headlineIndex(headline);
  return `${freq} · ${range} · ${idx}/${total}`;
}

function headlineIndex(headline: ConveyanceEntry): number {
  // For monthly steps the index is (headline.date.month - start.month + 1)
  // crossed with year deltas. We compute it generically off the date strings
  // and the start_month so the function stays correct for any frequency.
  if (headline.start_month == null) return 1;
  const [startYear, startMonth] = headline.start_month.split("-").map(Number);
  const [hYear, hMonth] = headline.date.split("-").map(Number);
  const monthsFromStart = (hYear - startYear) * 12 + (hMonth - startMonth);
  switch (headline.frequency) {
    case "monthly":
      return monthsFromStart + 1;
    case "half_yearly":
      return Math.floor(monthsFromStart / 6) + 1;
    case "yearly":
      return Math.floor(monthsFromStart / 12) + 1;
    default:
      return 1;
  }
}

function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
