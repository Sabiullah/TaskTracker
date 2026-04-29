/**
 * Kaizen DTOs — mirrors `/api/kaizens/`.
 */

import type { BaseDto, IsoDate, IsoDateTime, MasterRefDto, Uid, UserRefDto } from "./common";

export type KaizenStatusValue = "Pending" | "Approved" | "Rejected";

/** Full kaizen payload returned on GET / on POST /approve / on POST /reject. */
export interface KaizenDto extends BaseDto {
  readonly org_uid: Uid | null;
  readonly raised_by_detail: UserRefDto | null;
  readonly entry_date: IsoDate;
  readonly client: Uid | null;
  readonly client_detail: MasterRefDto | null;
  readonly area: string;
  readonly description: string;
  readonly takeaway: string;
  readonly status: KaizenStatusValue;
  readonly reviewed_by_detail: UserRefDto | null;
  readonly reviewed_at: IsoDateTime | null;
  readonly rejection_reason: string;
}

/** Body for `POST /api/kaizens/`. */
export interface KaizenCreate {
  /** UID of a Master with type='client'. */
  readonly client: Uid;
  readonly area?: string;
  readonly description: string;
  readonly takeaway: string;
  /** Org uid. Required when the caller belongs to 2+ orgs; ignored when the
   *  caller has exactly one membership (the backend picks it automatically). */
  readonly org?: Uid;
}

/** Body for `PATCH /api/kaizens/<uid>/` — the raiser can fix typos while Pending. */
export type KaizenUpdate = Partial<KaizenCreate>;

/** Body for `POST /api/kaizens/<uid>/reject/`. */
export interface KaizenRejectBody {
  readonly reason: string;
}
