import type { CSSProperties } from "react";

/** Colour swatches offered to users when picking a master entry colour. */
export const SWATCH: string[] = [
  "#2563eb",
  "#7c3aed",
  "#16a34a",
  "#d97706",
  "#0891b2",
  "#db2777",
  "#dc2626",
  "#4f46e5",
  "#0f766e",
  "#b45309",
  "#6d28d9",
  "#059669",
  "#9333ea",
  "#0284c7",
];

export const secBtn: CSSProperties = {
  padding: "4px 12px",
  border: "1px solid #e2e8f0",
  background: "#f8fafc",
  borderRadius: 5,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
};

export const delBtn: CSSProperties = {
  padding: "4px 12px",
  border: "1px solid #fecaca",
  background: "#fff1f2",
  color: "#dc2626",
  borderRadius: 5,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
};

/** A master entry (client or team member) carrying its associated org uids. */
export interface MasterEntry {
  name: string;
  /** Org UIDs the entry belongs to. Same shape as ``MasterItem.org``
   *  consumers expect — keeping this in uid-space lets callers compare
   *  directly against ``form.organization`` (also a uid). */
  orgs: string[];
}
