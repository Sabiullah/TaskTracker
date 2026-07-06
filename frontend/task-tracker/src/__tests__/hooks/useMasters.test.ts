// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
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
            uid: "1",
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
            id: 2,
            uid: "2",
            name: "Team Lead",
            type: "designation",
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
    apiPatch: vi.fn(),
    apiDelete: vi.fn(),
    ws: { subscribe: () => () => undefined },
  };
});

// useMasters must be imported AFTER vi.mock so the module factory
// (above) is already registered when the hook resolves its
// "@/lib/api" dep.
import { useMasters } from "@/hooks/useMasters";

describe("useMasters designations", () => {
  it("splits designation-type rows into a separate `designations` list", async () => {
    const { result } = renderHook(() => useMasters());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.designations).toHaveLength(1);
    expect(result.current.designations[0].name).toBe("Team Lead");
    expect(result.current.clients).toHaveLength(1);
  });
});
