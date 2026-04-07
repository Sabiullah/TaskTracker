import type { DbTaskRow, Task, DbTaskInsert } from "@/types/task";

const BASE = "/api";

// ── Token storage ─────────────────────────────────────────────────────────────

export function getAccessToken() {
  return localStorage.getItem("tt_access");
}
export function getRefreshToken() {
  return localStorage.getItem("tt_refresh");
}
export function setTokens(access: string, refresh: string) {
  localStorage.setItem("tt_access", access);
  localStorage.setItem("tt_refresh", refresh);
}
export function clearTokens() {
  localStorage.removeItem("tt_access");
  localStorage.removeItem("tt_refresh");
}

// ── Base fetch with auto token refresh ───────────────────────────────────────

export async function apiFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) ?? {}),
  };
  const token = getAccessToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res = await fetch(`${BASE}${path}`, { ...options, headers });

  // Try refresh once on 401
  if (res.status === 401) {
    const refresh = getRefreshToken();
    if (refresh) {
      const r = await fetch(`${BASE}/auth/refresh/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh }),
      });
      if (r.ok) {
        const { access } = await r.json();
        localStorage.setItem("tt_access", access);
        headers["Authorization"] = `Bearer ${access}`;
        res = await fetch(`${BASE}${path}`, { ...options, headers });
      } else {
        clearTokens();
      }
    }
  }
  return res;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await apiFetch(path);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function apiDelete(path: string): Promise<void> {
  const res = await apiFetch(path, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
}

// ── Task converters — Task type now matches API directly, kept for compat ─────

export function dbToTask(row: DbTaskRow): Task {
  return { ...row, id: String(row.id) };
}

export function taskToDb(task: Task): DbTaskInsert {
  const { id, created_by, created_at, updated_at, ...rest } = task;
  void id;
  void created_by;
  void created_at;
  void updated_at;
  return rest;
}
