import { exportCSV as exportCSVGeneric } from "@/utils/csv";
import { TODAY } from "@/utils/date";
import type { WorkLog } from "@/types";

interface PriorityConfig {
  value: string;
  label: string;
  rowBg: string;
  border: string;
  badge: string;
  badgeBg: string;
}

export const PRIORITIES: PriorityConfig[] = [
  {
    value: "Top Priority",
    label: "🔴 Top Priority",
    rowBg: "#fff1f2",
    border: "#fecaca",
    badge: "#dc2626",
    badgeBg: "#fee2e2",
  },
  {
    value: "Priority",
    label: "🟠 Priority",
    rowBg: "#fff7ed",
    border: "#fed7aa",
    badge: "#ea580c",
    badgeBg: "#ffedd5",
  },
  {
    value: "Normal",
    label: "🟢 Normal",
    rowBg: "#ffffff",
    border: "#e2e8f0",
    badge: "#16a34a",
    badgeBg: "#dcfce7",
  },
  {
    value: "Not Urgent",
    label: "⚪ Not Urgent",
    rowBg: "#f8fafc",
    border: "#e2e8f0",
    badge: "#64748b",
    badgeBg: "#f1f5f9",
  },
];

export const getPr = (v: string): PriorityConfig =>
  PRIORITIES.find((p) => p.value === v) || PRIORITIES[2];

export function exportCSV(rows: Partial<WorkLog>[]): void {
  exportCSVGeneric(
    rows.map((r) => ({
      Name: r.name || "",
      Day: r.day || "",
      Date: r.date || "",
      Client: r.client || "",
      Task: r.task_description || "",
      Hours: r.hours_worked || "",
      Priority: r.priority || "Normal",
    })),
    "work-log.csv",
  );
}

export const BLANK_ROW: Partial<WorkLog> & { _new: boolean } = {
  _new: true,
  name: "",
  date: TODAY,
  client: "",
  task_description: "",
  hours_worked: "",
  priority: "Normal",
};
