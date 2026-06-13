import { useCallback, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import type { ProfileOrg } from "@/types/auth";

/** Resolve view/edit rights for the active org. Admins always allowed.
 *  ``activeOrgUid`` is the header-selected org (empty => default org). */
export function usePermissions(activeOrgUid?: string) {
  const { orgs, defaultOrg } = useAuth();

  const org: ProfileOrg | null = useMemo(() => {
    if (activeOrgUid) return orgs.find((o) => o.uid === activeOrgUid) ?? defaultOrg;
    return defaultOrg;
  }, [orgs, defaultOrg, activeOrgUid]);

  const canView = useCallback(
    (code: string): boolean => {
      if (!org) return false;
      if (org.role === "admin") return true;
      return org.menu_rights?.[code]?.view ?? false;
    },
    [org],
  );

  const canEdit = useCallback(
    (code: string): boolean => {
      if (!org) return false;
      if (org.role === "admin") return true;
      return org.menu_rights?.[code]?.edit ?? false;
    },
    [org],
  );

  return { canView, canEdit, org };
}
