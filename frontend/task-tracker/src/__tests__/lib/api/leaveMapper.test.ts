import { describe, it, expect } from "vitest";
import { dtoToLeaveRequest } from "@/lib/api";
import type { LeaveRequestDto } from "@/types/api/leave";

const baseDto: LeaveRequestDto = {
  id: 1,
  uid: "leave-uid-1",
  org_uid: "org-uid-1",
  user: "user-uid-1",
  user_detail: { id: 11, uid: "user-uid-1", full_name: "Alice", username: "alice" },
  from_date: "2026-04-28",
  to_date: "2026-04-30",
  from_session: "Full",
  to_session: "Full",
  reason: "Family event",
  request_type: "Leave",
  status: "Pending",
  approver: null,
  approver_detail: null,
  approved_at: null,
  rejection_reason: "",
  total_days: "3.00",
  created_at: "2026-04-25T10:00:00Z",
  updated_at: "2026-04-25T10:00:00Z",
};

describe("dtoToLeaveRequest", () => {
  it("maps a fully-populated Pending DTO", () => {
    const entity = dtoToLeaveRequest(baseDto);
    expect(entity.id).toBe("leave-uid-1");
    expect(entity.user_uid).toBe("user-uid-1");
    expect(entity.user_name).toBe("Alice");
    expect(entity.org_uid).toBe("org-uid-1");
    expect(entity.total_days).toBe(3);
    expect(entity.approver_name).toBeNull();
    expect(entity.status).toBe("Pending");
  });

  it("parses total_days from a string with decimals", () => {
    const entity = dtoToLeaveRequest({ ...baseDto, total_days: "2.50" });
    expect(entity.total_days).toBe(2.5);
  });

  it("surfaces approver name when approved", () => {
    const entity = dtoToLeaveRequest({
      ...baseDto,
      status: "Approved",
      approver: 99,
      approver_detail: { id: 99, uid: "approver-uid", full_name: "Bob", username: "bob" },
      approved_at: "2026-04-26T09:00:00Z",
    });
    expect(entity.approver_name).toBe("Bob");
    expect(entity.approved_at).toBe("2026-04-26T09:00:00Z");
  });

  it("falls back to empty string when user_detail is missing", () => {
    const entity = dtoToLeaveRequest({ ...baseDto, user_detail: undefined as unknown as LeaveRequestDto["user_detail"] });
    expect(entity.user_name).toBe("");
  });

  it("preserves rejection_reason on Rejected", () => {
    const entity = dtoToLeaveRequest({
      ...baseDto,
      status: "Rejected",
      approver: 99,
      approver_detail: { id: 99, uid: "approver-uid", full_name: "Bob", username: "bob" },
      rejection_reason: "team release week",
    });
    expect(entity.rejection_reason).toBe("team release week");
    expect(entity.status).toBe("Rejected");
  });

  it("maps request_type='WFH' through to the entity", () => {
    const entity = dtoToLeaveRequest({ ...baseDto, request_type: "WFH" });
    expect(entity.request_type).toBe("WFH");
  });

  it("defaults request_type to 'Leave' when omitted (legacy payloads)", () => {
    const { request_type: _omit, ...rest } = baseDto;
    const entity = dtoToLeaveRequest(rest as LeaveRequestDto);
    expect(entity.request_type).toBe("Leave");
  });
});
