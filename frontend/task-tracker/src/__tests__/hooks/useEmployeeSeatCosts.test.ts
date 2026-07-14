// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useEmployeeSeatCosts } from "@/hooks/useEmployeeSeatCosts";
import * as seatCostApi from "@/lib/api/seatCost";

describe("useEmployeeSeatCosts", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("loads existing overrides", async () => {
    vi.spyOn(seatCostApi, "listEmployeeSeatCosts").mockResolvedValue([
      {
        id: 1,
        uid: "e1",
        employee: "emp1",
        employee_detail: { id: 1, uid: "emp1", employee_name: "Priya" },
        monthly_amount: "7000.00",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);
    const { result } = renderHook(() => useEmployeeSeatCosts());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.entries).toHaveLength(1);
  });

  it("creates an override and appends it to state", async () => {
    vi.spyOn(seatCostApi, "listEmployeeSeatCosts").mockResolvedValue([]);
    const created = {
      id: 2,
      uid: "e2",
      employee: "emp2",
      employee_detail: { id: 2, uid: "emp2", employee_name: "Rahul" },
      monthly_amount: "8000.00",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    vi.spyOn(seatCostApi, "createEmployeeSeatCost").mockResolvedValue(created);
    const { result } = renderHook(() => useEmployeeSeatCosts());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.createEntry({ employee: "emp2", monthly_amount: 8000 });
    });
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].uid).toBe("e2");
  });
});
