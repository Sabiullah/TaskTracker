import { describe, it, expect } from "vitest";
import { useLeaveRequests } from "@/hooks/useLeaveRequests";
import { useWfhApprovals } from "@/hooks/useWfhApprovals";
import { useApprovalsBadge } from "@/hooks/useApprovalsBadge";

describe("Phase 2 hooks — module shape", () => {
  it("useLeaveRequests is a function", () => {
    expect(typeof useLeaveRequests).toBe("function");
  });
  it("useWfhApprovals is a function", () => {
    expect(typeof useWfhApprovals).toBe("function");
  });
  it("useApprovalsBadge is a function", () => {
    expect(typeof useApprovalsBadge).toBe("function");
  });
});
