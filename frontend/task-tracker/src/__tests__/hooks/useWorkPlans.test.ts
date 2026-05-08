// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

let capturedHandler:
  | ((evt: { event: string; record: unknown }) => void)
  | null = null;

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    apiGet: vi.fn(async (url: string) => {
      if (url === "/work_plans/") {
        return [
          {
            id: 2,
            uid: "p2",
            assigned_to: "u1",
            assigned_to_detail: { uid: "u1", full_name: "Alice" },
            created_by_detail: null,
            date: "2026-05-09",
            task_description: "Task B",
            planned_hours: "2.00",
            client: null,
            client_detail: null,
            org: null,
            sort_order: null,
          },
          {
            id: 1,
            uid: "p1",
            assigned_to: "u1",
            assigned_to_detail: { uid: "u1", full_name: "Alice" },
            created_by_detail: null,
            date: "2026-05-08",
            task_description: "Task A",
            planned_hours: "1.50",
            client: "c1",
            client_detail: { uid: "c1", name: "Acme" },
            org: null,
            sort_order: null,
          },
        ];
      }
      return [];
    }),
    ws: {
      subscribe: (
        _channel: string,
        handler: (evt: { event: string; record: unknown }) => void,
      ) => {
        capturedHandler = handler;
        return () => {
          capturedHandler = null;
        };
      },
    },
  };
});

import { useWorkPlans } from "@/hooks/useWorkPlans";

describe("useWorkPlans", () => {
  beforeEach(() => {
    capturedHandler = null;
    vi.clearAllMocks();
  });

  it("loads, maps, sorts ascending by date, and fills day name", async () => {
    const { result } = renderHook(() => useWorkPlans());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.plans).toHaveLength(2);
    expect(result.current.plans[0].date).toBe("2026-05-08");
    expect(result.current.plans[1].date).toBe("2026-05-09");
    expect(result.current.plans[0].day).toMatch(/Fri|Sat|Sun|Mon|Tue|Wed|Thu/);
    expect(result.current.plans[0].name).toBe("Alice");
    expect(result.current.plans[0].client).toBe("Acme");
  });

  it("reloads when a work-plans WS event arrives", async () => {
    const { result } = renderHook(() => useWorkPlans());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(capturedHandler).not.toBeNull();
    act(() => {
      capturedHandler!({ event: "UPDATE", record: {} });
    });
    // The mock apiGet was called once on mount + once on the WS event.
    const { apiGet } = await import("@/lib/api");
    await waitFor(() =>
      expect((apiGet as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(
        2,
      ),
    );
  });
});
