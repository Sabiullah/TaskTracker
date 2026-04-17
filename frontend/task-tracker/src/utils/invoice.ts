import type { CSSProperties } from "react";
import type { InvoicePlan, InvoiceEntry, InvoiceStatus } from "@/types";
import { TODAY } from "@/utils/date";

// ── FY / Date helpers ──────────────────────────────────────────────────────────
export function getCurrentFY(): string {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-${String(y + 1).slice(-2)}`;
}

export function getFYOptions(): string[] {
  const base = (() => {
    const n = new Date();
    return n.getMonth() >= 3 ? n.getFullYear() : n.getFullYear() - 1;
  })();
  return [-2, -1, 0, 1, 2].map((off) => {
    const y = base + off;
    return `${y}-${String(y + 1).slice(-2)}`;
  });
}

export function getFYMonths(fy: string): string[] {
  const startYear = parseInt(fy);
  return Array.from({ length: 12 }, (_, i) => {
    const mo = ((3 + i) % 12) + 1;
    const yr = startYear + (i < 9 ? 0 : 1);
    return `${yr}-${String(mo).padStart(2, "0")}`;
  });
}

export function getAllMonthsInRange(start: string, end: string): string[] {
  const months: string[] = [];
  let [y, m] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, "0")}`);
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}

export function getApplicableMonths(
  plan: Pick<InvoicePlan, "periodicity" | "start_month" | "end_month">,
  months: string[],
): string[] {
  const step =
    (
      { Monthly: 1, Quarterly: 3, "Half-yearly": 6, Yearly: 12 } as Record<
        string,
        number
      >
    )[plan.periodicity] || 1;
  const sD = new Date((plan.start_month ?? "") + "-01");
  const eD = new Date((plan.end_month ?? "") + "-01");
  return months.filter((m) => {
    const d = new Date(m + "-01");
    if (d < sD || d > eD) return false;
    const diff =
      (d.getFullYear() - sD.getFullYear()) * 12 + d.getMonth() - sD.getMonth();
    return diff % step === 0;
  });
}

export function getInvoiceDate(ym: string, day: number): string {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(Math.min(day, new Date(y, m, 0).getDate())).padStart(2, "0")}`;
}

// ── Constants ──────────────────────────────────────────────────────────────────
export const MONTH_SHORT: string[] = [
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
  "Jan",
  "Feb",
  "Mar",
];
export const PERIODICITIES: string[] = [
  "Monthly",
  "Quarterly",
  "Half-yearly",
  "Yearly",
];
export const STATUS_CFG: Record<
  InvoiceStatus,
  { color: string; bg: string; icon: string; label: string }
> = {
  Pending: {
    color: "#d97706",
    bg: "#fef3c7",
    icon: "⏳",
    label: "Pending Upload",
  },
  Uploaded: { color: "#2563eb", bg: "#eff6ff", icon: "📎", label: "Uploaded" },
  Approved: { color: "#16a34a", bg: "#f0fdf4", icon: "✅", label: "Approved" },
  Rejected: { color: "#dc2626", bg: "#fef2f2", icon: "❌", label: "Rejected" },
};
export const isOverdue = (
  e: Partial<InvoiceEntry> | null | undefined,
): boolean => e?.status === "Pending" && (e?.invoice_date ?? "") < TODAY;
export const thS: CSSProperties = {
  padding: "7px 10px",
  textAlign: "left",
  fontWeight: 700,
  color: "#475569",
  fontSize: 11,
  borderBottom: "2px solid #e2e8f0",
  whiteSpace: "nowrap",
  background: "#f8fafc",
};
export const tdS: CSSProperties = {
  padding: "6px 10px",
  color: "#374151",
  verticalAlign: "middle",
  fontSize: 12,
};

// ── Plan Modal ─────────────────────────────────────────────────────────────────
