import type { Uid } from "./api/common";

/** Numeric primary key — the backend's ``org.id`` field. String-form PKs
 *  live under :type:`Uid`. Not to be confused with the frontend's ``ID``
 *  domain alias which is a UID string. */
export type OrgPk = number;

/** Role value carried on each per-org membership. */
export type Role = "admin" | "manager" | "employee";

/** Per-org feature flags, as a discriminated key-set. */
export type AccessFeature =
  | "invoice_access"
  | "notice_access"
  | "masters_access"
  | "attendance_access"
  | "employee_access"
  | "leads_access"
  | "conveyance_access";

export const ACCESS_FEATURES: readonly AccessFeature[] = [
  "invoice_access",
  "notice_access",
  "masters_access",
  "attendance_access",
  "employee_access",
  "leads_access",
  "conveyance_access",
] as const;

/** Minimal identity returned by the auth endpoints. */
export interface AuthUser {
  id: Uid;
  email: string;
  username: string;
}

/** One entry in ``profile.orgs`` — carries the user's per-org role and the
 *  five per-org ``*_access`` flags, plus their granted-by/at audit pair. */
export interface ProfileOrg {
  /** Numeric PK of the org (use in payloads that expect ``org_id``). */
  id: OrgPk;
  /** UUID of the org (use anywhere ``org_uid`` is expected). */
  uid: Uid;
  name: string;
  role: Role;
  is_default: boolean;
  invoice_access: boolean;
  invoice_access_granted_by: Uid | null;
  invoice_access_granted_at: string | null;
  notice_access: boolean;
  notice_access_granted_by: Uid | null;
  notice_access_granted_at: string | null;
  masters_access: boolean;
  masters_access_granted_by: Uid | null;
  masters_access_granted_at: string | null;
  attendance_access: boolean;
  attendance_access_granted_by: Uid | null;
  attendance_access_granted_at: string | null;
  employee_access: boolean;
  employee_access_granted_by: Uid | null;
  employee_access_granted_at: string | null;
  leads_access: boolean;
  leads_access_granted_by: Uid | null;
  leads_access_granted_at: string | null;
  conveyance_access: boolean;
  conveyance_access_granted_by: Uid | null;
  conveyance_access_granted_at: string | null;
}

/** The authenticated user's profile. Legacy flat fields (`role`, `org`, the
 *  five `*_access` booleans) are gone — everything per-org lives under
 *  ``orgs[]`` now. */
export interface Profile {
  id: Uid;
  username: string;
  email: string;
  full_name: string;
  manager_ids: Uid[] | null;
  avatar_color: string | null;
  orgs: readonly ProfileOrg[];
  /** Best role across every org. Admin > manager > employee. */
  highest_role: Role;
}

/** Helpers exposed by ``AuthContext``. Grouped here so components just
 *  import ``useAuth()`` to reach the whole surface. */
export interface AuthHelpers {
  /** User's membership entries, sorted with the default org first. */
  readonly orgs: readonly ProfileOrg[];
  /** The membership flagged ``is_default`` (or the first one if none). */
  readonly defaultOrg: ProfileOrg | null;
  /** Best role across every org — suitable for list-level UI gates. */
  readonly highestRole: Role | null;

  /** Role in a specific org, or ``null`` if not a member. */
  roleIn: (org: OrgPk | Uid | ProfileOrg | null | undefined) => Role | null;
  /** Is the user admin in that specific org? */
  isAdminIn: (org: OrgPk | Uid | ProfileOrg | null | undefined) => boolean;
  /** Is the user admin or manager in that specific org? Admins count as managers. */
  isManagerIn: (org: OrgPk | Uid | ProfileOrg | null | undefined) => boolean;
  /** Does the user have a given feature flag in that specific org? */
  hasAccessIn: (
    feature: AccessFeature,
    org: OrgPk | Uid | ProfileOrg | null | undefined,
  ) => boolean;

  /** Convenience for UI affordances where the specific org isn't in scope yet. */
  isAdminInAny: () => boolean;
  isManagerInAny: () => boolean;
  hasAccessInAny: (feature: AccessFeature) => boolean;
}

export interface AuthContextValue extends AuthHelpers {
  user: AuthUser | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}
