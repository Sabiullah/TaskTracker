export interface Profile extends Record<string, unknown> {
  id: string;
  username?: string;
  name?: string;
  full_name?: string;
  role?: string;
  manager_id?: string | null;
  manager_ids?: string[];
  invoice_access?: boolean;
  notice_access?: boolean;
}

export interface AuthUser {
  id: string;
  username: string;
  full_name?: string;
  role?: string;
}

export interface AuthContextType {
  user: AuthUser | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (
    username: string,
    password: string,
  ) => Promise<{ error: { message: string } | null }>;
  signOut: () => Promise<void>;
}
