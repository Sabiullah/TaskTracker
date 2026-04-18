/**
 * Pure helpers used by AuthContext — kept in a separate module so the
 * context file only exports React components (required by the vite
 * react-refresh plugin).
 */
import type { OrgPk, Profile, ProfileOrg } from "@/types";
import type { Uid } from "@/types/api";

/** Given an org identifier in any accepted form (numeric PK, UID, or the
 *  membership row itself), locate the matching membership on the profile.
 *  Returns ``null`` when the profile is missing, the argument is nullish,
 *  or the user isn't a member of the requested org. */
export function findMembership(
  profile: Profile | null,
  org: OrgPk | Uid | ProfileOrg | null | undefined,
): ProfileOrg | null {
  if (!profile || org == null || org === "") return null;
  // ProfileOrg instance — shortcut to itself if it's actually on the profile.
  if (typeof org === "object" && "uid" in org) {
    return profile.orgs.find((o) => o.id === org.id) ?? null;
  }
  if (typeof org === "number") {
    return profile.orgs.find((o) => o.id === org) ?? null;
  }
  // String: digit-looking → numeric id; else UID.
  const str = String(org);
  if (/^\d+$/.test(str)) {
    const n = Number(str);
    return profile.orgs.find((o) => o.id === n) ?? null;
  }
  return profile.orgs.find((o) => o.uid === str) ?? null;
}

/** Return the user's "primary" org: the membership flagged ``is_default``,
 *  falling back to the first membership if none is flagged. */
export function pickDefaultOrg(profile: Profile | null): ProfileOrg | null {
  if (!profile || profile.orgs.length === 0) return null;
  return profile.orgs.find((o) => o.is_default) ?? profile.orgs[0];
}
