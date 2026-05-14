// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import type { MasterItem } from "@/types";
import {
  filterClientsForAdd,
  filterClientsForEdit,
} from "@/utils/clientFilters";

// TaskModal builds its client option list from useMasters().clients.
// The component-level invariant we're protecting: Add mode applies
// filterClientsForAdd, Edit mode applies filterClientsForEdit with the
// task's bound client uid. This test pins the data-shape contract.

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

describe("TaskModal client options", () => {
  it("Add mode hides inactives", () => {
    expect(filterClientsForAdd(items).map((c) => c.id)).toEqual(["a"]);
  });

  it("Edit mode keeps the bound inactive client", () => {
    expect(filterClientsForEdit(items, "b").map((c) => c.id)).toEqual([
      "a",
      "b",
    ]);
  });
});
