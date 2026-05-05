// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  cleanup();
});
import { DailyStandupDateSection } from "@/components/pace/DailyStandupDateSection";
import type { OperationalStandupRosterRow } from "@/types/api";

const profile = { id: 1, uid: "p1", full_name: "Alice", username: "alice" };
const row: OperationalStandupRosterRow = {
  profile,
  org_uid: "o1",
  org_name: "4D",
  entry: null,
  can_edit: true,
  can_approve: false,
};

describe("DailyStandupDateSection", () => {
  it("collapses and expands on header click", () => {
    render(
      <DailyStandupDateSection
        date="2026-05-04"
        rows={[row]}
        defaultExpanded={false}
        canFinalReview={false}
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
        canFinalReview={false}
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
        canFinalReview
        pendingCount={3}
        isAdmin={false}
        onSave={vi.fn()}
        onApprove={vi.fn()}
        onReview={vi.fn()}
        onFinalReview={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /final review/i })).toBeTruthy();
  });

  it("calls onFinalReview when clicked", () => {
    const onFinalReview = vi.fn();
    render(
      <DailyStandupDateSection
        date="2026-05-04"
        rows={[row]}
        defaultExpanded
        canFinalReview
        pendingCount={2}
        isAdmin
        onSave={vi.fn()}
        onApprove={vi.fn()}
        onReview={vi.fn()}
        onFinalReview={onFinalReview}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /final review/i }));
    expect(onFinalReview).toHaveBeenCalledWith("2026-05-04");
  });
});
