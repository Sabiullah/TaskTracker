import { useMemo } from "react";
import { useInvoices } from "@/hooks/useInvoices";
import { useAuth } from "@/hooks/useAuth";
import {
  getCurrentFY,
  getFYMonths,
  isOverdue,
} from "@/utils/invoice";
import type { InvoiceEntry, InvoiceStatus } from "@/types";

/** Worst-status wins — same priority table the InvoicePage stat cards use, so
 *  the badge can't disagree with what's printed on the page. */
const STATUS_PRIORITY: Readonly<Record<InvoiceStatus, number>> = {
  Pending: 0,
  Rejected: 1,
  Uploaded: 2,
  Approved: 3,
};

/**
 * Live count for the NavMenu "Invoice" badge — surfaces invoices that need
 * attention right now, in the **current FY**:
 *   - overdue (any entry in the client+month group is Pending past
 *     invoice_date) — everyone sees these
 *   - awaiting approval (group's primary entry is Uploaded) — admins only,
 *     since they're the ones who can clear that queue
 *
 * Entries are grouped by (client, invoice_month) to match the
 * InvoicePage stat cards. Without this, a client with two plans in the
 * same month would double-count (e.g. 14 raw entries vs 9 schedule rows).
 *
 * Returns 0 while the initial fetch is in flight to avoid flashing a stale
 * pill on first paint.
 */
export function useInvoiceAttentionBadge(): number {
  const { entries, loading } = useInvoices();
  const { isAdminInAny } = useAuth();
  const isAdmin = isAdminInAny();

  return useMemo(() => {
    if (loading) return 0;

    const fyMonths = new Set(getFYMonths(getCurrentFY()));
    const groups = new Map<string, InvoiceEntry[]>();
    for (const e of entries) {
      if (!fyMonths.has(e.invoice_month)) continue;
      const key = `${e.client_name}|${e.invoice_month}`;
      const bucket = groups.get(key);
      if (bucket) bucket.push(e);
      else groups.set(key, [e]);
    }

    let count = 0;
    for (const grp of groups.values()) {
      if (grp.some(isOverdue)) {
        count += 1;
        continue;
      }
      if (!isAdmin) continue;
      const primary = grp.reduce(
        (worst, e) =>
          STATUS_PRIORITY[e.status] <= STATUS_PRIORITY[worst.status]
            ? e
            : worst,
        grp[0],
      );
      if (primary.status === "Uploaded") count += 1;
    }
    return count;
  }, [entries, loading, isAdmin]);
}
