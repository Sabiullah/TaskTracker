import type { RoadmapStatus } from "@/types/api/clients";

export interface RoadmapStatusInput {
  readonly start_date: string | null;
  readonly target_date: string | null;
  readonly expected_date: string | null;
  readonly completion_date: string | null;
}

// Single source of truth for roadmap status derivation — imported by
// ClientRoadmapTab and the badge counts module to keep results consistent.
export function deriveRoadmapStatus(r: RoadmapStatusInput): RoadmapStatus {
  if (r.completion_date) return "Completed";
  const today = new Date().toISOString().slice(0, 10);
  const targetPast = r.target_date !== null && r.target_date < today;
  const expectedSlipped =
    r.target_date !== null &&
    r.expected_date !== null &&
    r.expected_date > r.target_date;
  if (targetPast || expectedSlipped) return "Overdue";
  if (r.start_date) return "In Progress";
  return "Not Started";
}
