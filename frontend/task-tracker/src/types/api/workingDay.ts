import type { BaseDto, IsoDate, Uid } from "./common";

export interface WorkingDayOverrideDto extends BaseDto {
  readonly org_uid: Uid;
  readonly date: IsoDate;
  readonly is_working: boolean;
  readonly note: string;
}

export interface WorkingDayOverrideCreate {
  readonly date: IsoDate;
  readonly is_working: boolean;
  readonly note: string;
  readonly org: Uid;
}
