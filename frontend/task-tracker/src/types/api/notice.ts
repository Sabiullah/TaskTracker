/**
 * Notice DTOs — mirrors `/api/notices/`.
 *
 * Column renames vs. the Supabase schema:
 *   - `notice_received_date` → `received_date`
 *   - `notice_replied_date`  → `replied_date`
 */

import type {
  BaseDto,
  IsoDate,
  MasterRefDto,
  Uid,
  UserRefDto,
} from "./common";

/** Allowed values for `Notice.status`. */
export type NoticeStatusValue = "Open" | "Replied" | "Appealed" | "Completed";

/** Full notice payload. */
export interface NoticeDto extends BaseDto {
  readonly serial_no: number;

  readonly client: Uid | null;
  readonly client_detail: MasterRefDto | null;
  /** Free-text client name — source of truth for display. Falls back to
   *  `client_detail.name` on legacy rows where only the FK was set. */
  readonly client_name: string;

  readonly dispute_nature: string;
  readonly fy: string;
  readonly status: NoticeStatusValue;
  readonly remarks: string;

  readonly received_date: IsoDate | null;
  readonly replied_date: IsoDate | null;
  readonly next_target_date: IsoDate | null;

  readonly created_by_detail: UserRefDto | null;
}

/** Body for `POST /api/notices/`. */
export interface NoticeCreate {
  readonly client?: Uid | null;
  readonly client_name: string;
  readonly dispute_nature: string;
  readonly fy: string;
  readonly status?: NoticeStatusValue;
  readonly remarks?: string;
  readonly received_date?: IsoDate;
  readonly replied_date?: IsoDate;
  readonly next_target_date?: IsoDate;
  /** Org UID for the new row. Required when the caller belongs to 2+ orgs;
   *  optional otherwise (the backend defaults to the caller's only org). */
  readonly org?: Uid;
}

/** Body for `PATCH /api/notices/<uid>/`. */
export type NoticeUpdate = Partial<NoticeCreate>;
