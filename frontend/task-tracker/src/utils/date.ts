import type { DateString } from "@/types";

/** Full English month names, Jan..Dec. */
export const MONTHS: readonly string[] = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Today's date as a YYYY-MM-DD string (local time, computed once at module load).
 */
export const TODAY: string = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
})();

/**
 * Returns a local YYYY-MM-DD string for a Date object (avoids UTC timezone shift).
 */
export function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Returns the short weekday name (e.g. "Mon") for a date string, or "" if empty.
 */
export function getDayName(ds: string | null | undefined): string {
  if (!ds) return "";
  return new Date(ds + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "short",
  });
}

/**
 * Format a YYYY-MM month string as "Apr 2025" (e.g. for board month selector).
 * Returns `""` for empty / null / undefined input.
 */
export function formatMonthLabel(key: DateString | null | undefined): string {
  if (!key) return "";
  const [y, m] = key.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
  });
}

/**
 * Format a date string as "DD Mon" (e.g. "09 Apr") or "—" if empty.
 * Used for invoice dates and general short date display.
 */
export function fmtDate(d: DateString | null | undefined): string {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });
}

/**
 * Format a datetime string as a full locale string (e.g. "09 Apr 2025, 02:30 pm").
 */
export function fmtFull(d: DateString | null | undefined): string {
  if (!d) return "";
  return new Date(d).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Format a date string as "DD Mon 'YY" (e.g. "09 Apr '25") or "—" if empty.
 * Used for attendance and leads date display.
 */
export function fmtDateShort(d: DateString | null | undefined): string {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
}

/**
 * Format a datetime string for chat display:
 * - Today → "HH:MM"
 * - Yesterday → "Yesterday"
 * - Older → "DD Mon"
 */
export function fmtTime(d: DateString | null | undefined): string {
  if (!d) return "";
  const dt = new Date(d);
  const now = new Date();
  if (dt.toDateString() === now.toDateString())
    return dt.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (dt.toDateString() === yest.toDateString()) return "Yesterday";
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}
