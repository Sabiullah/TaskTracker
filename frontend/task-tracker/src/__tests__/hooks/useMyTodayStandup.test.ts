// @vitest-environment jsdom
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OperationalStandupDto, OperationalStandupRosterRow } from "@/types/api";

let capturedHandler: ((evt: { event: string; record: unknown }) => void) | null = null;
const apiGetMock = vi.fn();

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    apiGet: (url: string) => apiGetMock(url),
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

import { useMyTodayStandup } from "@/hooks/useMyTodayStandup";

function makeEntry(overrides: Partial<OperationalStandupDto> = {}): OperationalStandupDto {
  return {
    id: 1,
    uid: "e1",
    org_uid: "o1",
    profile: "p1",
    profile_detail: { id: 1, uid: "p1", full_name: "Alice", username: "alice" },
    standup_date: "2026-05-15",
    breakthrough_type: "" as const,
    priorities: "ship it",
    collaboration_need: "",
    remarks: "",
    status: "Pending" as const,
    created_by_detail: null,
    approved_by_detail: null,
    approved_at: null,
    reviewed_by_detail: null,
    reviewed_at: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function makeRow(overrides: Partial<OperationalStandupRosterRow> = {}): OperationalStandupRosterRow {
  return {
    profile: { id: 1, uid: "p1", full_name: "Alice", username: "alice" },
    org_uid: "o1",
    org_name: "4D",
    entry: null,
    can_edit: true,
    can_approve: false,
    ...overrides,
  };
}

describe("useMyTodayStandup", () => {
  beforeEach(() => {
    capturedHandler = null;
    apiGetMock.mockReset();
  });

  it("returns null entry when profileId is null and does not fetch", async () => {
    const { result } = renderHook(() => useMyTodayStandup(null));
    expect(result.current.entry).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(apiGetMock).not.toHaveBeenCalled();
  });

  it("returns null when no roster row matches the profileId", async () => {
    apiGetMock.mockResolvedValue([
      makeRow({ profile: { id: 2, uid: "other", full_name: "Bob", username: "bob" } }),
    ]);
    const { result } = renderHook(() => useMyTodayStandup("p1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entry).toBeNull();
  });

  it("returns the entry from the matching roster row", async () => {
    const entry = makeEntry({ priorities: "do the thing" });
    apiGetMock.mockResolvedValue([makeRow({ entry })]);
    const { result } = renderHook(() => useMyTodayStandup("p1"));
    await waitFor(() => expect(result.current.entry?.priorities).toBe("do the thing"));
  });

  it("picks the Approved row when the same user has multiple rows across orgs", async () => {
    apiGetMock.mockResolvedValue([
      makeRow({ org_uid: "o1", entry: makeEntry({ uid: "pending-1", status: "Pending" }) }),
      makeRow({ org_uid: "o2", entry: makeEntry({ uid: "approved-1", status: "Approved" }) }),
      makeRow({ org_uid: "o3", entry: null }),
    ]);
    const { result } = renderHook(() => useMyTodayStandup("p1"));
    await waitFor(() => expect(result.current.entry?.uid).toBe("approved-1"));
  });

  it("re-fetches when a WS message arrives on pace-operational-standups", async () => {
    apiGetMock.mockResolvedValueOnce([makeRow({ entry: makeEntry({ priorities: "first" }) })]);
    const { result } = renderHook(() => useMyTodayStandup("p1"));
    await waitFor(() => expect(result.current.entry?.priorities).toBe("first"));

    apiGetMock.mockResolvedValueOnce([makeRow({ entry: makeEntry({ priorities: "second" }) })]);
    act(() => {
      capturedHandler?.({ event: "UPDATE", record: makeEntry({ profile: "p1" }) });
    });
    await waitFor(() => expect(result.current.entry?.priorities).toBe("second"));
  });
});
