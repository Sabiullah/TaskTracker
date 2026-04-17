/**
 * Holiday DTOs — mirrors `/api/holidays/`.
 */

import type { BaseDto, IsoDate } from "./common";

/** Allowed values for `Holiday.type`. */
export type HolidayTypeValue = "National" | "Regional" | "Company";

/** Full holiday payload. `day` is a computed read-only field. */
export interface HolidayDto extends BaseDto {
  readonly name: string;
  readonly date: IsoDate;
  readonly day: string;
  readonly type: HolidayTypeValue;
}

/** Body for `POST /api/holidays/`. */
export interface HolidayCreate {
  readonly name: string;
  readonly date: IsoDate;
  readonly type: HolidayTypeValue;
}

/** Body for `PATCH /api/holidays/<uid>/`. */
export type HolidayUpdate = Partial<HolidayCreate>;
