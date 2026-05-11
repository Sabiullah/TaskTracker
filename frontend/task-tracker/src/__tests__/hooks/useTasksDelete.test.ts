// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

let deleteMock = vi.fn();

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    apiGet: vi.fn(async (url: string) => {
      if (url === "/tasks/") {
        return [
          {
            id: 1,
            uid: "ghost-uid",
            description: "Already-deleted on server",
            client_name: "",
            category_name: "",
            responsible_name: "",
            reporting_manager_name: "",
            status: "pending",
            recurrence: "Onetime",
            org: null,
            target_date: null,
            expected_date: null,
            completed_date: null,
            remarks: "",
            parent: null,
          },
          {
            id: 2,
            uid: "live-uid",
            description: "Still exists",
            client_name: "",
            category_name: "",
            responsible_name: "",
            reporting_manager_name: "",
            status: "pending",
            recurrence: "Onetime",
            org: null,
            target_date: null,
            expected_date: null,
            completed_date: null,
            remarks: "",
            parent: null,
          },
        ];
      }
      return [];
    }),
    apiDelete: (...args: unknown[]) => deleteMock(...args),
    ws: {
      subscribe: () => () => undefined,
    },
  };
});

import { useTasks } from "@/hooks/useTasks";
import { ApiError } from "@/lib/api";

describe("useTasks deleteTask", () => {
  beforeEach(() => {
    deleteMock = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => undefined);
  });

  it("drops the row from local state when the server returns 404 (ghost card)", async () => {
    // Simulate the production scenario: local state has a task that no
    // longer exists server-side (parallel deleter / capped plan / missed
    // WS broadcast). The DELETE 404s; the hook should clean up locally
    // rather than alerting and leaving the ghost card stuck.
    deleteMock.mockRejectedValueOnce(new ApiError(404, "HTTP 404 Not Found", null));

    const { result } = renderHook(() => useTasks());
    await waitFor(() => expect(result.current.tasks.length).toBe(2));

    await act(async () => {
      await result.current.deleteTask("ghost-uid");
    });

    expect(result.current.tasks.map((t) => t.id)).toEqual(["live-uid"]);
    // 404 is treated as success-equivalent — no alert spam.
    expect((window.alert as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("optimistically removes the row on a successful DELETE", async () => {
    // WS DELETE arrival is best-effort; the user shouldn't have to wait
    // for a broadcast (or refresh the page) to see their click take effect.
    deleteMock.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useTasks());
    await waitFor(() => expect(result.current.tasks.length).toBe(2));

    await act(async () => {
      await result.current.deleteTask("live-uid");
    });

    expect(result.current.tasks.map((t) => t.id)).toEqual(["ghost-uid"]);
  });

  it("still alerts on non-404 failures so real errors aren't silently swallowed", async () => {
    deleteMock.mockRejectedValueOnce(new ApiError(500, "HTTP 500 Server Error", null));

    const { result } = renderHook(() => useTasks());
    await waitFor(() => expect(result.current.tasks.length).toBe(2));

    await act(async () => {
      await result.current.deleteTask("live-uid");
    });

    // Row stays — a 500 doesn't prove the row is gone, so we keep it visible
    // and surface the error to the user.
    expect(result.current.tasks.map((t) => t.id).sort()).toEqual(["ghost-uid", "live-uid"]);
    expect(window.alert).toHaveBeenCalled();
  });
});
