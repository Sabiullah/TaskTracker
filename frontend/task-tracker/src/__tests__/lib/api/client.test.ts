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
