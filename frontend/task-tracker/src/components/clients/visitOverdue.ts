/**
 * Mirror of the backend rule (``core.masters.models.is_visit_overdue``):
 * overdue when sent_date is null AND today - visit_date > 1 calendar day.
 * Weekends are counted; this is a strict 1-day SLA.
 */
export interface OverdueShape {
  readonly visit_date: string;
  readonly report_sent_date: string | null;
}

export function isVisitOverdue(visit: OverdueShape, today: Date = new Date()): boolean {
  if (visit.report_sent_date) return false;
  // Parse YYYY-MM-DD as a local date so the diff isn't off-by-one in some TZs.
  const [y, m, d] = visit.visit_date.split("-").map((s) => parseInt(s, 10));
  const visitDay = new Date(y, m - 1, d);
  const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffMs = todayDay.getTime() - visitDay.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return diffDays > 1;
}
