import type { PlanRow } from "@/types/growthplan";
import type {
  GrowthPlanDto,
  GrowthPlanPriorityValue,
  GrowthPlanStatusValue,
} from "@/types/api";

export const STATUSES: GrowthPlanStatusValue[] = [
  "Open",
  "Under Progress",
  "Completed",
  "On Hold",
  "Cancelled",
];

export const STATUS_CFG: Record<
  GrowthPlanStatusValue,
  { color: string; bg: string; icon: string }
> = {
  Open: { color: "#dc2626", bg: "#fef2f2", icon: "🔴" },
  "Under Progress": { color: "#d97706", bg: "#fef3c7", icon: "🟡" },
  Completed: { color: "#16a34a", bg: "#f0fdf4", icon: "🟢" },
  "On Hold": { color: "#7c3aed", bg: "#f5f3ff", icon: "🟣" },
  Cancelled: { color: "#6b7280", bg: "#f9fafb", icon: "⚫" },
};

export const PRIORITIES: GrowthPlanPriorityValue[] = ["High", "Medium", "Low"];

export const PRIORITY_CFG: Record<
  GrowthPlanPriorityValue,
  { color: string; bg: string }
> = {
  High: { color: "#dc2626", bg: "#fef2f2" },
  Medium: { color: "#d97706", bg: "#fef3c7" },
  Low: { color: "#2563eb", bg: "#eff6ff" },
};

export const BLANK_PLAN_ROW: PlanRow = {
  id: "",
  activity: "",
  target_month: "",
  steps_taken: "",
  steps_to_take: "",
  status: "Open",
  priority: "Medium",
  assigned_to: "",
  assigned_to_uid: null,
  remarks: "",
};

export function dtoToPlanRow(dto: GrowthPlanDto): PlanRow {
  return {
    id: dto.uid,
    activity: dto.activity,
    target_month: dto.target_month ?? "",
    steps_taken: dto.steps_taken,
    steps_to_take: dto.steps_to_take,
    status: dto.status,
    priority: dto.priority,
    assigned_to: dto.assigned_to_detail?.full_name ?? "",
    assigned_to_uid: dto.assigned_to,
    remarks: dto.remarks,
  };
}
