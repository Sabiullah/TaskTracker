import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import {
  ApiError,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPostForm,
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setTokens,
} from "@/lib/api/client";

const BASE = "http://api.test";

function mockJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Minimal in-memory localStorage shim for the node test environment.
class MemoryStorage {
  private store = new Map<string, string>();
  getItem = (k: string): string | null => this.store.get(k) ?? null;
  setItem = (k: string, v: string): void => {
    this.store.set(k, v);
  };
  removeItem = (k: string): void => {
    this.store.delete(k);
  };
  clear = (): void => {
    this.store.clear();
  };
  get length(): number {
    return this.store.size;
  }
  key = (i: number): string | null => [...this.store.keys()][i] ?? null;
}

let fetchSpy: MockInstance<typeof fetch>;

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
  fetchSpy = vi.spyOn(globalThis, "fetch");
  clearTokens();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("apiGet", () => {
  it("sends GET with base URL + path", async () => {
    fetchSpy.mockResolvedValueOnce(mockJsonResponse({ ok: true }));

    const result = await apiGet<{ ok: boolean }>("/tasks/", undefined);

    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toMatch(/\/tasks\/$/);
    expect(init?.method).toBe("GET");
  });

  it("encodes query params, skipping null and undefined", async () => {
    fetchSpy.mockResolvedValueOnce(mockJsonResponse([]));

    await apiGet("/tasks/", { status: "pending", page: 2, cancelled: null });

    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain("status=pending");
    expect(url).toContain("page=2");
    expect(url).not.toContain("cancelled");
  });

  it("attaches the Authorization header when an access token is set", async () => {
    setTokens("access-abc", "refresh-xyz");
    fetchSpy.mockResolvedValueOnce(mockJsonResponse({ ok: true }));

    await apiGet("/tasks/");

    const init = fetchSpy.mock.calls[0][1];
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer access-abc");
  });
});

describe("apiPost / apiPatch / apiDelete", () => {
  it("POST sends JSON body with Content-Type header", async () => {
    fetchSpy.mockResolvedValueOnce(mockJsonResponse({ id: 1 }));

    await apiPost("/tasks/", { description: "hello" });

    const init = fetchSpy.mock.calls[0][1];
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Content-Type")).toBe(
      "application/json",
    );
    expect(init?.body).toBe(JSON.stringify({ description: "hello" }));
  });

  it("PATCH sends a partial body", async () => {
    fetchSpy.mockResolvedValueOnce(mockJsonResponse({ id: 1 }));

    await apiPatch("/tasks/abc/", { status: "completed" });

    expect(fetchSpy.mock.calls[0][1]?.method).toBe("PATCH");
  });

  it("DELETE returns nothing on 204", async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(apiDelete("/tasks/abc/")).resolves.toBeUndefined();
  });
});

describe("apiPostForm", () => {
  it("sends FormData without a Content-Type header", async () => {
    fetchSpy.mockResolvedValueOnce(mockJsonResponse({ ok: true }));

    const form = new FormData();
    form.append("file", new Blob(["hi"], { type: "text/plain" }), "a.txt");

    await apiPostForm("/upload/", form);

    const init = fetchSpy.mock.calls[0][1];
    expect(new Headers(init?.headers).get("Content-Type")).toBeNull();
    expect(init?.body).toBe(form);
  });
});

describe("error handling", () => {
  it("throws ApiError with server-provided message on 400", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockJsonResponse({ error: "bad-request" }, 400),
    );

    await expect(apiGet("/tasks/")).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      message: "bad-request",
    });
  });

  it("ApiError falls back to HTTP status text when body has no error field", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("", { status: 500 }));

    try {
      await apiGet("/tasks/");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(500);
    }
  });

  it("surfaces DRF `detail` errors (raise ValidationError / PermissionDenied)", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockJsonResponse({ detail: "Cannot approve a Approved request" }, 400),
    );

    await expect(apiPost("/leave-requests/x/approve/", {})).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      message: "Cannot approve a Approved request",
    });
  });

  it("folds `dates` into the message for conflict-on-date payloads", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockJsonResponse(
        { detail: "conflict-on-date", dates: ["2026-05-22", "2026-05-23"] },
        400,
      ),
    );

    await expect(apiPost("/leave-requests/x/approve/", {})).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      message: "conflict-on-date: 2026-05-22, 2026-05-23",
    });
  });

  it("surfaces DRF serializer field errors", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockJsonResponse({ reason: ["Required when rejecting"] }, 400),
    );

    await expect(apiPost("/leave-requests/x/reject/", {})).rejects.toMatchObject({
      message: "reason: Required when rejecting",
    });
  });
});

