// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

let patchCalls: Array<{ url: string; body: unknown }> = [];

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

import { useMasters } from "@/hooks/useMasters";

describe("useMasters.toggleActive", () => {
  it("hydrates is_active from the DTO and defaults to true when absent", async () => {
    const { result } = renderHook(() => useMasters());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.clients).toHaveLength(1);
    expect(result.current.clients[0].is_active).toBe(true);
  });

  it("PATCHes /masters/<uid>/ with the flipped flag and updates state", async () => {
    patchCalls = [];
    const { result } = renderHook(() => useMasters());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.toggleActive(result.current.clients[0]);
    });

    expect(patchCalls).toEqual([
      { url: "/masters/client-a/", body: { is_active: false } },
    ]);
    expect(result.current.clients[0].is_active).toBe(false);

    await act(async () => {
      await result.current.toggleActive(result.current.clients[0]);
    });
    expect(patchCalls[1]).toEqual({
      url: "/masters/client-a/",
      body: { is_active: true },
    });
    expect(result.current.clients[0].is_active).toBe(true);
  });
});
