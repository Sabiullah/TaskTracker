import { describe, expect, it } from "vitest";
import { actionPointMatches, isFilterActive } from "@/components/clients/actionPointFilter";
import type { ClientActionPointDto } from "@/types/api/clients";

function ap(overrides: Partial<ClientActionPointDto> = {}): ClientActionPointDto {
  return {
    id: 1,
    uid: "ap-1",
    meeting: 10,
    description: "do thing",
    responsibility: "user-1",
    responsibility_detail: null,
    target_date: "2026-04-15",
    completion_date: null,
    status: "Open",
    priority: "Medium",
    remarks: "",
    roadmap_link: null,
    attachments: [],
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

const baseFilters = {
  status: [] as string[],
  priority: [] as string[],
  owner: [] as string[],
  targetMonth: "",
};

describe("actionPointFilter", () => {
  describe("isFilterActive", () => {
    it("returns false when all fields empty and no overdue set", () => {
      expect(isFilterActive(baseFilters)).toBe(false);
    });

    it("returns true when status filter is non-empty", () => {
      expect(isFilterActive({ ...baseFilters, status: ["Open"] })).toBe(true);
    });

    it("returns true when overdueUids is provided (even if empty set)", () => {
      expect(isFilterActive({ ...baseFilters, overdueUids: new Set() })).toBe(true);
    });
  });

  describe("actionPointMatches", () => {
    it("matches when overdueUids contains the AP uid", () => {
      const filters = { ...baseFilters, overdueUids: new Set(["ap-1"]) };
      expect(actionPointMatches(ap({ uid: "ap-1" }), filters)).toBe(true);
    });

    it("rejects when overdueUids is set and does NOT contain the AP uid", () => {
      const filters = { ...baseFilters, overdueUids: new Set(["ap-other"]) };
      expect(actionPointMatches(ap({ uid: "ap-1" }), filters)).toBe(false);
    });

    it("rejects every AP when overdueUids is an empty set", () => {
      const filters = { ...baseFilters, overdueUids: new Set<string>() };
      expect(actionPointMatches(ap({ uid: "ap-1" }), filters)).toBe(false);
    });

    it("composes with other filters (AND semantics)", () => {
      const filters = {
        ...baseFilters,
        status: ["Open"],
        overdueUids: new Set(["ap-1"]),
      };
      expect(actionPointMatches(ap({ uid: "ap-1", status: "Open" }), filters)).toBe(true);
      expect(actionPointMatches(ap({ uid: "ap-1", status: "Completed" }), filters)).toBe(false);
      expect(actionPointMatches(ap({ uid: "ap-2", status: "Open" }), filters)).toBe(false);
    });

    it("ignores overdueUids when undefined (existing behavior preserved)", () => {
      expect(actionPointMatches(ap({ uid: "ap-1" }), baseFilters)).toBe(true);
    });
  });
});
