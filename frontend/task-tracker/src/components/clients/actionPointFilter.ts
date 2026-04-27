import type { ClientActionPointDto } from "@/types/api/clients";
import { matchesMonth } from "./monthFilter";

export interface ActionPointFilters {
  status: string[];
  priority: string[];
  owner: string[];
  targetMonth: string;
  // When provided, only APs whose uid is in this set match. Driven by the
  // canonical `/client-action-points/overdue/` endpoint so the checkbox
  // stays aligned with the page-header overdue counter.
  overdueUids?: Set<string>;
}

export function isFilterActive(f: ActionPointFilters): boolean {
  return (
    f.status.length > 0 ||
    f.priority.length > 0 ||
    f.owner.length > 0 ||
    f.targetMonth !== "" ||
    f.overdueUids !== undefined
  );
}

export function actionPointMatches(
  ap: ClientActionPointDto,
  f: ActionPointFilters,
): boolean {
  if (f.status.length > 0 && !f.status.includes(ap.status)) return false;
  if (f.priority.length > 0 && !f.priority.includes(ap.priority)) return false;
  if (
    f.owner.length > 0 &&
    !(ap.responsibility && f.owner.includes(ap.responsibility))
  )
    return false;
  if (!matchesMonth(ap.target_date, f.targetMonth)) return false;
  if (f.overdueUids !== undefined && !f.overdueUids.has(ap.uid)) return false;
  return true;
}
