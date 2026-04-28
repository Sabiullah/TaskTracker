import type {
  ClientActionPointDto,
  ClientMeetingDto,
  ClientRoadmapDto,
} from "@/types/api/clients";
import type { ClientVisitDto } from "@/types/api/internalReports";
import { deriveRoadmapStatus } from "./roadmapStatus";

export interface BadgeCounts {
  readonly roadmapOverdue: number;
  readonly momOverdue: number;
  readonly internalCombined: number;
  readonly total: number;
}

export interface ComputeBadgeCountsArgs {
  readonly myUid: string | null;
  // orgUid may be null for records not bound to a specific org.
  // Callers that return true for null (e.g. isAdminInAny) treat those rows as
  // globally visible to admins.
  readonly isAdminFor: (orgUid: string | null) => boolean;
  readonly selectedOrg: string | null;
  readonly clientUid: string | null;
  readonly roadmapItems: readonly ClientRoadmapDto[];
  readonly overdueAPs: readonly ClientActionPointDto[];
  readonly meetings: readonly ClientMeetingDto[];
  readonly visits: readonly ClientVisitDto[];
}

const ZERO: BadgeCounts = {
  roadmapOverdue: 0,
  momOverdue: 0,
  internalCombined: 0,
  total: 0,
};

export function computeBadgeCounts(args: ComputeBadgeCountsArgs): BadgeCounts {
  const {
    myUid,
    isAdminFor,
    selectedOrg,
    clientUid,
    roadmapItems,
    overdueAPs,
    meetings,
    visits,
  } = args;

  if (!myUid) return ZERO;

  // ── Roadmap ────────────────────────────────────────────────────────────
  let roadmapOverdue = 0;
  for (const r of roadmapItems) {
    if (selectedOrg && r.org_uid !== selectedOrg) continue;
    if (clientUid) {
      if (r.client !== clientUid) continue;
    }
    if (deriveRoadmapStatus(r) !== "Overdue") continue;
    if (isAdminFor(r.org_uid)) {
      roadmapOverdue += 1;
    } else if (r.owner === myUid) {
      roadmapOverdue += 1;
    }
  }

  // ── MOM action points ──────────────────────────────────────────────────
  const meetingsById = new Map<number, ClientMeetingDto>();
  for (const m of meetings) meetingsById.set(m.id, m);

  let momOverdue = 0;
  for (const p of overdueAPs) {
    const m = meetingsById.get(p.meeting);
    if (!m) continue;
    if (selectedOrg && m.org_uid !== selectedOrg) continue;
    if (clientUid && m.client !== clientUid) continue;
    if (isAdminFor(m.org_uid)) {
      momOverdue += 1;
    } else if (p.responsibility === myUid) {
      momOverdue += 1;
    }
  }

  // ── Internal Report (set-deduped by uid) ───────────────────────────────
  const internalUids = new Set<string>();
  for (const v of visits) {
    if (selectedOrg && v.org_uid !== selectedOrg) continue;
    if (clientUid && v.client !== clientUid) continue;
    const admin = isAdminFor(v.org_uid);
    if (admin) {
      if (v.is_overdue || v.current_status === "Pending") {
        internalUids.add(v.uid);
      }
    } else {
      if (v.is_overdue && v.prepared_by === myUid) internalUids.add(v.uid);
      if (v.current_status === "Pending" && v.assigned_manager === myUid) {
        internalUids.add(v.uid);
      }
    }
  }
  const internalCombined = internalUids.size;

  return {
    roadmapOverdue,
    momOverdue,
    internalCombined,
    total: roadmapOverdue + momOverdue + internalCombined,
  };
}
