// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useOperationalStandups } from "@/hooks/useOperationalStandups";

vi.mock("@/lib/api", () => ({
  apiGet: vi.fn(async (url: string) => {
    if (url.startsWith("/operational_standups/?month=")) {
      return [{ id: 1, uid: "u1", standup_date: "2026-05-04" }];
    }
    if (url.startsWith("/operational_standups/roster/")) {
      return [
        {
          profile: { uid: "p1", full_name: "Alice", email: "" },
          entry: null,
          can_edit: true,
          can_approve: false,
          org_uid: "o",
          org_name: "4D",
        },
      ];
    }
    return [];
  }),
  ws: { subscribe: () => () => {} },
}));

describe("useOperationalStandups", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads month entries on mount", async () => {
    const { result } = renderHook(() =>
      useOperationalStandups({ month: "2026-05" }),
    );
    await waitFor(() => expect(result.current.standups.length).toBe(1));
  });

  it("loads roster for a date when requested", async () => {
    const { result } = renderHook(() =>
      useOperationalStandups({ month: "2026-05", rosterDate: "2026-05-04" }),
    );
    await waitFor(() => expect(result.current.roster.length).toBe(1));
  });
});
