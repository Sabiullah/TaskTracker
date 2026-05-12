import { useMemo } from "react";
import { useInvoices } from "@/hooks/useInvoices";
import { useAuth } from "@/hooks/useAuth";
import { isOverdue } from "@/utils/invoice";

/**
 * Live count for the NavMenu "Invoice" badge — surfaces invoices that need
 * attention right now:
 *   - overdue (Pending past invoice_date) — everyone sees these
 *   - awaiting approval (Uploaded)        — admins only, since they're the
 *                                            ones who can clear them
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
    return entries.reduce((n, e) => {
      if (isOverdue(e)) return n + 1;
      if (isAdmin && e.status === "Uploaded") return n + 1;
      return n;
    }, 0);
  }, [entries, loading, isAdmin]);
}
