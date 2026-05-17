import type { ReactNode } from "react";

/**
 * Shared UI-level types used across multiple components.
 */

/** Application view identifier used by the view router in App.tsx */
export type View = string;

/** A single sticky note stored in localStorage */
export interface StickyNote {
  id: number;
  text: string;
  colorIdx: number;
  created: string;
}

/**
 * Drill-down state for DashboardPage.
 *
 * For `type === "overdue"`, `value` is one of "target" | "expected" | "no-expected".
 */
export interface DashboardDrillDown {
  type: "report" | "status" | "client" | "member" | "today" | "active" | "overdue";
  value?: string;
}

/** Filter state used by the Header toolbar */
export interface HeaderFilters {
  client: string;
  category: string;
  responsible: string;
  reportingManager: string;
}

/** A single navigation tab used by NavMenu and SortableTab */
export interface NavTab {
  id: string;
  label: string;
  icon: ReactNode;
}

/** Per-table result logged during a backup restore */
export interface RestoreLogEntry {
  table: string;
  status: "ok" | "skipped" | "error";
  msg: string;
}
