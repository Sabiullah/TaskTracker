import type { Uid } from "./api/common";

export interface MenuNodeDto {
  code: string;
  label: string;
  parent: string | null;
}

/** view/edit pair for one menu code. Edit implies View. */
export interface RightLevel {
  view: boolean;
  edit: boolean;
}

export type RightsMap = Record<string, RightLevel>;

export interface UserRightsRow {
  user_uid: Uid;
  full_name: string;
  is_admin: boolean;
  rights: RightsMap;
}

export interface UserRightsResponse {
  org_id: number;
  org_uid: Uid;
  users: UserRightsRow[];
}
