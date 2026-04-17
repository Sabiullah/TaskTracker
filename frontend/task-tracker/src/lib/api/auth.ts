import type {
  LoginRequest,
  LoginResponse,
  MeResponse,
} from "@/types/api";
import {
  apiPost,
  apiGet,
  clearTokens,
  getRefreshToken,
  setTokens,
} from "./client";

/** POST /api/auth/login/ — stores access + refresh tokens on success. */
export async function login(
  username: string,
  password: string,
): Promise<LoginResponse> {
  const body: LoginRequest = { username, password };
  const res = await apiPost<LoginResponse>("/auth/login/", body);
  setTokens(res.access, res.refresh);
  return res;
}

/**
 * POST /api/auth/logout/ — blacklists the refresh token server-side and
 * clears local storage. Never throws; logout is best-effort.
 */
export async function logout(): Promise<void> {
  const refresh = getRefreshToken();
  if (refresh) {
    try {
      await apiPost("/auth/logout/", { refresh });
    } catch {
      /* swallow — we clear local state regardless */
    }
  }
  clearTokens();
}

/** GET /api/auth/me/ — hydrate the current user on app load. */
export function me(): Promise<MeResponse> {
  return apiGet<MeResponse>("/auth/me/");
}
