import { describe, expect, it } from "vitest";
import { BLANK_PLAN_ROW, dtoToPlanRow } from "@/utils/growthplan";
import type { GrowthPlanDto } from "@/types/api";

const baseDto: GrowthPlanDto = {
  id: 1,
  uid: "pln-1",
  activity: "Improve invoice throughput",
  target_month: "2025-09",
  steps_taken: "Mapped current flow",
  steps_to_take: "Automate reminders",
  status: "Under Progress",
  priority: "High",
  assigned_to: "usr-1",
  assigned_to_detail: {
    id: 42,
    uid: "usr-1",
    full_name: "Alice",
    username: "alice",
  },
  created_by_detail: null,
  remarks: "On track",
  created_at: "2025-04-01T00:00:00Z",
  updated_at: "2025-04-02T00:00:00Z",
};

describe("dtoToPlanRow", () => {
  it("maps every field from DTO to row shape", () => {
    const row = dtoToPlanRow(baseDto);
    expect(row.id).toBe("pln-1");
    expect(row.activity).toBe("Improve invoice throughput");
    expect(row.target_month).toBe("2025-09");
    expect(row.steps_taken).toBe("Mapped current flow");
    expect(row.steps_to_take).toBe("Automate reminders");
    expect(row.status).toBe("Under Progress");
    expect(row.priority).toBe("High");
    expect(row.assigned_to).toBe("Alice");
    expect(row.assigned_to_uid).toBe("usr-1");
    expect(row.remarks).toBe("On track");
  });

  it("falls back to empty strings when optional fields are null", () => {
    const dto: GrowthPlanDto = {
      ...baseDto,
      target_month: "",
      assigned_to: null,
      assigned_to_detail: null,
    };
    const row = dtoToPlanRow(dto);
    expect(row.target_month).toBe("");
    expect(row.assigned_to).toBe("");
    expect(row.assigned_to_uid).toBeNull();
  });
});

describe("BLANK_PLAN_ROW", () => {
  it("is a safe default for the add-row form", () => {
    expect(BLANK_PLAN_ROW.id).toBe("");
    expect(BLANK_PLAN_ROW.status).toBe("Open");
    expect(BLANK_PLAN_ROW.priority).toBe("Medium");
    expect(BLANK_PLAN_ROW.assigned_to_uid).toBeNull();
  });
});
