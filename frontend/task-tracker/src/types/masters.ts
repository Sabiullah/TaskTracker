import type { ID } from "./common";
import type { MasterRecurrence } from "./api/master";

export interface MasterItem {
  id: ID;
  name: string;
  /** 'client' | 'category' */
  type: string;
  /** Legacy single-org field. Kept so existing UI that reads
   *  ``item.org`` (for display / fallback) keeps working; new filter
   *  logic should use the ``orgs`` array below. */
  org: string | null;
  /** Every org uid this master is shared with. Replaces the single
   *  ``org`` field for multi-org clients / categories. Always a subset
   *  of the caller's memberships (the backend rejects writes otherwise). */
  orgs: string[];
  /** Swatch colour — historically used for team members, now optional. */
  color?: string | null;
  /** Self-FK (parent master uid). Only meaningful for ``type='category'``
   *  — a non-null value marks this row as a sub-category of the parent
   *  main category. Drives the auto-populated subtask grid in the
   *  Add/Edit Task modal. */
  parent?: string | null;
  /** Recurrence cadence for a sub-category template. Empty string keeps
   *  the legacy "one row per sub" behaviour. */
  recurrence?: MasterRecurrence;
  /** Day-of-month (1-31) used to compute each generated occurrence's
   *  target date. Clamped to the last day of short months. */
  target_day?: number | null;
}

/** State shape for the masters add/edit modal */
export interface MasterModalState {
  type: string;
  item: MasterItem | null;
}
