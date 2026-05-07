import { describe, expect, it } from "vitest";
import {
  computeClientStats,
  computeDailyStats,
  computeMemberStats,
  computeMonthlyStats,
  computeWeeklyStats,
} from "@/utils/workLogDashboard";
import type { WorkLog } from "@/types";

function log(partial: Partial<WorkLog>): WorkLog {
  return {
    id: "log-x",
    name: "",
    date: "",
    day: "",
    client: "",
    task_description: "",
    hours_worked: "",
    priority: "",
    organization: "",
    sort_order: null,
    ...partial,
  };
}

describe("computeMemberStats", () => {
  it("aggregates minutes, entry count, days and clients per member", () => {
    const rows: WorkLog[] = [
      log({ name: "Alice", date: "2025-04-01", hours_worked: "1:00", client: "Acme" }),
      log({ name: "Alice", date: "2025-04-02", hours_worked: "2:30", client: "Acme" }),
      log({ name: "Alice", date: "2025-04-02", hours_worked: "0:30", client: "Beta" }),
      log({ name: "Bob", date: "2025-04-01", hours_worked: "4:00", client: "Acme" }),
    ];
    const stats = computeMemberStats(rows);
    expect(stats).toHaveLength(2);
    const alice = stats.find((s) => s.name === "Alice");
    expect(alice).toBeDefined();
    expect(alice!.mins).toBe(60 + 150 + 30); // 240
    expect(alice!.count).toBe(3);
    expect(alice!.days.size).toBe(2);
    expect(alice!.clients.size).toBe(2);
  });

  it("skips rows without a name", () => {
    const rows: WorkLog[] = [log({ name: "" })];
    expect(computeMemberStats(rows)).toEqual([]);
  });

  it("orders members by minutes descending", () => {
    const rows: WorkLog[] = [
      log({ name: "Alice", date: "2025-04-01", hours_worked: "1:00" }),
      log({ name: "Bob", date: "2025-04-01", hours_worked: "5:00" }),
    ];
    const stats = computeMemberStats(rows);
    expect(stats[0].name).toBe("Bob");
    expect(stats[1].name).toBe("Alice");
  });
});

describe("computeClientStats", () => {
  it("groups by client and counts unique members", () => {
    const rows: WorkLog[] = [
      log({ name: "Alice", client: "Acme", hours_worked: "1:00" }),
      log({ name: "Bob", client: "Acme", hours_worked: "1:00" }),
      log({ name: "Alice", client: "Acme", hours_worked: "0:30" }),
      log({ name: "Carol", client: "Beta", hours_worked: "2:00" }),
    ];
    const stats = computeClientStats(rows);
    const acme = stats.find((s) => s.client === "Acme");
    expect(acme!.mins).toBe(60 + 60 + 30);
    expect(acme!.count).toBe(3);
    expect(acme!.members.size).toBe(2);
  });

  it("buckets rows without a client under 'No Client'", () => {
    const rows: WorkLog[] = [log({ name: "Alice", client: "", hours_worked: "1:00" })];
    const stats = computeClientStats(rows);
    expect(stats[0].client).toBe("No Client");
  });
});

describe("computeDailyStats", () => {
  it("returns up to 30 days of trailing totals in ascending order", () => {
    const rows: WorkLog[] = Array.from({ length: 35 }, (_, i) => {
      const d = new Date(Date.UTC(2025, 2, 1 + i));
      return log({
        name: "Alice",
        date: d.toISOString().slice(0, 10),
        hours_worked: "1:00",
      });
    });
    const stats = computeDailyStats(rows);
    expect(stats).toHaveLength(30);
    expect(stats[0].date < stats[stats.length - 1].date).toBe(true);
    expect(stats[stats.length - 1].date).toBe("2025-04-04");
  });
});

describe("computeWeeklyStats", () => {
  it("keys each entry to the Monday of its week", () => {
    // 2025-04-02 is a Wednesday → Monday is 2025-03-31
    const rows: WorkLog[] = [
      log({ date: "2025-04-02", hours_worked: "1:00", name: "A" }),
      log({ date: "2025-04-03", hours_worked: "2:00", name: "A" }),
    ];
    const stats = computeWeeklyStats(rows);
    expect(stats).toHaveLength(1);
    expect(stats[0].week).toBe("2025-03-31");
    expect(stats[0].mins).toBe(180);
  });
});

describe("computeMonthlyStats", () => {
  it("groups by YYYY-MM prefix", () => {
    const rows: WorkLog[] = [
      log({ date: "2025-04-01", hours_worked: "1:00", name: "A" }),
      log({ date: "2025-04-28", hours_worked: "2:00", name: "A" }),
      log({ date: "2025-05-01", hours_worked: "0:30", name: "A" }),
    ];
    const stats = computeMonthlyStats(rows);
    expect(stats).toHaveLength(2);
    expect(stats.find((s) => s.month === "2025-04")!.mins).toBe(180);
    expect(stats.find((s) => s.month === "2025-05")!.mins).toBe(30);
  });
});
