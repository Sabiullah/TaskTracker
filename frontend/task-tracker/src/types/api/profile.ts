/**
 * User / profile DTOs — mirrors `GET /api/profiles/` and the `user` object
 * returned by `POST /api/auth/login/` in `docs/API_USAGE_GUIDE.md`.
 */

import type {
  BaseDto,
  IsoDateTime,
  OrgRefDto,
  Uid,
} from "./common";

/** Role values returned in the `role` field. */
export type RoleValue = "admin" | "manager" | "employee";

/** Feature-access flags stored on the user record. */
export interface AccessFlagsDto {
  readonly invoice_access: boolean;
  readonly notice_access: boolean;
  readonly masters_access: boolean;
  readonly attendance_access: boolean;
  readonly employee_access: boolean;
}

/** Full profile payload as returned by `GET /api/profiles/` (and as `user` inside the login response). */
export interface ProfileDto extends BaseDto, AccessFlagsDto {
  readonly username: string;
  readonly email: string;
  readonly full_name: string;
  readonly role: RoleValue;
  readonly avatar_color: string;
  readonly org: Uid | null;
  readonly org_detail: OrgRefDto | null;
  readonly is_active: boolean;
  readonly manager_id: Uid | null;
  readonly manager_ids: readonly Uid[];
}

/** Body for `POST /api/users/create/`. */
export interface ProfileCreate {
  readonly username: string;
  readonly email: string;
  readonly password: string;
  readonly full_name: string;
  readonly role: RoleValue;
  readonly avatar_color?: string;
  readonly org_uid?: Uid;
  readonly manager_uid?: Uid | null;
}

/** Body for `PATCH /api/users/<uid>/` — every field optional. */
export interface ProfileUpdate {
  readonly username?: string;
  readonly email?: string;
  readonly full_name?: string;
  readonly role?: RoleValue;
  readonly avatar_color?: string;
  readonly is_active?: boolean;
  readonly invoice_access?: boolean;
  readonly notice_access?: boolean;
  readonly masters_access?: boolean;
  readonly attendance_access?: boolean;
  readonly employee_access?: boolean;
  readonly manager_ids?: readonly Uid[];
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

/** Row returned by the access-list endpoints (`/api/invoice_access/`, etc.). */
export interface AccessListRowDto {
  readonly user_id: Uid;
  readonly enabled: boolean;
  readonly granted_by: Uid | null;
  readonly granted_at: IsoDateTime | null;
}
