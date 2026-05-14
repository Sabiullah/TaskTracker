import { describe, expect, it } from "vitest";
import type { MasterItem } from "@/types";
import { filterClientsForAdd } from "@/utils/clientFilters";

// Documents the contract: filter-bucket components MUST NOT call
// filterClientsForAdd on their dropdown source. This test is intentionally
// "negative" — it fails if someone refactors filterClientsForAdd to mutate
// the input or otherwise affect the array filter-row consumers rely on.

describe("Filter-bucket components keep all clients", () => {
  const items: MasterItem[] = [
    {
      id: "a",
      name: "Acme",
      type: "client",
      org: null,
      orgs: [],
      color: null,
      is_active: true,
    },
    {
      id: "b",
      name: "OldCo",
      type: "client",
      org: null,
      orgs: [],
      color: null,
      is_active: false,
    },
  ];

  it("filterClientsForAdd does not mutate the input", () => {
    const before = items.map((c) => c.id);
    filterClientsForAdd(items);
    expect(items.map((c) => c.id)).toEqual(before);
  });

  it("the unfiltered source is still 2 long after a filter call", () => {
    filterClientsForAdd(items);
    expect(items).toHaveLength(2);
  });
});
