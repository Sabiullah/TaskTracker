// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  cleanup();
});
import { DailyStandupDateSection } from "@/components/pace/DailyStandupDateSection";
import type { OperationalStandupRosterRow } from "@/types/api";

const profile = { id: 1, uid: "p1", full_name: "Alice", username: "alice" };
const adminOrgs = [
  { uid: "o1", name: "4D" },
  { uid: "o2", name: "YBV" },
];
const row: OperationalStandupRosterRow = {
  profile,
  entry: null,
  approvals: [],
  can_edit: true,
};

describe("DailyStandupDateSection", () => {
  it("collapses and expands on header click", () => {
    render(
      <DailyStandupDateSection
        date="2026-05-04"
        rows={[row]}
        defaultExpanded={false}
        adminOrgs={adminOrgs}
        pendingCount={0}
        isAdmin={false}
        onSave={vi.fn()}
        onApprove={vi.fn()}
        onReview={vi.fn()}
        onFinalReview={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Alice/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /04 May 2026/ }));
    expect(screen.getByText(/Alice/)).toBeTruthy();
  });

  it("shows Final Review only when admin and pending > 0", () => {
    const { rerender } = render(
      <DailyStandupDateSection
        date="2026-05-04"
        rows={[row]}
        defaultExpanded
        adminOrgs={adminOrgs}
        pendingCount={3}
        isAdmin={false}
        onSave={vi.fn()}
        onApprove={vi.fn()}
        onReview={vi.fn()}
        onFinalReview={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /final review/i })).toBeNull();

    rerender(
      <DailyStandupDateSection
        date="2026-05-04"
        rows={[row]}
        defaultExpanded
        adminOrgs={adminOrgs}
        pendingCount={3}
        isAdmin
        onSave={vi.fn()}
        onApprove={vi.fn()}
        onReview={vi.fn()}
        onFinalReview={vi.fn()}
      />,
    );
    // Admin sees one Final Review button per admin-org.
    expect(screen.getByRole("button", { name: /Final Review.*4D/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Final Review.*YBV/i })).toBeTruthy();
  });

  it("calls onFinalReview with (date, orgUid) when clicked", () => {
    const onFinalReview = vi.fn();
    render(
      <DailyStandupDateSection
        date="2026-05-04"
        rows={[row]}
        defaultExpanded
        adminOrgs={adminOrgs}
        pendingCount={2}
        isAdmin
        onSave={vi.fn()}
        onApprove={vi.fn()}
        onReview={vi.fn()}
        onFinalReview={onFinalReview}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Final Review.*YBV/i }));
    expect(onFinalReview).toHaveBeenCalledWith("2026-05-04", "o2");
  });
});
