// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

let patchMock = vi.fn();

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    apiGet: vi.fn(async (url: string) => {
      if (url === "/tasks/") {
        return [
          {
            id: 2,
            uid: "sub-uid",
            description: "P&L Data Collection - Sales",
            status: "pending",
            recurrence: "Onetime",
            org: null,
            target_date: "2026-06-02",
            expected_date: null,
            completed_date: null,
            remarks: "",
            parent: "main-uid",
          },
        ];
      }
      return [];
    }),
    apiPatch: (...args: unknown[]) => patchMock(...args),
    ws: {
      subscribe: () => () => undefined,
    },
  };
});

import { useTasks } from "@/hooks/useTasks";

describe("useTasks patchTask", () => {
  beforeEach(() => {
    patchMock = vi.fn();
    vi.spyOn(window, "alert").mockImplementation(() => undefined);
  });

  it("optimistically updates the row from the PATCH response without waiting for a WS broadcast", async () => {
    // The dashboard drill modal sets completed_date on a normal user's
    // subtask. The server persists it and returns the updated row. The WS
    // UPDATE broadcast is best-effort (Redis may be down / not configured),
    // so the hook must reflect the change in local state immediately —
    // otherwise reopening the drill reads stale state and the task still
    // shows as Overdue/Pending even though the save succeeded.
    patchMock.mockResolvedValueOnce({
      id: 2,
      uid: "sub-uid",
      description: "P&L Data Collection - Sales",
      status: "completed_delay",
      recurrence: "Onetime",
      org: null,
      target_date: "2026-06-02",
      expected_date: null,
      completed_date: "2026-06-04",
      remarks: "",
      parent: "main-uid",
    });

    const { result } = renderHook(() => useTasks());
    await waitFor(() => expect(result.current.tasks.length).toBe(1));
    expect(result.current.tasks[0].completedDate).toBeFalsy();

    await act(async () => {
      await result.current.patchTask("sub-uid", { completedDate: "2026-06-04" });
    });

    const row = result.current.tasks.find((t) => t.id === "sub-uid");
    expect(row?.completedDate).toBe("2026-06-04");
    // Status is derived from dates client-side — comp date after target = delay.
    expect(row?.status).toBe("Completed Delay");
  });
});
