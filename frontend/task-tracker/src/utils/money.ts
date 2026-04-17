/**
 * Formats a number as an Indian Rupee currency string.
 * Returns '—' for null/undefined/empty values.
 */
export function fmtMoney(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "—";
  return `₹${amount.toLocaleString("en-IN")}`;
}
