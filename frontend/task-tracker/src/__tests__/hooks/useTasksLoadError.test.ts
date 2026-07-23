// @vitest-environment jsdom
import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const apiGetMock = vi.fn();

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    apiGet: (...args: unknown[]) => apiGetMock(...args),
    ws: {
      subscribe: () => () => {},
    },
  };
});

import { ApiError } from "@/lib/api";
import { useTasks } from "@/hooks/useTasks";

describe("useTasks load error handling", () => {
  beforeEach(() => {
    apiGetMock.mockReset();
  });

  it("surfaces an ApiError message when the initial load fails", async () => {
    apiGetMock.mockRejectedValueOnce(
      new ApiError(0, "Failed to load page 2 of the results — some data is missing. Please retry.", null),
    );

    const { result } = renderHook(() => useTasks());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(
      "Failed to load page 2 of the results — some data is missing. Please retry.",
    );
    expect(result.current.tasks).toEqual([]);
  });

  it("clears the error and populates tasks once a retry succeeds", async () => {
    apiGetMock
      .mockRejectedValueOnce(new ApiError(0, "network error", null))
      .mockResolvedValueOnce([]);

    const { result } = renderHook(() => useTasks());

    await waitFor(() => expect(result.current.error).not.toBeNull());

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.error).toBeNull();
  });
});
