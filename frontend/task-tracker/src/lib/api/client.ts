import type { ApiErrorBody } from "@/types/api";

/** Base URL (no trailing slash) for every Django REST call.
 *
 * Defaults to a relative `/api` so the build is host-agnostic — whatever
 * origin serves the SPA is the same origin that serves the API (nginx
 * proxies `/api/*` in prod, Vite proxies `/api/*` in dev). Override via
 * VITE_API_BASE_URL at build time only if the API lives on a different
 * origin (e.g. `https://api.example.com`).
 */
const API_BASE: string = (
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "/api"
).replace(/\/$/, "");

const ACCESS_KEY = "tt_access_token";
const REFRESH_KEY = "tt_refresh_token";

/** Thrown for every non-2xx response. Carries the server's parsed body. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

// ─── Token storage ───────────────────────────────────────────────────────────

export function getAccessToken(): string | null {
  try {
    return localStorage.getItem(ACCESS_KEY);
  } catch {
    return null;
  }
}

export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

export function setTokens(access: string, refresh: string): void {
  try {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  } catch {
    /* storage quota / private mode */
  }
}

export function clearTokens(): void {
  try {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  } catch {
    /* ignore */
  }
}

// ─── Request primitives ──────────────────────────────────────────────────────

export interface RequestQuery {
  readonly [key: string]: string | number | boolean | null | undefined;
}

export interface RequestOptions {
  readonly method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** JSON-serialisable body. Ignored if `form` is set. */
  readonly body?: unknown;
  /** Multipart body (file uploads). Takes precedence over `body`. */
  readonly form?: FormData;
  /** Query params appended to the URL. `null` / `undefined` values skipped. */
  readonly query?: RequestQuery;
  /** Extra headers merged over the defaults. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Override base URL (tests only). */
  readonly baseUrl?: string;
}

function buildUrl(base: string, path: string, query?: RequestQuery): string {
  const url = `${base}${path.startsWith("/") ? "" : "/"}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === null || v === undefined) continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${url}${url.includes("?") ? "&" : "?"}${qs}` : url;
}

function isApiErrorBody(body: unknown): body is ApiErrorBody {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as { error?: unknown }).error === "string"
  );
}

/**
 * DRF's PageNumberPagination wraps list responses as
 * `{count, next, previous, results: [...]}`. Our hooks expect raw arrays,
 * so we transparently unwrap here. Any non-list response is returned as-is.
 */
function unwrapPaginated(body: unknown): unknown {
  if (
    body !== null &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    Array.isArray((body as { results?: unknown }).results) &&
    typeof (body as { count?: unknown }).count === "number"
  ) {
    return (body as { results: unknown[] }).results;
  }
  return body;
}

async function parseBody(res: Response): Promise<unknown> {
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  const ctype = res.headers.get("content-type") ?? "";
  if (ctype.includes("application/json")) {
    try {
      return unwrapPaginated(JSON.parse(text) as unknown);
    } catch {
      return text;
    }
  }
  return text;
}

async function sendOnce(
  base: string,
  path: string,
  opts: RequestOptions,
): Promise<Response> {
  const url = buildUrl(base, path, opts.query);
  const headers = new Headers(opts.headers ?? {});
  const token = getAccessToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let body: BodyInit | undefined;
  if (opts.form) {
    body = opts.form;
    // Let the browser set multipart Content-Type with boundary.
  } else if (opts.body !== undefined) {
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    body = JSON.stringify(opts.body);
  }

  return fetch(url, {
    method: opts.method ?? "GET",
    headers,
    body,
  });
}

// Single-flight refresh — a parallel burst of 401s triggers at most one refresh.
let refreshInFlight: Promise<boolean> | null = null;

async function tryRefresh(base: string): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async (): Promise<boolean> => {
    try {
      const refresh = getRefreshToken();
      if (!refresh) return false;

      const res = await fetch(buildUrl(base, "/auth/refresh/"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh }),
      });
      if (!res.ok) return false;

      const parsed = (await parseBody(res)) as
        | { access?: unknown; refresh?: unknown }
        | null;
      if (
        !parsed ||
        typeof parsed.access !== "string" ||
        typeof parsed.refresh !== "string"
      ) {
        return false;
      }
      setTokens(parsed.access, parsed.refresh);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/**
 * Low-level request function. Throws `ApiError` on non-2xx responses.
 * Handles token refresh on 401 with a single retry.
 */
export async function apiRequest<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const base = opts.baseUrl ?? API_BASE;
  const skipRefresh =
    path.startsWith("/auth/refresh") || path.startsWith("/auth/login");

  let res = await sendOnce(base, path, opts);

  if (res.status === 401 && !skipRefresh) {
    const refreshed = await tryRefresh(base);
    if (refreshed) {
      res = await sendOnce(base, path, opts);
    } else {
      clearTokens();
    }
  }

  const parsed = await parseBody(res);
  if (!res.ok) {
    const message = isApiErrorBody(parsed)
      ? parsed.error
      : `HTTP ${res.status} ${res.statusText}`;
    throw new ApiError(res.status, message, parsed);
  }
  return parsed as T;
}

// ─── Method helpers ──────────────────────────────────────────────────────────

export function apiGet<T>(path: string, query?: RequestQuery): Promise<T> {
  return apiRequest<T>(path, { method: "GET", query });
}

export function apiPost<T>(
  path: string,
  body?: unknown,
  query?: RequestQuery,
): Promise<T> {
  return apiRequest<T>(path, { method: "POST", body, query });
}

export function apiPatch<T>(
  path: string,
  body?: unknown,
  query?: RequestQuery,
): Promise<T> {
  return apiRequest<T>(path, { method: "PATCH", body, query });
}

export function apiPut<T>(
  path: string,
  body?: unknown,
  query?: RequestQuery,
): Promise<T> {
  return apiRequest<T>(path, { method: "PUT", body, query });
}

export async function apiDelete(
  path: string,
  query?: RequestQuery,
): Promise<void> {
  await apiRequest<unknown>(path, { method: "DELETE", query });
}

/** Multipart POST — use for file uploads. */
export function apiPostForm<T>(
  path: string,
  form: FormData,
  query?: RequestQuery,
): Promise<T> {
  return apiRequest<T>(path, { method: "POST", form, query });
}

/** Multipart PATCH — used by `/api/employees/<uid>/` address-proof upload. */
export function apiPatchForm<T>(
  path: string,
  form: FormData,
  query?: RequestQuery,
): Promise<T> {
  return apiRequest<T>(path, { method: "PATCH", form, query });
}

export { API_BASE };
