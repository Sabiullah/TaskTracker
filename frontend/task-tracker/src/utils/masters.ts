import type { CSSProperties } from "react";
import { parseOrg } from "@/utils/org";
import { loadLS } from "@/utils/storage";

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

/** A master entry (client or team member) carrying its associated org list. */
export interface MasterEntry {
  name: string;
  orgs: string[];
}

// ── Live master lookups ─────────────────────────────────────────────────────
//
// These helpers read from the localStorage cache that `useMasters` / `useOrgs`
// populate from the Django API. If the cache is cold (first visit, hard refresh
// before data has loaded) they return empty arrays — the UI should treat an
// empty master list as "not loaded yet" rather than fall back to hardcoded
// names. The backend is the source of truth.

export function getLiveOrgs(): string[] {
  const stored = loadLS<unknown[]>("tt_orgs", []);
  if (!Array.isArray(stored) || !stored.length) return [];
  return stored
    .map((o: unknown) => (o as { name?: string }).name ?? String(o))
    .filter(Boolean)
    .sort();
}

export function getLiveClientObjects(): MasterEntry[] {
  const stored = loadLS<unknown[]>("tt_clients", []);
  if (!Array.isArray(stored) || !stored.length) return [];
  return stored
    .map((c: unknown) => {
      const obj = c as { name?: string; org?: string };
      return { name: (obj.name ?? "") as string, orgs: parseOrg(obj.org) };
    })
    .filter((c): c is MasterEntry => Boolean(c.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getLiveClients(): string[] {
  return getLiveClientObjects().map((c) => c.name);
}

export function getLiveTeamObjects(): MasterEntry[] {
  const stored = loadLS<unknown[]>("tt_team", []);
  if (!Array.isArray(stored) || !stored.length) return [];
  return stored
    .map((t: unknown) => {
      const obj = t as { name?: string; org?: string };
      return { name: (obj.name ?? "") as string, orgs: parseOrg(obj.org) };
    })
    .filter((t): t is MasterEntry => Boolean(t.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getLiveCategories(): string[] {
  const stored = loadLS<unknown[]>("tt_cats", []);
  if (!Array.isArray(stored) || !stored.length) return [];
  const names = stored
    .map((c: unknown) => (c as { name?: string }).name ?? String(c))
    .filter((n): n is string => Boolean(n));
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}

export function getLiveMembers(): string[] {
  const stored = loadLS<unknown[]>("tt_team", []);
  if (!Array.isArray(stored) || !stored.length) return [];
  const names = stored
    .map((t: unknown) => (t as { name?: string }).name ?? String(t))
    .filter((n): n is string => Boolean(n));
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
}
