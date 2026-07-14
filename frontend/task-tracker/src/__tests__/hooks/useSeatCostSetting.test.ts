// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useSeatCostSetting } from "@/hooks/useSeatCostSetting";
import * as seatCostApi from "@/lib/api/seatCost";

describe("useSeatCostSetting", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("loads the org's existing setting", async () => {
    vi.spyOn(seatCostApi, "listSeatCostSettings").mockResolvedValue([
      {
        id: 1,
        uid: "s1",
        org: "o1",
        org_name: "Acme Org",
        monthly_amount: "5000.00",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);
    const { result } = renderHook(() => useSeatCostSetting("o1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.setting?.monthly_amount).toBe("5000.00");
  });

  it("creates a setting when none exists yet for the given org", async () => {
    vi.spyOn(seatCostApi, "listSeatCostSettings").mockResolvedValue([]);
    const created = {
      id: 2,
      uid: "s2",
      org: "o1",
      org_name: "Acme Org",
      monthly_amount: "6000.00",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    const createSpy = vi.spyOn(seatCostApi, "createSeatCostSetting").mockResolvedValue(created);
    const { result } = renderHook(() => useSeatCostSetting("o1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.save("6000");
    });
    expect(createSpy).toHaveBeenCalledWith({ monthly_amount: "6000", org: "o1" });
    expect(result.current.setting?.uid).toBe("s2");
  });

  it("edits the existing setting instead of creating a second one", async () => {
    vi.spyOn(seatCostApi, "listSeatCostSettings").mockResolvedValue([
      {
        id: 1,
        uid: "s1",
        org: "o1",
        org_name: "Acme Org",
        monthly_amount: "5000.00",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);
    const createSpy = vi.spyOn(seatCostApi, "createSeatCostSetting");
    const editSpy = vi.spyOn(seatCostApi, "editSeatCostSetting").mockResolvedValue({
      id: 1,
      uid: "s1",
      org: "o1",
      org_name: "Acme Org",
      monthly_amount: "9000.00",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
    });
    const { result } = renderHook(() => useSeatCostSetting("o1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.save("9000");
    });
    expect(editSpy).toHaveBeenCalledWith("s1", { monthly_amount: "9000" });
    expect(createSpy).not.toHaveBeenCalled();
    expect(result.current.setting?.monthly_amount).toBe("9000.00");
  });

  it("resolves the setting for the requested org specifically when the admin has settings for multiple orgs", async () => {
    // A multi-org admin's list includes rows for every org they administer.
    // `setting` must reflect the org passed in, never just rows[0].
    vi.spyOn(seatCostApi, "listSeatCostSettings").mockResolvedValue([
      {
        id: 1,
        uid: "s1",
        org: "o1",
        org_name: "Org One",
        monthly_amount: "5000.00",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      {
        id: 2,
        uid: "s2",
        org: "o2",
        org_name: "Org Two",
        monthly_amount: "9000.00",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);
    const { result } = renderHook(() => useSeatCostSetting("o2"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.setting?.uid).toBe("s2");
    expect(result.current.setting?.monthly_amount).toBe("9000.00");
    // Both orgs' rows remain visible via `settings` for callers (like the
    // Profitability tab) that need to resolve per-employee, per-org.
    expect(result.current.settings).toHaveLength(2);
  });

  it("PATCHes the correct org's row when saving after switching which org is being configured", async () => {
    vi.spyOn(seatCostApi, "listSeatCostSettings").mockResolvedValue([
      {
        id: 1,
        uid: "s1",
        org: "o1",
        org_name: "Org One",
        monthly_amount: "5000.00",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      {
        id: 2,
        uid: "s2",
        org: "o2",
        org_name: "Org Two",
        monthly_amount: "9000.00",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);
    const editSpy = vi.spyOn(seatCostApi, "editSeatCostSetting").mockResolvedValue({
      id: 2,
      uid: "s2",
      org: "o2",
      org_name: "Org Two",
      monthly_amount: "9500.00",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
    });
    const { result } = renderHook(() => useSeatCostSetting("o2"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.save("9500");
    });
    expect(editSpy).toHaveBeenCalledWith("s2", { monthly_amount: "9500" });
  });

  it("has no matching setting (and does not fall back to another org's row) when orgUid is null", async () => {
    vi.spyOn(seatCostApi, "listSeatCostSettings").mockResolvedValue([
      {
        id: 1,
        uid: "s1",
        org: "o1",
        org_name: "Org One",
        monthly_amount: "5000.00",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ]);
    const { result } = renderHook(() => useSeatCostSetting(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.setting).toBeNull();
    expect(result.current.settings).toHaveLength(1);
  });
});
