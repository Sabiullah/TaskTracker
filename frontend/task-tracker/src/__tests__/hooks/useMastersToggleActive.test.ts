// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const patchCalls: Array<{ url: string; body: unknown }> = [];

beforeEach(() => {
  patchCalls.length = 0;
});

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    apiGet: vi.fn(async (url: string) => {
      if (url === "/masters/") {
        return [
          {
            id: 1,
            uid: "client-a",
            name: "Acme",
            type: "client",
            color: "",
            is_active: true,
            sort_order: 0,
            org: null,
            org_uid: null,
            orgs: [],
            parent: null,
            recurrence: "",
            target_day: null,
            created_by_uid: null,
            created_at: "",
            updated_at: "",
          },
          {
            // Intentionally omits is_active to exercise the
            // ?? true back-compat branch in dtoToMasterItem.
            id: 2,
            uid: "client-b",
            name: "Beta",
            type: "client",
            color: "",
            sort_order: 0,
            org: null,
            org_uid: null,
            orgs: [],
            parent: null,
            recurrence: "",
            target_day: null,
            created_by_uid: null,
            created_at: "",
            updated_at: "",
          },
        ];
      }
      return [];
    }),
    apiPost: vi.fn(),
    apiPatch: vi.fn(async (url: string, body: unknown) => {
      patchCalls.push({ url, body });
      return {
        id: 1,
        uid: "client-a",
        name: "Acme",
        type: "client",
        color: "",
        is_active: (body as { is_active: boolean }).is_active,
        sort_order: 0,
        org: null,
        org_uid: null,
        orgs: [],
        parent: null,
        recurrence: "",
        target_day: null,
        created_by_uid: null,
        created_at: "",
        updated_at: "",
      };
    }),
    apiDelete: vi.fn(),
    ws: { subscribe: () => () => undefined },
  };
});

// useMasters must be imported AFTER vi.mock so the module factory
// (above) is already registered when the hook resolves its
// "@/lib/api" dep.
import { useMasters } from "@/hooks/useMasters";

describe("useMasters.toggleActive", () => {
  it("hydrates is_active from the DTO and defaults to true when absent", async () => {
    const { result } = renderHook(() => useMasters());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.clients).toHaveLength(2);
    const byUid = Object.fromEntries(
      result.current.clients.map((c) => [c.id, c]),
    );
    expect(byUid["client-a"].is_active).toBe(true);
    // client-b's DTO omitted is_active; the ?? true fallback should
    // hydrate it as active.
    expect(byUid["client-b"].is_active).toBe(true);
  });

  it("PATCHes /masters/<uid>/ with the flipped flag and updates state", async () => {
    const { result } = renderHook(() => useMasters());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const acme = result.current.clients.find((c) => c.id === "client-a");
    expect(acme).toBeDefined();

    await act(async () => {
      await result.current.toggleActive(acme!);
    });

    expect(patchCalls).toEqual([
      { url: "/masters/client-a/", body: { is_active: false } },
    ]);
    const after1 = result.current.clients.find((c) => c.id === "client-a");
    expect(after1?.is_active).toBe(false);

    await act(async () => {
      await result.current.toggleActive(after1!);
    });
    expect(patchCalls[1]).toEqual({
      url: "/masters/client-a/",
      body: { is_active: true },
    });
    const after2 = result.current.clients.find((c) => c.id === "client-a");
    expect(after2?.is_active).toBe(true);
  });
});
