/**
 * Auth endpoint DTOs — `/api/auth/login/`, `/api/auth/logout/`,
 * `/api/auth/refresh/`, `/api/auth/me/`.
 */

import type { ProfileDto } from "./profile";

/** Body for `POST /api/auth/login/`. Django accepts either email or username in `username`. */
export interface LoginRequest {
  readonly username: string;
  readonly password: string;
}

/** JWT token pair with the authenticated user payload. */
export interface LoginResponse {
  readonly access: string;
  readonly refresh: string;
  readonly user: ProfileDto;
}

/** Body for `POST /api/auth/logout/`. */
export interface LogoutRequest {
  readonly refresh: string;
}

/** Body for `POST /api/auth/refresh/`. */
export interface RefreshRequest {
  readonly refresh: string;
}

/** Response from `POST /api/auth/refresh/` — new token pair, rotation enabled. */
export interface RefreshResponse {
  readonly access: string;
  readonly refresh: string;
}

/** Response from `GET /api/auth/me/` — same shape as the login response's `user`. */
export type MeResponse = ProfileDto;
