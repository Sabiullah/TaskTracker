import { describe, it, expect } from "vitest";

import { resolveSubCategoryMaster } from "@/components/board/resolveSubCategory";
import type { MasterItem } from "@/types";

const cat = (over: Partial<MasterItem>): MasterItem => ({
  id: "x",
  name: "X",
  type: "category",
  org: "org-1",
  orgs: ["org-1"],
  parent: null,
  is_active: true,
  ...over,
});

describe("resolveSubCategoryMaster", () => {
  it("prefers a child master under the selected main when same-named twins exist", () => {
    const masters = [
      cat({ id: "child-a", name: "Stock Report", parent: "main-a" }),
      cat({ id: "child-b", name: "Stock Report", parent: "main-b" }),
    ];
    const found = resolveSubCategoryMaster(masters, "Stock Report", "main-b");
    expect(found?.id).toBe("child-b");
  });

  it("falls back to any child with that name when the selected main has no such child", () => {
    // Reproduces the Edit-Goal bug: the goal's main ("Analytics") has no
    // sub-category masters, so the picker lists ALL categories. Picking one
    // must still resolve even though it isn't a child of the selected main.
    const masters = [
      cat({ id: "main-analytics", name: "Analytics", parent: null }),
      cat({ id: "child-accounting", name: "Accounting", parent: "main-other" }),
    ];
    const found = resolveSubCategoryMaster(masters, "Accounting", "main-analytics");
    expect(found?.id).toBe("child-accounting");
  });

  it("resolves any child by name when no main is selected", () => {
    const masters = [cat({ id: "child", name: "Advance Tax", parent: "main-x" })];
    const found = resolveSubCategoryMaster(masters, "Advance Tax", null);
    expect(found?.id).toBe("child");
  });

  it("falls back to a parentless master as a last resort (legacy goals)", () => {
    const masters = [cat({ id: "top", name: "Allied", parent: null })];
    const found = resolveSubCategoryMaster(masters, "Allied", "main-x");
    expect(found?.id).toBe("top");
  });

  it("returns undefined when no category matches the name", () => {
    const masters = [cat({ id: "child", name: "Accounting", parent: "main-x" })];
    expect(resolveSubCategoryMaster(masters, "Nonexistent", "main-x")).toBeUndefined();
  });
});
