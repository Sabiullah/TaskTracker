import type { LeadStatusRecord, LeadPriority } from "@/types";
import { TODAY } from "@/utils/date";

// ── Default statuses (fallback if DB is empty) ─────────────────────────────────
export const DEFAULT_STATUSES: LeadStatusRecord[] = [
  { id: "", name: "Cold", color: "#64748b", sort_order: 1 },
  { id: "", name: "Warm", color: "#d97706", sort_order: 2 },
  { id: "", name: "Hot", color: "#ea580c", sort_order: 3 },
  { id: "", name: "Confirmed", color: "#16a34a", sort_order: 4 },
  { id: "", name: "Cancelled", color: "#dc2626", sort_order: 5 },
];

// Preset color swatches for status master
export const PRESET_COLORS: string[] = [
  "#64748b",
  "#2563eb",
  "#0891b2",
  "#7c3aed",
  "#db2777",
  "#d97706",
  "#ea580c",
  "#dc2626",
  "#16a34a",
  "#059669",
];

export const LEAD_SOURCES: string[] = [
  "Referral",
  "Cold Call",
  "Social Media",
  "Website",
  "Exhibition",
  "Walk-in",
  "Email Campaign",
  "LinkedIn",
  "Advertisement",
  "Client Referral",
  "Other",
];

export const PRIORITIES: LeadPriority[] = [
  { value: "High", color: "#dc2626", bg: "#fee2e2" },
  { value: "Medium", color: "#d97706", bg: "#fef3c7" },
  { value: "Low", color: "#16a34a", bg: "#dcfce7" },
];

// Derive light background from hex color
export function hexBg(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},0.10)`;
}

export const priorityStyle = (v: string): Record<string, unknown> => {
  const p = PRIORITIES.find((x) => x.value === v);
  return p
    ? {
        background: p.bg,
        color: p.color,
        padding: "2px 9px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }
    : {};
};

export const isOverdue = (d: string | null | undefined): boolean =>
  !!(d && d < TODAY);

export const BLANK: Record<string, string> = {
  client: "",
  contact_person: "",
  contact_email: "",
  contact_phone: "",
  lead_source: "Referral",
  reference_from: "",
  status: "",
  priority: "Medium",
  assigned_to: "",
  estimated_value: "",
  action_taken: "",
  next_step: "",
  next_step_date: "",
  remarks: "",
};
