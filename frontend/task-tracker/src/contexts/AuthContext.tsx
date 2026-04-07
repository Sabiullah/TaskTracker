import { createContext, useEffect, useState, type ReactNode } from "react";
import {
  apiPost,
  apiGet,
  setTokens,
  clearTokens,
  getAccessToken,
} from "@/lib/api";
import type { AuthUser, Profile, AuthContextType } from "@/types/auth";

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!getAccessToken()) {
        setLoading(false);
        return;
      }
      try {
        const data = await apiGet<Profile>("/auth/me/");
        setUser({
          id: data.id,
          username: data.username!,
          full_name: data.full_name,
          role: data.role,
        });
        setProfile(data);
      } catch {
        clearTokens();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const signIn = async (username: string, password: string) => {
    try {
      const data = await apiPost<{
        access: string;
        refresh: string;
        user: Profile;
      }>("/auth/login/", { username, password });
      setTokens(data.access, data.refresh);
      setUser({
        id: data.user.id,
        username: data.user.username!,
        full_name: data.user.full_name,
        role: data.user.role,
      });
      setProfile(data.user);
      return { error: null };
    } catch (e) {
      return { error: { message: (e as Error).message } };
    }
  };

  const signOut = async () => {
    clearTokens();
    setUser(null);
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export { AuthContext };
