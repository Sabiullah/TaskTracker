import type { ID } from "./common";

export type Role = "admin" | "manager" | "employee";

/** Minimal identity returned by the auth endpoints. */
export interface AuthUser {
  id: ID;
  email: string;
  username: string;
}

export interface Profile {
  id: ID;
  username: string;
  email: string;
  full_name: string;
  role: Role;
  manager_ids: ID[] | null;
  avatar_color: string | null;
  org: string | null;
  invoice_access: boolean;
  notice_access: boolean;
  masters_access: boolean;
  attendance_access: boolean;
  employee_access: boolean;
}

export interface AuthContextValue {
  user: AuthUser | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}
