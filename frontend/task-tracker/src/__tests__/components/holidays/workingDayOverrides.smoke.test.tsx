import { describe, it, expect } from "vitest";
import WorkingDayOverridesPanel from "@/components/holidays/WorkingDayOverridesPanel";
import { useWorkingDayOverrides } from "@/hooks/useWorkingDayOverrides";

describe("WorkingDayOverrides — module shape", () => {
  it("WorkingDayOverridesPanel is a function component", () => {
    expect(typeof WorkingDayOverridesPanel).toBe("function");
  });
  it("useWorkingDayOverrides is a hook function", () => {
    expect(typeof useWorkingDayOverrides).toBe("function");
  });
});
