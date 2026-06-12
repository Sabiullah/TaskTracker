import { apiGet, apiPatch } from "@/lib/api";
import type {
  MenuNodeDto,
  RightsMap,
  UserRightsResponse,
} from "@/types/menuRights";

export const fetchMenuCatalog = (): Promise<MenuNodeDto[]> =>
  apiGet<MenuNodeDto[]>("/menu-catalog/");

export const fetchUserRights = (orgUid: string): Promise<UserRightsResponse> =>
  apiGet<UserRightsResponse>(`/user-rights/?org=${encodeURIComponent(orgUid)}`);

/** Batch-save. ``changes`` maps user_uid -> menu_code -> {view, edit}. */
export const saveUserRights = (
  orgUid: string,
  changes: Record<string, RightsMap>,
): Promise<UserRightsResponse> =>
  apiPatch<UserRightsResponse>(
    `/user-rights/?org=${encodeURIComponent(orgUid)}`,
    changes,
  );
