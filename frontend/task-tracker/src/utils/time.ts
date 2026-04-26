// ── Time utilities ─────────────────────────────────────────────────────────

/** Matches HH:MM or H:MM time strings (e.g. "2:30", "10:05") */
export const TIME_RE: RegExp = /^(\d+):([0-5]\d)$/;

/** Returns true if the value is empty or a valid H:MM time string */
export function validTime(t: string): boolean {
  return !t || TIME_RE.test(t.trim());
}

/** Converts a H:MM string to total minutes; returns 0 for invalid input */
export function toMins(t: string): number {
  if (!t) return 0;
  const m = t.match(TIME_RE);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

/** Converts total minutes to a H:MM string (e.g. 90 → "1:30") */
export function fromMins(mins: number): string {
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`;
}

/** Slice an `"HH:MM:SS"` / `"HH:MM"` time string to `"HH:MM"`; `"—"` for empty. */
export function fmtClockTime(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : "—";
}

/**
 * Compute worked hours between two `"HH:MM"` / `"HH:MM:SS"` strings. Returns
 * `null` when either side is missing or invalid. Used as a frontend fallback
 * when the server hasn't supplied `total_hours` (e.g. unsaved edit form rows).
 */
export function computeWorkedHours(
  login: string | null | undefined,
  logout: string | null | undefined,
): number | null {
  if (!login || !logout) return null;
  const l = toMins(login.slice(0, 5));
  const o = toMins(logout.slice(0, 5));
  if (o < l) return null;
  return Math.round(((o - l) / 60) * 100) / 100;
}

/** Format hours as `"Hh MMm"` (e.g. 8.5 → "8h 30m"); `"—"` for null/undefined. */
export function fmtWorkedHours(h: number | null | undefined): string {
  if (h == null) return "—";
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return `${whole}h ${String(mins).padStart(2, "0")}m`;
}
