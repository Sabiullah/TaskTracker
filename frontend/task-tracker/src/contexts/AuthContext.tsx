import React, { createContext, useCallback, useEffect, useState } from "react";
import type { AuthContextValue, AuthUser, Profile } from "@/types";
import {
  dtoToAuthUser,
  dtoToProfile,
  getAccessToken,
  login as apiLogin,
  logout as apiLogout,
  me as apiMe,
} from "@/lib/api";

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function hydrate(): Promise<void> {
      if (!getAccessToken()) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const dto = await apiMe();
        if (cancelled) return;
        setUser(dtoToAuthUser(dto));
        setProfile(dtoToProfile(dto));
      } catch {
        // Token invalid/expired and refresh failed — the api client already cleared.
        if (cancelled) return;
        setUser(null);
        setProfile(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(
    async (username: string, password: string): Promise<void> => {
      const res = await apiLogin(username, password);
      setUser(dtoToAuthUser(res.user));
      setProfile(dtoToProfile(res.user));
    },
    [],
  );

  const signOut = useCallback(async (): Promise<void> => {
    await apiLogout();
    setUser(null);
    setProfile(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export { AuthContext };
