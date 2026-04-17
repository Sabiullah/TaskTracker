/**
 * Admin-only user-creation wrapper. Calls `POST /api/users/create/` on the
 * Django backend (admin role required; enforced server-side).
 *
 * Returns a `{data, error}` envelope instead of throwing so the UsersPage
 * form can render the error inline without a try/catch block.
 */

import { ApiError, apiPost } from "@/lib/api";
import type { ProfileCreate, ProfileDto, RoleValue, Uid } from "@/types/api";

export interface AdminCreateUserInput {
  readonly username: string;
  readonly email: string;
  readonly password: string | null;
  readonly fullName: string;
  readonly role: RoleValue;
  readonly managerUid?: Uid | null;
  readonly orgUid?: Uid | null;
  readonly avatarColor?: string;
}

export interface CreateUserResult {
  readonly data?: ProfileDto;
  readonly error?: { message: string };
}

/** Default password assigned when the admin doesn't specify one. */
const DEFAULT_PASSWORD = "123456";

export async function adminCreateUser(
  input: AdminCreateUserInput,
): Promise<CreateUserResult> {
  const body: ProfileCreate = {
    username: input.username,
    email: input.email,
    password: input.password || DEFAULT_PASSWORD,
    full_name: input.fullName,
    role: input.role,
    avatar_color: input.avatarColor,
    org_uid: input.orgUid ?? undefined,
    manager_uid: input.managerUid ?? null,
  };

  try {
    const data = await apiPost<ProfileDto>("/users/create/", body);
    return { data };
  } catch (err) {
    if (err instanceof ApiError) return { error: { message: err.message } };
    return { error: { message: (err as Error).message } };
  }
}
