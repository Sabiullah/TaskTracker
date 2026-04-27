import type { ClientVisitDto } from "@/types/api/internalReports";

export interface VisitGroup {
  readonly clientUid: string;
  readonly clientName: string;
  readonly visits: ClientVisitDto[];
}

export function groupVisitsByClient(visits: readonly ClientVisitDto[]): VisitGroup[] {
  const map = new Map<string, VisitGroup>();
  for (const v of visits) {
    const uid = v.client ?? "unassigned";
    const name = v.client_detail?.name ?? "Unassigned";
    const existing = map.get(uid);
    if (existing) {
      existing.visits.push(v);
    } else {
      map.set(uid, { clientUid: uid, clientName: name, visits: [v] });
    }
  }
  for (const g of map.values()) {
    g.visits.sort((a, b) => (a.visit_date < b.visit_date ? 1 : a.visit_date > b.visit_date ? -1 : 0));
  }
  // Stable client order: by name asc.
  return [...map.values()].sort((a, b) => a.clientName.localeCompare(b.clientName));
}
