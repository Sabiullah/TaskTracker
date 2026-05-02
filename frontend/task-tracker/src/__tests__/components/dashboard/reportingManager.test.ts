import { describe, expect, it } from "vitest";
import {
  actualManagers,
  subTreeManagers,
  subTreeNames,
} from "@/components/dashboard/reportingManager";

type P = {
  id: string;
  full_name: string;
  manager_ids: string[] | null;
};

const mk = (id: string, full_name: string, manager_ids: string[] | null = null): P => ({
  id,
  full_name,
  manager_ids,
});

describe("actualManagers", () => {
  it("returns empty when no profile references any manager", () => {
    const profiles: P[] = [mk("1", "Alice"), mk("2", "Bob")];
    expect(actualManagers(profiles)).toEqual([]);
  });

  it("returns profiles that appear in another profile's manager_ids", () => {
    const profiles: P[] = [
      mk("1", "Alice"),
      mk("2", "Bob", ["1"]),
      mk("3", "Carol", ["1"]),
    ];
    expect(actualManagers(profiles).map((p) => p.id)).toEqual(["1"]);
  });

  it("does not duplicate a manager referenced by multiple reports", () => {
    const profiles: P[] = [
      mk("1", "Alice"),
      mk("2", "Bob", ["1"]),
      mk("3", "Carol", ["1"]),
      mk("4", "Dave", ["1"]),
    ];
    expect(actualManagers(profiles)).toHaveLength(1);
  });

  it("treats null manager_ids as empty", () => {
    const profiles: P[] = [mk("1", "Alice", null), mk("2", "Bob", null)];
    expect(actualManagers(profiles)).toEqual([]);
  });
});

describe("subTreeNames", () => {
  it("returns just the root's name when they have no reports", () => {
    const profiles: P[] = [mk("1", "Alice"), mk("2", "Bob")];
    expect([...subTreeNames("1", profiles)]).toEqual(["Alice"]);
  });

  it("includes root + direct reports", () => {
    const profiles: P[] = [
      mk("1", "Alice"),
      mk("2", "Bob", ["1"]),
      mk("3", "Carol", ["1"]),
      mk("4", "Dave"),
    ];
    expect(new Set(subTreeNames("1", profiles))).toEqual(
      new Set(["Alice", "Bob", "Carol"]),
    );
  });

  it("includes indirect reports across 3 levels", () => {
    const profiles: P[] = [
      mk("1", "Alice"),
      mk("2", "Bob", ["1"]),
      mk("3", "Carol", ["2"]),
      mk("4", "Dave", ["3"]),
      mk("5", "Eve"),
    ];
    expect(new Set(subTreeNames("1", profiles))).toEqual(
      new Set(["Alice", "Bob", "Carol", "Dave"]),
    );
  });

  it("terminates on a cycle (A manages B, B manages A)", () => {
    const profiles: P[] = [
      mk("1", "Alice", ["2"]),
      mk("2", "Bob", ["1"]),
    ];
    expect(new Set(subTreeNames("1", profiles))).toEqual(
      new Set(["Alice", "Bob"]),
    );
  });

  it("returns an empty set when rootId is unknown", () => {
    const profiles: P[] = [mk("1", "Alice")];
    expect([...subTreeNames("999", profiles)]).toEqual([]);
  });
});

describe("subTreeManagers", () => {
  it("returns sub-managers under root, excluding root", () => {
    const profiles: P[] = [
      mk("1", "Alice"),
      mk("2", "Bob", ["1"]),
      mk("3", "Carol", ["2"]),
      mk("4", "Dave", ["3"]),
    ];
    // Bob has Carol under him → Bob is a manager
    // Carol has Dave under her → Carol is a manager
    // Dave has no reports → not a manager
    const out = subTreeManagers("1", profiles).map((p) => p.id).sort();
    expect(out).toEqual(["2", "3"]);
  });

  it("does not include peers or seniors of root", () => {
    const profiles: P[] = [
      mk("1", "Alice"),       // CEO
      mk("2", "Bob", ["1"]),  // VP A
      mk("3", "Carol", ["1"]),// VP B (peer of Bob)
      mk("4", "Dave", ["2"]), // under Bob
      mk("5", "Eve", ["4"]),  // under Dave
    ];
    // From Bob's perspective, sub-managers should only be Dave (manager of Eve)
    const out = subTreeManagers("2", profiles).map((p) => p.id);
    expect(out).toEqual(["4"]);
  });

  it("returns empty when root has no sub-managers (only IC reports)", () => {
    const profiles: P[] = [
      mk("1", "Alice"),
      mk("2", "Bob", ["1"]),
      mk("3", "Carol", ["1"]),
    ];
    // Both Bob and Carol are ICs under Alice — no sub-managers
    expect(subTreeManagers("1", profiles)).toEqual([]);
  });
});
