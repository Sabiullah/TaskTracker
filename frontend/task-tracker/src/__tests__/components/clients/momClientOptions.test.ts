import { describe, expect, it } from "vitest";
import { momClientOptions } from "@/components/clients/momClientOptions";
import type { MasterItem } from "@/types";

function client(id: string, name: string, orgs: string[], legacyOrg: string | null = null): MasterItem {
  return { id, name, type: "client", org: legacyOrg, orgs, color: null };
}

describe("momClientOptions", () => {
  it("returns all clients when selectedOrg is null", () => {
    const clients = [client("a", "Acme", ["org1"]), client("b", "Beta", ["org2"])];
    expect(momClientOptions(clients, null, "").map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("filters by selectedOrg via the orgs array", () => {
    const clients = [client("a", "Acme", ["org1"]), client("b", "Beta", ["org2"])];
    expect(momClientOptions(clients, "org1", "").map((c) => c.id)).toEqual(["a"]);
  });

  it("filters by selectedOrg via the legacy org field as fallback", () => {
    const clients = [client("a", "Acme", [], "org1"), client("b", "Beta", [], "org2")];
    expect(momClientOptions(clients, "org1", "").map((c) => c.id)).toEqual(["a"]);
  });

  it("always includes the currently-selected client even if filtered out by org", () => {
    const clients = [client("a", "Acme", ["org1"]), client("b", "Beta", ["org2"])];
    const out = momClientOptions(clients, "org1", "b").map((c) => c.id);
    expect(out).toContain("a");
    expect(out).toContain("b");
  });

  it("does not duplicate the selected client when it already passes the filter", () => {
    const clients = [client("a", "Acme", ["org1"])];
    const out = momClientOptions(clients, "org1", "a").map((c) => c.id);
    expect(out).toEqual(["a"]);
  });

  it("ignores an empty or unknown selected client uid", () => {
    const clients = [client("a", "Acme", ["org1"])];
    expect(momClientOptions(clients, "org2", "").map((c) => c.id)).toEqual([]);
    expect(momClientOptions(clients, "org2", "ghost").map((c) => c.id)).toEqual([]);
  });

  it("sorts results alphabetically by name", () => {
    const clients = [client("z", "Zeta", []), client("a", "Acme", []), client("m", "Midco", [])];
    expect(momClientOptions(clients, null, "").map((c) => c.name)).toEqual(["Acme", "Midco", "Zeta"]);
  });
});
