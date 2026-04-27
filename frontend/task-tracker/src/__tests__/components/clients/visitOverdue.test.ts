import { describe, expect, it } from "vitest";
import { isVisitOverdue } from "@/components/clients/visitOverdue";

const TODAY = new Date("2026-04-27");

function visit(visit_date: string, report_sent_date: string | null = null) {
  return { visit_date, report_sent_date };
}

describe("isVisitOverdue", () => {
  it("returns false on visit day", () => {
    expect(isVisitOverdue(visit("2026-04-27"), TODAY)).toBe(false);
  });
  it("returns false the next day", () => {
    expect(isVisitOverdue(visit("2026-04-26"), TODAY)).toBe(false);
  });
  it("returns true two days later", () => {
    expect(isVisitOverdue(visit("2026-04-25"), TODAY)).toBe(true);
  });
  it("returns false when sent date is set", () => {
    expect(isVisitOverdue(visit("2026-04-10", "2026-04-20"), TODAY)).toBe(false);
  });
});
