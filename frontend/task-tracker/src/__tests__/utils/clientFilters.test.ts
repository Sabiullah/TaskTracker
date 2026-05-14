import { describe, expect, it } from "vitest";
import {
  filterClientsForAdd,
  filterClientsForEdit,
} from "@/utils/clientFilters";
import type { MasterItem } from "@/types";

function makeClient(
  id: string,
  name: string,
  is_active: boolean,
): MasterItem {
  return {
    id,
    name,
    type: "client",
    org: null,
    orgs: [],
    color: null,
    is_active,
  };
}

describe("filterClientsForAdd", () => {
  it("excludes inactive clients", () => {
    const items = [
      makeClient("a", "Acme", true),
      makeClient("b", "Beta", false),
      makeClient("c", "Cyrix", true),
    ];
    expect(filterClientsForAdd(items).map((c) => c.id)).toEqual(["a", "c"]);
  });

  it("treats missing is_active as active (back-compat)", () => {
    const items = [
      { ...makeClient("a", "Acme", true), is_active: undefined as unknown as boolean },
      makeClient("b", "Beta", false),
    ];
    expect(filterClientsForAdd(items).map((c) => c.id)).toEqual(["a"]);
  });
});

describe("filterClientsForEdit", () => {
  it("keeps every active client", () => {
    const items = [makeClient("a", "Acme", true), makeClient("b", "Beta", true)];
    expect(filterClientsForEdit(items, null).map((c) => c.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("hides inactive clients when boundUid is null", () => {
    const items = [makeClient("a", "Acme", true), makeClient("b", "Beta", false)];
    expect(filterClientsForEdit(items, null).map((c) => c.id)).toEqual(["a"]);
  });

  it("keeps the bound client even when inactive", () => {
    const items = [
      makeClient("a", "Acme", true),
      makeClient("b", "Beta", false),
    ];
    expect(filterClientsForEdit(items, "b").map((c) => c.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("does not duplicate the bound client when already active", () => {
    const items = [makeClient("a", "Acme", true)];
    expect(filterClientsForEdit(items, "a").map((c) => c.id)).toEqual(["a"]);
  });
});
