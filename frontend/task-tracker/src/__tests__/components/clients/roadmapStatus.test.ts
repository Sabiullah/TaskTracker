import { describe, expect, it } from "vitest";
import { deriveRoadmapStatus } from "@/components/clients/roadmapStatus";

describe("deriveRoadmapStatus", () => {
  it("returns Completed when completion_date is set", () => {
    expect(
      deriveRoadmapStatus({
        start_date: null,
        target_date: "2026-04-01",
        expected_date: null,
        completion_date: "2026-04-15",
      }),
    ).toBe("Completed");
  });

  it("returns Overdue when target_date is in the past and not completed", () => {
    expect(
      deriveRoadmapStatus({
        start_date: null,
        target_date: "2026-04-01",
        expected_date: null,
        completion_date: null,
      }),
    ).toBe("Overdue");
  });

  it("returns Overdue when expected_date slipped past target_date", () => {
    expect(
      deriveRoadmapStatus({
        start_date: "2026-05-01",
        target_date: "2026-06-01",
        expected_date: "2026-07-01",
        completion_date: null,
      }),
    ).toBe("Overdue");
  });

  it("returns In Progress when start_date is set and not overdue/completed", () => {
    expect(
      deriveRoadmapStatus({
        start_date: "2026-04-01",
        target_date: "2099-01-01",
        expected_date: null,
        completion_date: null,
      }),
    ).toBe("In Progress");
  });

  it("returns Not Started when no dates set", () => {
    expect(
      deriveRoadmapStatus({
        start_date: null,
        target_date: null,
        expected_date: null,
        completion_date: null,
      }),
    ).toBe("Not Started");
  });
});
