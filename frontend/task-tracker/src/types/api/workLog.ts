/**
 * Work log DTOs — mirrors `/api/work_logs/`.
 *
 * Note on `hours_worked`: the wire format is a decimal string (e.g. `"3.50"`)
 * satisfying `0.01 <= x <= 24`. The application's domain `WorkLog` keeps an
 * `"H:MM"` string for display. Conversion happens in `src/lib/api/mappers.ts`.
 */

import type {
  BaseDto,
  IsoDate,
  MasterRefDto,
  Uid,
  UserRefDto,
} from "./common";

/** Allowed values for `WorkLog.priority`. */
export type WorkLogPriorityValue =
  | "Top Priority"
  | "Priority"
  | "Normal"
  | "Not Urgent";

/** Full work-log payload. */
export interface WorkLogDto extends BaseDto {
  readonly user_detail: UserRefDto;
  readonly date: IsoDate;
  readonly task_description: string;
  /** Decimal string, `"0.01".."24.00"`. */
  readonly hours_worked: string;
  readonly priority: WorkLogPriorityValue;
  readonly sort_order: number;

  readonly client: Uid | null;
  readonly client_detail: MasterRefDto | null;

  readonly org: Uid;
  readonly org_uid: Uid;
}

/** Body for `POST /api/work_logs/`. `user` is auto-set server-side. */
export interface WorkLogCreate {
  readonly date: IsoDate;
  readonly task_description: string;
  readonly hours_worked: string;
  readonly priority?: WorkLogPriorityValue;
  readonly sort_order?: number;
  readonly client?: Uid;
  readonly org?: Uid;
}

/** Body for `PATCH /api/work_logs/<uid>/`. */
export type WorkLogUpdate = Partial<WorkLogCreate>;

/** One row in the `POST /api/work_logs/bulk_import/` array (see `docs/misc_endpoints.md`). */
export type WorkLogBulkImportRow = WorkLogCreate;

/** Body for `POST /api/work_logs/bulk_import/`. */
export interface WorkLogBulkImportRequest {
  readonly rows: readonly WorkLogBulkImportRow[];
}

/** Body for `POST /api/work_logs/reorder/`. */
export interface WorkLogReorderRequest {
  readonly rows: readonly { readonly uid: Uid; readonly sort_order: number }[];
}

/** Response from `POST /api/work_logs/reorder/`. */
export interface WorkLogReorderResponse {
  readonly updated: number;
}
