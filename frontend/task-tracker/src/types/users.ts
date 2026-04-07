import type { Profile } from "./auth";

export type RoleKey = "admin" | "manager" | "employee";

export interface UserProfile extends Profile {
  email?: string;
  role?: RoleKey;
  invoice_access?: boolean;
  notice_access?: boolean;
}

export interface MultiManagerSelectProps {
  options: UserProfile[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
}

export interface UsersPageProps {
  profiles: UserProfile[];
  onRefresh: () => void;
}

export interface CreateUserForm {
  username: string;
  email: string;
  password: string;
  role: RoleKey;
  manager_id: string;
}

export interface ResetTarget {
  id: string;
  full_name?: string;
  email?: string;
}
