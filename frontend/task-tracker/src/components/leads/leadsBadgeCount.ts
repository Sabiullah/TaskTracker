import type { Lead } from "@/types";
import { isOverdue } from "@/utils/leads";

/**
 * Count of "open" leads whose next_step_date is past due.
 *
 * "Open" means status is neither Confirmed nor Cancelled (case-insensitive),
 * matching the Open / Confirmed / Cancelled tab split on the Leads page.
 *
 * Mirrors the `stats.overdueFollowups` calculation in `LeadsPage.tsx` so the
 * NavMenu pill number equals the "Overdue" stat tile on the Leads page (when
 * no in-page filters are active).
 */
export function computeLeadsBadgeCount(leads: readonly Lead[]): number {
  let n = 0;
  for (const l of leads) {
    if (!isOverdue(l.next_step_date)) continue;
    const s = (l.status || "").toLowerCase();
    if (s === "confirmed" || s === "cancelled") continue;
    n += 1;
  }
  return n;
}
