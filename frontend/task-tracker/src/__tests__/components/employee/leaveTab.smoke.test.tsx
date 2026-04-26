import { describe, it, expect } from "vitest";
import EmployeeLeaveTab from "@/components/employee/EmployeeLeaveTab";
import ApplyLeaveModal from "@/components/employee/ApplyLeaveModal";

describe("Phase 3 leave components — module shape", () => {
  it("EmployeeLeaveTab is a function component", () => {
    expect(typeof EmployeeLeaveTab).toBe("function");
  });
  it("ApplyLeaveModal is a function component", () => {
    expect(typeof ApplyLeaveModal).toBe("function");
  });
});
