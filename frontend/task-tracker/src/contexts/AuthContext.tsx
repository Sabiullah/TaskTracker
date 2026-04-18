import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  AccessFeature,
  AuthContextValue,
  AuthUser,
  OrgPk,
  Profile,
  ProfileOrg,
  Role,
} from "@/types";
import type { Uid } from "@/types/api";
import {
  dtoToAuthUser,
  dtoToProfile,
  getAccessToken,
  login as apiLogin,
  logout as apiLogout,
  me as apiMe,
} from "@/lib/api";
import { findMembership, pickDefaultOrg } from "./authHelpers";

const AuthContext = createContext<AuthContextValue | null>(null);

// ─── Provider ────────────────────────────────────────────────────────────────

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

  // ── Derived helpers, memoised on profile ─────────────────────────────────
  // All helpers read from `profile` only, so recomputing when it changes
  // keeps them referentially stable for downstream deps arrays.
  const helpers = useMemo(() => {
    const orgs = profile?.orgs ?? [];
    const defaultOrg = pickDefaultOrg(profile);
    const highestRole: Role | null = profile?.highest_role ?? null;

    const roleIn = (
      org: OrgPk | Uid | ProfileOrg | null | undefined,
    ): Role | null => {
      const m = findMembership(profile, org);
      return m ? m.role : null;
    };

    const isAdminIn = (org: OrgPk | Uid | ProfileOrg | null | undefined) =>
      roleIn(org) === "admin";

    const isManagerIn = (org: OrgPk | Uid | ProfileOrg | null | undefined) => {
      const r = roleIn(org);
      return r === "admin" || r === "manager";
    };

    const hasAccessIn = (
      feature: AccessFeature,
      org: OrgPk | Uid | ProfileOrg | null | undefined,
    ): boolean => {
      const m = findMembership(profile, org);
      return !!m && (m[feature] as boolean);
    };

    const isAdminInAny = () => orgs.some((o) => o.role === "admin");
    const isManagerInAny = () =>
      orgs.some((o) => o.role === "admin" || o.role === "manager");
    const hasAccessInAny = (feature: AccessFeature) =>
      orgs.some((o) => o[feature]);

    return {
      orgs,
      defaultOrg,
      highestRole,
      roleIn,
      isAdminIn,
      isManagerIn,
      hasAccessIn,
      isAdminInAny,
      isManagerInAny,
      hasAccessInAny,
    };
  }, [profile]);

  const value: AuthContextValue = {
    user,
    profile,
    loading,
    signIn,
    signOut,
    ...helpers,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export { AuthContext };
