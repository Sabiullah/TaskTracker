/**
 * Master (client / category) DTOs — mirrors `/api/masters/`.
 *
 * Note: organisations are their own first-class resource at `/api/orgs/` — the
 * `type === "org"` case that lived on the Supabase `masters` table has been
 * split off server-side. See `src/types/api/org.ts`. The historical
 * ``type === "team"`` discriminator is also gone — team members now live on
 * the `User` + `OrgMembership` tables and are served by `/api/profiles/`.
 */

import type { BaseDto, Pk, Uid } from "./common";

/** Allowed values for the `type` discriminator. */
export type MasterTypeValue = "client" | "category";

/** Full master payload. */
export interface MasterDto extends BaseDto {
  readonly name: string;
  readonly type: MasterTypeValue;
  readonly color: string;
  readonly is_active: boolean;
  readonly sort_order: number;
  /** Legacy single-org FK (nullable). Kept for back-compat; prefer `orgs`. */
  readonly org: Uid | null;
  readonly org_uid: Uid | null;
  /** Every org this master is shared with. Populated from the M2M on
   *  the backend — at minimum includes the legacy `org` when set. */
  readonly orgs: readonly Uid[];
  readonly created_by_uid: Uid | null;
}

/** Body for `POST /api/masters/`. */
export interface MasterCreate {
  readonly name: string;
  readonly type: MasterTypeValue;
  readonly color?: string;
  readonly is_active?: boolean;
  readonly sort_order?: number;
  /** Legacy single-org field. New code should send `orgs` instead. */
  readonly org?: Uid;
  /** List of org uids the master is shared with. Replaces the single-`org`
   *  field for multi-org clients / categories. */
  readonly orgs?: readonly Uid[];
}

/** Body for `PATCH /api/masters/<uid>/`. */
export interface MasterUpdate {
  readonly name?: string;
  readonly type?: MasterTypeValue;
  readonly color?: string;
  readonly is_active?: boolean;
  readonly sort_order?: number;
  readonly org?: Uid;
  readonly orgs?: readonly Uid[];
}

/** One row in the `POST /api/masters/bulk_upsert/` request array. */
export interface MasterBulkUpsertRow {
  readonly id?: Pk;
  readonly name: string;
  readonly type: MasterTypeValue;
  readonly sort_order?: number;
  readonly color?: string;
  readonly is_active?: boolean;
  readonly org?: Uid;
}
