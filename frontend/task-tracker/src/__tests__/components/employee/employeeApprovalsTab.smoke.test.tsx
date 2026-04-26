import { describe, it, expect } from "vitest";
import EmployeeApprovalsTab from "@/components/employee/EmployeeApprovalsTab";
import RejectModal from "@/components/employee/RejectModal";

describe("Approvals UI components — module shape", () => {
  it("EmployeeApprovalsTab is a React component (function)", () => {
    expect(typeof EmployeeApprovalsTab).toBe("function");
  });
  it("RejectModal is a React component (function)", () => {
    expect(typeof RejectModal).toBe("function");
  });
});
