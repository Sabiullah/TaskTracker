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

type QueryPrimitive = string | number | boolean;

export interface RequestQuery {
  readonly [key: string]: QueryPrimitive | readonly QueryPrimitive[] | null | undefined;
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
    if (Array.isArray(v)) {
      // Multi-value param — emit as repeated keys so DRF's
      // ``request.query_params.getlist(...)`` returns each value distinctly.
      for (const item of v) {
        if (item === null || item === undefined) continue;
        params.append(k, String(item));
      }
    } else {
      params.set(k, String(v));
    }
  }
  const qs = params.toString();
  return qs ? `${url}${url.includes("?") ? "&" : "?"}${qs}` : url;
}

/** DRF emits an absolute ``next`` URL built from Django's internal host
 *  (e.g. ``http://127.0.0.1:8000/api/...?page=2``). Fetching that bypasses
 *  the SPA origin's proxy (nginx in prod, Vite in dev) and fails with
 *  CORS / DNS / mixed-content. Strip the origin and keep only path+query
 *  so the follow-up goes through the same proxy as the initial call. */
function toSameOrigin(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

/** Replace the ``page=N`` query param in a same-origin URL.
 *
 *  Used by ``apiRequest`` to derive page 2..N URLs from page 1's ``next``
 *  link so we can fetch the remaining pages concurrently instead of
 *  serially following each response's ``next`` pointer.
 *
 *  The placeholder base passed to ``URL`` is only there to satisfy the
 *  constructor for path-only inputs (``"/items/?page=2"``). We discard
 *  it before returning — the result is always path+search, same shape as
 *  ``toSameOrigin`` emits.
 */
function setPageParam(url: string, page: number): string {
  try {
    const u = new URL(url, "http://x.invalid");
    u.searchParams.set("page", String(page));
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

function isApiErrorBody(body: unknown): body is ApiErrorBody {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as { error?: unknown }).error === "string"
  );
}

/**
 * DRF's ``PageNumberPagination`` wraps list responses as
 * ``{count, next, previous, results: [...]}``. Our hooks expect a raw
 * array of rows, so we detect the envelope but return it intact — the
 * caller (``apiRequest``) decides whether to follow ``next``.
 */
interface PaginatedEnvelope {
  readonly count: number;
  readonly next: string | null;
  readonly previous: string | null;
  readonly results: unknown[];
}

function isPaginatedEnvelope(body: unknown): body is PaginatedEnvelope {
  return (
    body !== null &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    Array.isArray((body as { results?: unknown }).results) &&
    typeof (body as { count?: unknown }).count === "number" &&
    "next" in (body as object)
  );
}

async function parseBody(res: Response): Promise<unknown> {
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  const ctype = res.headers.get("content-type") ?? "";
  if (ctype.includes("application/json")) {
    try {
      // Return the raw parsed JSON — apiRequest handles pagination
      // envelopes itself so it can follow ``next`` links.
      return JSON.parse(text) as unknown;
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

  // Paginated list responses — fetch every page and flatten ``results``
  // into one array. Hooks treat list endpoints as "give me everything";
  // the previous behaviour silently returned page 1 only, which looked
  // like data was missing above 50 rows.
  //
  // Pages 2..N are fetched **in parallel** rather than walking ``next``
  // serially: on large lists (tasks/leads/attendance with thousands of
  // rows) the serial walk used to add a 20–40 round-trip latency tail to
  // every initial app load — the user saw the loading spinner for 30s+.
  // Page 1 tells us ``count`` and the page size, so the rest can fire
  // concurrently and aggregate in page order.
  if (isPaginatedEnvelope(parsed)) {
    const aggregated: unknown[] = [...parsed.results];
    const firstNext = toSameOrigin(parsed.next);
    const pageSize = parsed.results.length;
    if (firstNext && pageSize > 0 && parsed.count > pageSize) {
      const totalPages = Math.ceil(parsed.count / pageSize);
      const fetches: Promise<unknown[]>[] = [];
      for (let p = 2; p <= totalPages; p++) {
        const pageUrl = setPageParam(firstNext, p);
        fetches.push(
          fetch(pageUrl, { headers: withAuthHeaders({}) })
            .then(async (r) => {
              if (!r.ok) return [];
              const body = await parseBody(r);
              return isPaginatedEnvelope(body) ? body.results : [];
            })
            .catch(() => []),
        );
      }
      const pages = await Promise.all(fetches);
      for (const rs of pages) aggregated.push(...rs);
    }
    return aggregated as T;
  }

  return parsed as T;
}

function withAuthHeaders(init: HeadersInit): HeadersInit {
  const h = new Headers(init);
  const t = getAccessToken();
  if (t && !h.has("Authorization")) h.set("Authorization", `Bearer ${t}`);
  return h;
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

/**
 * Open an auth-gated file URL (e.g. ``/api/invoice_entries/<uid>/download/``)
 * in a new browser tab.
 *
 * We can't just ``window.open(url)`` — the new tab opens an unauthenticated
 * request and our per-resource download endpoints require ``IsAuthenticated``.
 * Instead: fetch the file with the JWT in the ``Authorization`` header,
 * turn the response body into a blob URL, and open that. The blob URL is
 * an in-memory reference scoped to our origin, so the new tab can render
 * the PDF / image without hitting the server again.
 *
 * ``fullUrl`` is the absolute URL the backend serialised onto the DTO
 * (e.g. ``InvoiceEntryDto.file_url``). It may include an external host
 * when the request came through nginx — we strip the origin and re-issue
 * the request against ``API_BASE`` so the same Authorization flow applies.
 */
export async function openAuthenticatedFile(fullUrl: string): Promise<void> {
  if (!fullUrl) return;
  // Extract the path so we can reuse the same auth/origin rules as the
  // rest of the client. URLs starting with "/" pass through unchanged.
  let path = fullUrl;
  try {
    const u = new URL(fullUrl, window.location.origin);
    path = u.pathname + u.search;
  } catch {
    /* treat as a plain path */
  }
  const headers = new Headers();
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(
    path.startsWith("http") ? path : `${API_BASE}${path.replace(/^\/api/, "")}`,
    { headers, credentials: "include" },
  );
  if (!res.ok) {
    throw new ApiError(
      res.status,
      res.status === 401
        ? "You need to sign in again."
        : `Download failed (${res.status})`,
      null,
    );
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const win = window.open(blobUrl, "_blank");
  // Firefox/Safari revoke eagerly — wait until the tab is done fetching.
  if (win) {
    win.addEventListener("beforeunload", () => URL.revokeObjectURL(blobUrl));
  } else {
    // Popup blocked — revoke after a grace period.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  }
}

export { API_BASE };
