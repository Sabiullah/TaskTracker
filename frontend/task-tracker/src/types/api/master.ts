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
  readonly org: Uid;
  readonly org_uid: Uid;
  readonly created_by_uid: Uid | null;
}

/** Body for `POST /api/masters/`. */
export interface MasterCreate {
  readonly name: string;
  readonly type: MasterTypeValue;
  readonly color?: string;
  readonly is_active?: boolean;
  readonly sort_order?: number;
  readonly org?: Uid;
}

/** Body for `PATCH /api/masters/<uid>/`. */
export interface MasterUpdate {
  readonly name?: string;
  readonly type?: MasterTypeValue;
  readonly color?: string;
  readonly is_active?: boolean;
  readonly sort_order?: number;
  readonly org?: Uid;
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
