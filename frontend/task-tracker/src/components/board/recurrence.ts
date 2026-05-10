/**
 * Pure occurrence-engine helpers for sub-category templates.
 *
 * Given a sub-category's recurrence + target_day and a goal-level
 * (startMonth, engagementMonths) window, ``generateOccurrences`` returns
 * the list of target dates (ISO ``YYYY-MM-DD``) that fall in the window.
 * Each returned date becomes one materialised subtask row in the
 * Add/Edit Task modal.
 *
 * Kept separate from TaskModal.tsx because:
 *   - the rules (clamp to month-end, half-yearly = 6-month step, etc.)
 *     are easy to get wrong and worth unit-testing in isolation;
 *   - react-refresh/only-export-components forbids exporting non-component
 *     helpers from a *.tsx component file.
 */

import type { MasterRecurrence } from "@/types/api";

/** Step in months between two consecutive occurrences. ``Onetime`` and the
 *  empty/legacy value both produce a single occurrence at ``startMonth``. */
const STEP_MONTHS: Readonly<Record<MasterRecurrence, number>> = {
  "": 0,
  Onetime: 0,
  Monthly: 1,
  Quarterly: 3,
  Halfyearly: 6,
  Yearly: 12,
};

/** Last day of (1-indexed) ``year``/``month``. ``new Date(y, m, 0)`` rolls
 *  back to the previous month's last day — the standard JS trick. */
export function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Format ``year-month-day`` as ``YYYY-MM-DD``. ``month`` and ``day`` are
 *  1-indexed and must already be valid (caller clamps ``day``). */
function fmt(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/** Parse ``YYYY-MM`` into a ``{year, month}`` (month 1-indexed). Returns
 *  ``null`` for malformed input so the caller can short-circuit. */
export function parseStartMonth(
  startMonth: string,
): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(startMonth);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || month < 1 || month > 12) return null;
  return { year, month };
}

/**
 * Generate ISO target dates for one sub-category template.
 *
 * - ``recurrence === ""`` or ``"Onetime"`` ⇒ a single date at the start
 *   month + ``targetDay`` (or empty string if ``targetDay`` is null —
 *   caller can fill it in).
 * - All other recurrences step every {1, 3, 6, 12} months and emit one
 *   date per occurrence whose start-of-month falls inside
 *   ``[startMonth, startMonth + engagementMonths)``.
 *
 * Returns ``[]`` for an unparseable ``startMonth`` so the UI can detect
 * "nothing to materialise" without throwing.
 */
export function generateOccurrences(args: {
  recurrence: MasterRecurrence;
  targetDay: number | null;
  startMonth: string; // "YYYY-MM"
  engagementMonths: number;
}): string[] {
  const start = parseStartMonth(args.startMonth);
  if (!start) return [];
  const step = STEP_MONTHS[args.recurrence] ?? 0;
  const length = Math.max(1, Math.floor(args.engagementMonths));

  const dayFor = (year: number, month: number): string => {
    if (args.targetDay == null) return "";
    const clamped = Math.min(
      Math.max(1, args.targetDay),
      lastDayOfMonth(year, month),
    );
    return fmt(year, month, clamped);
  };

  if (step === 0) {
    // OneTime / legacy — exactly one row at the start month.
    return [dayFor(start.year, start.month)];
  }

  const out: string[] = [];
  for (let offset = 0; offset < length; offset += step) {
    // ``Date`` overflow handles month wrap-around for free: month 13
    // becomes Jan of next year, month 14 → Feb, etc.
    const d = new Date(start.year, start.month - 1 + offset, 1);
    out.push(dayFor(d.getFullYear(), d.getMonth() + 1));
  }
  return out;
}

/** Default Start Month for the modal: today's year-month in local time. */
export function thisMonthString(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Parse "YYYY-MM" → Date at the first of that month, or null on failure. */
export function parseYearMonth(yearMonth: string): Date | null {
  const parsed = parseStartMonth(yearMonth);
  if (!parsed) return null;
  return new Date(parsed.year, parsed.month - 1, 1);
}

/** "2026-05" + 3 → "2026-08". Negative offsets work. Year wraps automatically. */
export function addMonthsToYearMonth(yearMonth: string, offset: number): string {
  const parsed = parseStartMonth(yearMonth);
  if (!parsed) return yearMonth;
  const d = new Date(parsed.year, parsed.month - 1 + offset, 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Inclusive list of YYYY-MM strings between two endpoints. Returns []
 *  when `end` is before `start`, so the caller can treat that as "no
 *  months available" without a separate check. */
export function monthsBetween(start: string, end: string): string[] {
  const s = parseStartMonth(start);
  const e = parseStartMonth(end);
  if (!s || !e) return [];
  const out: string[] = [];
  let y = s.year;
  let m = s.month;
  while (y < e.year || (y === e.year && m <= e.month)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}
