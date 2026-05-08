// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture the subscribe handler so the test can fire fake WS events at it.
let capturedHandler: ((evt: { event: string; record: unknown }) => void) | null = null;

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    apiGet: vi.fn(async (url: string) => {
      if (url === "/tasks/") {
        return [
          {
            id: 1,
            uid: "main-uid",
            description: "Main goal",
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

import { useTasks } from "@/hooks/useTasks";

describe("useTasks WS handler", () => {
  beforeEach(() => {
    capturedHandler = null;
    vi.clearAllMocks();
  });

  it("upserts an unknown row arriving as UPDATE (new sub from goal-tree PATCH)", async () => {
    const { result } = renderHook(() => useTasks());
    await waitFor(() => expect(result.current.tasks.length).toBe(1));
    expect(capturedHandler).not.toBeNull();

    // Simulate the backend re-broadcasting a brand-new sub row using the
    // parent's UPDATE event (see core/tasks/views.py _broadcast_tree).
    act(() => {
      capturedHandler!({
        event: "UPDATE",
        record: {
          id: 99,
          uid: "new-sub-uid",
          description: "Newly created subtask",
          client_name: "",
          category_name: "",
          responsible_name: "Alice",
          reporting_manager_name: "",
          status: "pending",
          recurrence: "Onetime",
          org: null,
          target_date: "2026-06-01",
          expected_date: null,
          completed_date: null,
          remarks: "",
          parent: "main-uid",
        },
      });
    });

    await waitFor(() => expect(result.current.tasks.length).toBe(2));
    expect(
      result.current.tasks.some((t) => t.description === "Newly created subtask"),
    ).toBe(true);
  });

  it("still updates existing rows in place on UPDATE", async () => {
    const { result } = renderHook(() => useTasks());
    await waitFor(() => expect(result.current.tasks.length).toBe(1));

    act(() => {
      capturedHandler!({
        event: "UPDATE",
        record: {
          id: 1,
          uid: "main-uid",
          description: "Main goal — edited",
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
      });
    });

    await waitFor(() =>
      expect(result.current.tasks[0].description).toBe("Main goal — edited"),
    );
    expect(result.current.tasks.length).toBe(1);
  });
});
