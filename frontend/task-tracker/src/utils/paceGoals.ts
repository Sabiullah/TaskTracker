import type { CSSProperties } from "react";
import type {
  PaceFocusAreaValue,
  PaceFrequencyValue,
  PaceGoalPriorityValue,
  PaceGoalStatusValue,
  PaceGoalTypeValue,
  PaceIcebergLevelValue,
} from "@/types/api";

export interface TypeConfig {
  color: string;
  bg: string;
  icon: string;
}

export const GOAL_TYPES: readonly PaceGoalTypeValue[] = [
  "Result",
  "Skill",
  "Attitude",
];

export const TYPE_CFG: Record<PaceGoalTypeValue, TypeConfig> = {
  Result: { color: "#2563eb", bg: "#eff6ff", icon: "🎯" },
  Skill: { color: "#d97706", bg: "#fef3c7", icon: "📚" },
  Attitude: { color: "#7c3aed", bg: "#f5f3ff", icon: "💪" },
};

export const STATUS_LIST: readonly PaceGoalStatusValue[] = [
  "Not Started",
  "In Progress",
  "Achieved",
  "Needs Attention",
];

export const STATUS_CLR: Record<PaceGoalStatusValue, string> = {
  "Not Started": "#6b7280",
  "In Progress": "#2563eb",
  Achieved: "#16a34a",
  "Needs Attention": "#dc2626",
};

export const PRIORITIES: readonly PaceGoalPriorityValue[] = [
  "Critical",
  "Development",
  "Stretch",
];

export const ICEBERG: readonly PaceIcebergLevelValue[] = [
  "Skill",
  "Knowledge",
  "Self-Image",
  "Trait",
  "Motive",
];

export const FOCUS: readonly PaceFocusAreaValue[] = [
  "Practice",
  "Build Habit",
  "Strengthen",
  "Deepen",
  "Develop",
];

export const FREQ: readonly PaceFrequencyValue[] = [
  "Weekly",
  "Monthly",
  "Quarterly",
  "45 Days",
  "Fortnightly",
];

// Goal modals use a bigger input than the shared dense tableStyles variant.
export const inpS: CSSProperties = {
  padding: "8px 10px",
  border: "2px solid #e2e8f0",
  borderRadius: 6,
  fontSize: 13,
  width: "100%",
  boxSizing: "border-box",
  background: "#fff",
  fontFamily: "inherit",
};
