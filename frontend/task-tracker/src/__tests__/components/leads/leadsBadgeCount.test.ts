import { describe, expect, it } from "vitest";
import { computeLeadsBadgeCount } from "@/components/leads/leadsBadgeCount";
import type { Lead } from "@/types";

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    serialNo: 1,
    client: "Acme",
    contact_person: null,
    contact_email: null,
    contact_phone: null,
    lead_source: null,
    reference_from: null,
    status: "Cold",
    priority: "Medium",
    assigned_to: null,
    estimated_value: null,
    action_taken: null,
    next_step: null,
    next_step_date: "2000-01-01", // far past → always overdue
    remarks: null,
    created_by: null,
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

describe("computeLeadsBadgeCount", () => {
  it("counts an overdue Open lead", () => {
    expect(computeLeadsBadgeCount([lead()])).toBe(1);
  });

  it("excludes overdue Confirmed leads", () => {
    expect(computeLeadsBadgeCount([lead({ status: "Confirmed" })])).toBe(0);
  });

  it("excludes overdue Cancelled leads", () => {
    expect(computeLeadsBadgeCount([lead({ status: "Cancelled" })])).toBe(0);
  });

  it("excludes future-dated leads", () => {
    expect(
      computeLeadsBadgeCount([lead({ next_step_date: "2999-12-31" })]),
    ).toBe(0);
  });

  it("excludes leads with no next_step_date", () => {
    expect(computeLeadsBadgeCount([lead({ next_step_date: null })])).toBe(0);
  });

  it("status comparison is case-insensitive", () => {
    expect(computeLeadsBadgeCount([lead({ status: "confirmed" })])).toBe(0);
    expect(computeLeadsBadgeCount([lead({ status: "CANCELLED" })])).toBe(0);
  });

  it("sums multiple matching leads", () => {
    const leads = [
      lead({ id: "a" }),
      lead({ id: "b", status: "Hot" }),
      lead({ id: "c", status: "Confirmed" }), // excluded
      lead({ id: "d", next_step_date: "2999-12-31" }), // excluded
    ];
    expect(computeLeadsBadgeCount(leads)).toBe(2);
  });
});
