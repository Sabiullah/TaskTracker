// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useOperationalStandupsBadge } from "@/hooks/useOperationalStandupsBadge";

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(async () => ({ count: 3 })),
  ws: { subscribe: () => () => {} },
}));

describe("useOperationalStandupsBadge", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the pending count from the API", async () => {
    const { result } = renderHook(() => useOperationalStandupsBadge());
    await waitFor(() => expect(result.current).toBe(3));
  });
});
