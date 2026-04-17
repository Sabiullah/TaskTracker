/**
 * Base DTO primitives shared by every resource DTO.
 *
 * DTOs mirror the Django REST response shapes described in `docs/API_USAGE_GUIDE.md`
 * and the gap specs under `docs/`. They are never mutated by app code — the
 * conversion between DTO and the app's domain model happens in a single place
 * (`src/lib/api/mappers.ts`).
 *
 * Naming convention:
 *   - `*Dto`     — the shape the server returns on GET.
 *   - `*Create`  — the shape the client sends on POST (usually a subset).
 *   - `*Update`  — the shape the client sends on PATCH (usually a partial).
 */

/** ISO 8601 datetime with timezone, e.g. `"2026-04-12T10:00:00Z"`. */
export type IsoDateTime = string;

/** `YYYY-MM-DD` calendar date string. */
export type IsoDate = string;

/** `HH:MM:SS` (seconds optional on the wire) time-of-day string. */
export type IsoTime = string;

/** UUID string used as every foreign-key value and resource identifier. */
export type Uid = string;

/** Server-assigned integer primary key. Prefer `uid` in application code. */
export type Pk = number;

/** Fields every resource DTO carries after the server has persisted it. */
export interface BaseDto {
  readonly id: Pk;
  readonly uid: Uid;
  readonly created_at: IsoDateTime;
  readonly updated_at: IsoDateTime;
}

/** Expanded user reference attached as `<field>_detail` on most resources. */
export interface UserRefDto {
  readonly id: Pk;
  readonly uid: Uid;
  readonly full_name: string;
  readonly username: string;
}

/** Expanded organisation reference. */
export interface OrgRefDto {
  readonly id: Pk;
  readonly uid: Uid;
  readonly name: string;
}

/** Expanded master reference (client, category, team). */
export interface MasterRefDto {
  readonly id: Pk;
  readonly uid: Uid;
  readonly name: string;
  readonly type: string;
  readonly color: string;
}

/** Body returned for every non-2xx Django response. */
export interface ApiErrorBody {
  readonly error: string;
}

/** One row inside a 207 Multi-Status response from a bulk endpoint. */
export interface BulkRowResult {
  readonly index: number;
  readonly status: number;
  readonly uid?: Uid;
  readonly error?: string;
}

/** Envelope for 207 Multi-Status responses (`bulk_create`, `bulk_import`, etc.). */
export interface BulkResult {
  readonly created?: number;
  readonly updated?: number;
  readonly failed?: number;
  readonly results: readonly BulkRowResult[];
}
