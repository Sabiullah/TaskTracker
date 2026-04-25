/**
 * Feature-access DTOs — mirrors the six `GET /api/*_access/` endpoints
 * (`invoice_access`, `notice_access`, `masters_access`, `attendance_access`,
 * `employee_access`, `leads_access`).
 *
 * The rows are not separate tables in Django — they are computed from the
 * `*_access` boolean flags on the user record. Toggling a flag is a
 * `PATCH /api/users/<uid>/` with `{ invoice_access: true }` (etc.); the list
 * endpoint re-materialises the access rows.
 */

import type { IsoDateTime, Uid } from "./common";

/** Row returned by any of the access list endpoints. */
export interface AccessRoleDto {
  readonly user_id: Uid;
  readonly enabled: boolean;
  readonly granted_by: Uid | null;
  readonly granted_at: IsoDateTime | null;
}

/** Access-flag name (matches the `*_access` fields on `ProfileDto`). */
export type AccessFlagKey =
  | "invoice_access"
  | "notice_access"
  | "masters_access"
  | "attendance_access"
  | "employee_access"
  | "leads_access";

/** URL path segment for each access list endpoint. */
export const ACCESS_LIST_PATHS: Readonly<Record<AccessFlagKey, string>> = {
  invoice_access: "/invoice_access/",
  notice_access: "/notice_access/",
  masters_access: "/masters_access/",
  attendance_access: "/attendance_access/",
  employee_access: "/employee_access/",
  leads_access: "/leads_access/",
};
