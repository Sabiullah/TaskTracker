/**
 * User / profile DTOs — mirrors `GET /api/auth/me/` and the `user` object
 * returned by `POST /api/auth/login/`.
 *
 * Multi-org shape: every membership carries its own `role` + per-org feature
 * access flags. A user can be admin in 4D and employee in YBV. The server
 * also exposes `highest_role` as a convenience for list-level UI gates where
 * a specific org isn't in scope yet.
 */

import type { BaseDto, IsoDateTime, Uid } from "./common";

/** Numeric primary key of an ``Org`` row — distinct from :type:`Uid` (the
 *  UUID). Kept as a named alias so call-sites document which form they
 *  want. Mirrors ``users.types.OrgPk``. */
export type OrgPk = number;

/** Role value carried on each OrgMembership. */
export type RoleValue = "admin" | "manager" | "employee";

/** One ``orgs[]`` entry on a profile — per-org identity + role + access.
 *  The five ``*_access`` flags replace the old flat booleans on User. */
export interface ProfileOrgDto {
  readonly id: OrgPk;
  readonly uid: Uid;
  readonly name: string;
  readonly role: RoleValue;
  readonly is_default: boolean;

  readonly invoice_access: boolean;
  readonly invoice_access_granted_by: Uid | null;
  readonly invoice_access_granted_at: IsoDateTime | null;

  readonly notice_access: boolean;
  readonly notice_access_granted_by: Uid | null;
  readonly notice_access_granted_at: IsoDateTime | null;

  readonly masters_access: boolean;
  readonly masters_access_granted_by: Uid | null;
  readonly masters_access_granted_at: IsoDateTime | null;

  readonly attendance_access: boolean;
  readonly attendance_access_granted_by: Uid | null;
  readonly attendance_access_granted_at: IsoDateTime | null;

  readonly employee_access: boolean;
  readonly employee_access_granted_by: Uid | null;
  readonly employee_access_granted_at: IsoDateTime | null;

  readonly leads_access: boolean;
  readonly leads_access_granted_by: Uid | null;
  readonly leads_access_granted_at: IsoDateTime | null;

  readonly conveyance_access: boolean;
  readonly conveyance_access_granted_by: Uid | null;
  readonly conveyance_access_granted_at: IsoDateTime | null;
}

/** Full profile payload as returned by `GET /api/auth/me/` (and as `user`
 *  inside the login response). */
export interface ProfileDto extends BaseDto {
  readonly username: string;
  readonly email: string;
  readonly full_name: string;
  readonly avatar_color: string;
  readonly is_active: boolean;
  readonly manager_id: Uid | null;
  readonly manager_ids: readonly Uid[];
  /** One entry per org the user belongs to; carries per-org role + access. */
  readonly orgs: readonly ProfileOrgDto[];
  /** Best role across every org: admin > manager > employee. */
  readonly highest_role: RoleValue;
}

/** Body for `POST /api/users/create/`.
 *  Caller must be admin of the target ``org``; the field may be omitted when
 *  the caller is admin of exactly one org (server defaults to it). */
export interface ProfileCreate {
  readonly username: string;
  readonly email: string;
  readonly password: string;
  readonly full_name: string;
  readonly role: RoleValue;
  readonly avatar_color?: string;
  /** Target org — accepts id (number) or uid (uuid string). */
  readonly org?: OrgPk | Uid;
  readonly org_id?: OrgPk;
  readonly org_uid?: Uid;
  readonly manager_uid?: Uid | null;
  /** Optional per-org access flags applied to the new membership. */
  readonly invoice_access?: boolean;
  readonly notice_access?: boolean;
  readonly masters_access?: boolean;
  readonly attendance_access?: boolean;
  readonly employee_access?: boolean;
  readonly leads_access?: boolean;
  readonly conveyance_access?: boolean;
}

/** Body for `PATCH /api/users/<uid>/`.
 *
 *  Global fields (full_name, username, email, is_active, avatar_color,
 *  manager_ids) edit the user row. Per-org fields (role, *_access,
 *  is_default) require an ``org`` to disambiguate which membership to
 *  update. */
export interface ProfileUpdate {
  /** Required when any per-org field is set. */
  readonly org?: OrgPk | Uid;
  readonly org_id?: OrgPk;
  readonly org_uid?: Uid;

  readonly username?: string;
  readonly email?: string;
  readonly full_name?: string;
  readonly avatar_color?: string;
  readonly is_active?: boolean;
  readonly manager_ids?: readonly Uid[];

  // Per-org fields (require `org`)
  readonly role?: RoleValue;
  readonly is_default?: boolean;
  readonly invoice_access?: boolean;
  readonly notice_access?: boolean;
  readonly masters_access?: boolean;
  readonly attendance_access?: boolean;
  readonly employee_access?: boolean;
  readonly leads_access?: boolean;
  readonly conveyance_access?: boolean;
}

/** Body for `POST /api/users/reset-password/`. */
export interface PasswordResetRequest {
  readonly user_uid: Uid;
  readonly new_password: string;
}

/** Body for `POST /api/users/delete/`. */
export interface UserDeleteRequest {
  readonly user_uid: Uid;
}

/** Shared success envelope for actions that return `{ ok: true }`. */
export interface OkResponse {
  readonly ok: true;
}

/** Row returned by the access-list endpoints (`/api/users/invoice_access/`,
 *  etc.). Multi-org: one row per (user, org) pair. Clients typically group
 *  by ``org_id`` client-side. */
export interface AccessListRowDto {
  readonly user_id: Uid;
  readonly user_uid: Uid;
  readonly org_id: OrgPk;
  readonly org_uid: Uid;
  readonly org_name: string;
  readonly enabled: boolean;
  readonly granted_by: Uid | null;
  readonly granted_at: IsoDateTime | null;
}
