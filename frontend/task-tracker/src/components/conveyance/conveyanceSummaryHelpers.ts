/**
 * Pure helper functions for ConveyanceSummary.
 *
 * Kept in a separate file so the component file exports only the
 * component (required by react-refresh/only-export-components).
 */

import type { SummaryTopEntry } from "@/types/api/conveyance";

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
});

export function formatAmount(s: string): string {
  const n = Number(s);
  if (Number.isNaN(n)) return s;
  return INR.format(n);
}

export function buildTooltip(top: SummaryTopEntry[], entryCount: number): string {
  if (top.length === 0) return "";
  const lines = top.map((e) => `${e.date} · ${e.reason} · ${formatAmount(e.amount)}`);
  if (entryCount > top.length) {
    lines.push(`…and ${entryCount - top.length} more`);
  }
  return lines.join("\n");
}
