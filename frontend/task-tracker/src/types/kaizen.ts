import type { KaizenStatusValue } from "./api";

/** Row shape used by the Kaizen table. ``client`` is the display name;
 *  ``client_uid`` is the FK we send on save. ``raised_by`` is read-only — it's
 *  always the original creator's name. */
export interface KaizenRow {
  id: string;            // uid from API
  raised_by: string;
  raised_by_uid: string | null;
  entry_date: string;    // YYYY-MM-DD
  client: string;
  client_uid: string;    // empty string while editing a new row before pick
  area: string;
  description: string;
  takeaway: string;
  status: KaizenStatusValue;
  reviewed_by: string;
  reviewed_at: string | null;
  rejection_reason: string;
  org_uid: string | null;
}

export type { KaizenStatusValue };