describe("401 refresh flow", () => {
  it("refreshes once on 401 then retries the original request", async () => {
    setTokens("stale-access", "good-refresh");

    fetchSpy
      .mockResolvedValueOnce(
        mockJsonResponse({ error: "expired" }, 401), // original /tasks/
      )
      .mockResolvedValueOnce(
        mockJsonResponse(
          { access: "new-access", refresh: "new-refresh" },
          200,
        ), // /auth/refresh/
      )
      .mockResolvedValueOnce(mockJsonResponse([{ id: 1 }])); // retried /tasks/

    const result = await apiGet<{ id: number }[]>("/tasks/");

    expect(result).toEqual([{ id: 1 }]);
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    // The retry uses the fresh access token.
    const retryInit = fetchSpy.mock.calls[2][1];
    expect(new Headers(retryInit?.headers).get("Authorization")).toBe(
      "Bearer new-access",
    );
    expect(getAccessToken()).toBe("new-access");
    expect(getRefreshToken()).toBe("new-refresh");
  });

  it("clears tokens when refresh fails", async () => {
    setTokens("stale-access", "bad-refresh");

    fetchSpy
      .mockResolvedValueOnce(mockJsonResponse({ error: "expired" }, 401))
      .mockResolvedValueOnce(
        mockJsonResponse({ error: "invalid-refresh" }, 401),
      );

    await expect(apiGet("/tasks/")).rejects.toBeInstanceOf(ApiError);
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  it("does not try to refresh on /auth/login/ itself", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockJsonResponse({ error: "invalid-credentials" }, 401),
    );

    await expect(
      apiPost("/auth/login/", { username: "a", password: "b" }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("paginated list responses", () => {
  it("fetches remaining pages in parallel and flattens results", async () => {
    // Page 1 lands serially (it's the initial request); pages 2..3 fire
    // concurrently after that. Each row carries its page index so we can
    // assert the final aggregated order.
    fetchSpy
      .mockResolvedValueOnce(
        mockJsonResponse({
          count: 7,
          next: "http://api.test/items/?page=2",
          previous: null,
          results: [{ p: 1, i: 0 }, { p: 1, i: 1 }, { p: 1, i: 2 }],
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          count: 7,
          next: "http://api.test/items/?page=3",
          previous: "http://api.test/items/?page=1",
          results: [{ p: 2, i: 0 }, { p: 2, i: 1 }, { p: 2, i: 2 }],
        }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          count: 7,
          next: null,
          previous: "http://api.test/items/?page=2",
          results: [{ p: 3, i: 0 }],
        }),
      );

    const rows = await apiGet<Array<{ p: number; i: number }>>("/items/");

    // 1 initial + 2 parallel page fetches.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    // Aggregated in page order.
    expect(rows.map((r) => r.p)).toEqual([1, 1, 1, 2, 2, 2, 3]);

    // Pages 2 and 3 should target page=2 and page=3 respectively, derived
    // from page 1's ``next`` (not from each previous page's ``next``).
    const urls = fetchSpy.mock.calls.slice(1).map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("page=2"))).toBe(true);
    expect(urls.some((u) => u.includes("page=3"))).toBe(true);
  });

  it("returns page 1 alone when count fits in a single page", async () => {
    fetchSpy.mockResolvedValueOnce(
      mockJsonResponse({
        count: 2,
        next: null,
        previous: null,
        results: [{ id: 1 }, { id: 2 }],
      }),
    );

    const rows = await apiGet<Array<{ id: number }>>("/items/");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("retries a page once after a network error and still aggregates it", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        mockJsonResponse({
          count: 4,
          next: "http://api.test/items/?page=2",
          previous: null,
          results: [{ id: 1 }, { id: 2 }],
        }),
      )
      // Page 2 first attempt: network error.
      .mockRejectedValueOnce(new TypeError("network error"))
      // Page 2 retry: succeeds.
      .mockResolvedValueOnce(
        mockJsonResponse({
          count: 4,
          next: null,
          previous: "http://api.test/items/?page=1",
          results: [{ id: 3 }, { id: 4 }],
        }),
      );

    const rows = await apiGet<Array<{ id: number }>>("/items/");

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
  });

  it("throws instead of silently dropping rows when a page fails twice", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        mockJsonResponse({
          count: 4,
          next: "http://api.test/items/?page=2",
          previous: null,
          results: [{ id: 1 }, { id: 2 }],
        }),
      )
      // Page 2 fails on both the initial attempt and the retry.
      .mockRejectedValueOnce(new TypeError("network error"))
      .mockRejectedValueOnce(new TypeError("network error"));

    await expect(
      apiGet<Array<{ id: number }>>("/items/"),
    ).rejects.toBeInstanceOf(ApiError);

    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});

describe("token storage", () => {
  it("round-trips set / get / clear", () => {
    expect(getAccessToken()).toBeNull();

    setTokens("A", "R");
    expect(getAccessToken()).toBe("A");
    expect(getRefreshToken()).toBe("R");

    clearTokens();
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });
});

// Reference to unused variable to satisfy no-unused-vars during TS check.
void BASE;
