/**
 * App settings DTOs — mirrors `/api/app_settings/`. Looked up by string key.
 */

import type { IsoDateTime, Pk } from "./common";

/** Full app-setting payload. */
export interface AppSettingDto {
  readonly id: Pk;
  readonly key: string;
  readonly value: string;
  readonly description: string;
  readonly updated_at: IsoDateTime;
}

/** Body for `POST /api/app_settings/upsert/`. */
export interface AppSettingUpsertRequest {
  readonly key: string;
  readonly value: string;
  readonly description?: string;
}
