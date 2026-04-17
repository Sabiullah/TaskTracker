import { fromMins, toMins } from "@/utils/time";

/**
 * Convert the app's display format `"H:MM"` (e.g. `"3:30"`) to the decimal
 * string the Django API expects (e.g. `"3.50"`).
 *
 * Invalid or empty input returns `"0.00"` so POST bodies always carry a valid
 * `hours_worked` / `planned_hours`.
 */
export function hoursToDecimal(hhmm: string | null | undefined): string {
  if (!hhmm) return "0.00";
  const mins = toMins(hhmm);
  return (mins / 60).toFixed(2);
}

/**
 * Convert a decimal string or number from the API (e.g. `"3.50"`) back to the
 * app's display format `"H:MM"`. Invalid input returns `""` so the UI can
 * render an empty field.
 */
export function decimalToHours(
  decimal: string | number | null | undefined,
): string {
  if (decimal === null || decimal === undefined || decimal === "") return "";
  const n = typeof decimal === "string" ? Number.parseFloat(decimal) : decimal;
  if (Number.isNaN(n)) return "";
  const mins = Math.round(n * 60);
  return fromMins(mins);
}
