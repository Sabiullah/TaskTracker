import type { ClientActionPointDto } from "@/types/api/clients";
import { matchesMonth } from "./monthFilter";

export interface ActionPointFilters {
  status: string[];
  priority: string[];
  owner: string[];
  targetMonth: string;
}

export function isFilterActive(f: ActionPointFilters): boolean {
  return (
    f.status.length > 0 ||
    f.priority.length > 0 ||
    f.owner.length > 0 ||
    f.targetMonth !== ""
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
  return true;
}
