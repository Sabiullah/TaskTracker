/**
 * Organisation DTOs — mirrors `/api/orgs/`.
 */

import type { BaseDto } from "./common";

/** Full organisation payload. */
export interface OrgDto extends BaseDto {
  readonly name: string;
}

/** Body for `POST /api/orgs/` — admin only. */
export interface OrgCreate {
  readonly name: string;
}

/** Body for `PATCH /api/orgs/<uid>/`. */
export interface OrgUpdate {
  readonly name?: string;
}
