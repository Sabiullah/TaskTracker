// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useCosting } from "@/hooks/useCosting";
import * as costingApi from "@/lib/api/costing";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, ws: { subscribe: vi.fn(() => () => {}) } };
});

describe("useCosting", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("loads entries for the given client", async () => {
    vi.spyOn(costingApi, "listCostingEntries").mockResolvedValue([
      {
        id: 1,
        uid: "e1",
        org: "o1",
        org_name: "Acme Org",
        client: "c1",
        client_detail: { id: 1, uid: "c1", name: "Acme", type: "client", color: "" },
        designation: "d1",
        designation_detail: { id: 1, uid: "d1", name: "Analyst", type: "designation", color: "" },
        employee: null,
        employee_detail: null,
        hr_day: "8.00",
        days_working: "22.00",
        total: "30.00",
        created_by_uid: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);
    const { result } = renderHook(() => useCosting("c1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].total).toBe("30.00");
  });

  it("creates an entry and appends it to state", async () => {
    vi.spyOn(costingApi, "listCostingEntries").mockResolvedValue([]);
    const created = {
      id: 2,
      uid: "e2",
      org: "o1",
      org_name: "Acme Org",
      client: "c1",
      client_detail: null,
      designation: "d1",
      designation_detail: null,
      employee: null,
      employee_detail: null,
      hr_day: "6.00",
      days_working: "10.00",
      total: "16.00",
      created_by_uid: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    vi.spyOn(costingApi, "createCostingEntry").mockResolvedValue(created);
    const { result } = renderHook(() => useCosting("c1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.createEntry({ client: "c1", designation: "d1", hr_day: 6, days_working: 10 });
    });
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].uid).toBe("e2");
  });
});
