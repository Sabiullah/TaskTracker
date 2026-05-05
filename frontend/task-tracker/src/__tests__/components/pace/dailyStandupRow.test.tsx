// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  cleanup();
});
import { DailyStandupRow } from "@/components/pace/DailyStandupRow";
import type { OperationalStandupRosterRow, OperationalStandupDto } from "@/types/api";

const baseRow: OperationalStandupRosterRow = {
  profile: { id: 1, uid: "p1", full_name: "Alice", username: "alice" },
  org_uid: "o1",
  org_name: "4D",
  entry: null,
  can_edit: true,
  can_approve: false,
};

function makeEntry(overrides: Partial<OperationalStandupDto> = {}): OperationalStandupDto {
  return {
    id: 1,
    uid: "e1",
    org_uid: "o1",
    profile: "p1",
    profile_detail: baseRow.profile,
    standup_date: "2026-05-04",
    breakthrough_type: "" as const,
    priorities: "x",
    collaboration_need: "",
    remarks: "",
    status: "Pending" as const,
    created_by_detail: null,
    approved_by_detail: null,
    approved_at: null,
    reviewed_by_detail: null,
    reviewed_at: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

describe("DailyStandupRow", () => {
  it("shows 'Not submitted' for placeholder row", () => {
    render(
      <DailyStandupRow
        row={baseRow}
        isAdmin={false}
        onSave={vi.fn()}
        onApprove={vi.fn()}
        onReview={vi.fn()}
      />,
    );
    expect(screen.getByText(/Not submitted/i)).toBeTruthy();
  });

  it("renders entry priorities when present", () => {
    const row: OperationalStandupRosterRow = {
      ...baseRow,
      entry: makeEntry({ breakthrough_type: "Breakthrough", priorities: "Ship release" }),
    };
    render(
      <DailyStandupRow
        row={row}
        isAdmin={false}
        onSave={vi.fn()}
        onApprove={vi.fn()}
        onReview={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue("Ship release")).toBeTruthy();
  });

  it("calls onApprove when Approve clicked on a pending row", () => {
    const onApprove = vi.fn();
    const row: OperationalStandupRosterRow = {
      ...baseRow,
      can_approve: true,
      entry: makeEntry(),
    };
    render(
      <DailyStandupRow
        row={row}
        isAdmin={false}
        onSave={vi.fn()}
        onApprove={onApprove}
        onReview={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(onApprove).toHaveBeenCalledWith("e1");
  });

  it("Save button is hidden until row is dirty, then click triggers onSave + Saved ✓", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const row: OperationalStandupRosterRow = {
      ...baseRow,
      entry: makeEntry({ priorities: "old" }),
    };
    render(
      <DailyStandupRow
        row={row}
        isAdmin={false}
        onSave={onSave}
        onApprove={vi.fn()}
        onReview={vi.fn()}
      />,
    );
    // No Save button initially.
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();

    // Type into priorities textarea → row becomes dirty.
    const ta = screen.getByDisplayValue("old");
    fireEvent.change(ta, { target: { value: "new priority" } });

    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    expect(saveBtn).toBeTruthy();

    await act(async () => {
      fireEvent.click(saveBtn);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    // After save, button now shows "Saved ✓" until auto-clear.
    expect(screen.getByRole("button", { name: /saved/i })).toBeTruthy();
  });

  it("Cancel button restores entry values and clears dirty state", () => {
    const row: OperationalStandupRosterRow = {
      ...baseRow,
      entry: makeEntry({ priorities: "original" }),
    };
    render(
      <DailyStandupRow
        row={row}
        isAdmin={false}
        onSave={vi.fn()}
        onApprove={vi.fn()}
        onReview={vi.fn()}
      />,
    );
    const ta = screen.getByDisplayValue("original") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "edited" } });
    expect(screen.getByDisplayValue("edited")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.getByDisplayValue("original")).toBeTruthy();
    // Save button should now be hidden again (no longer dirty).
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
  });

  it("Review button visible only when isAdmin=true and reviewed_at is null", () => {
    const onReview = vi.fn();
    const row: OperationalStandupRosterRow = {
      ...baseRow,
      entry: makeEntry({ status: "Approved", reviewed_at: null }),
    };
    // Non-admin: no Review button.
    const { rerender } = render(
      <DailyStandupRow
        row={row}
        isAdmin={false}
        onSave={vi.fn()}
        onApprove={vi.fn()}
        onReview={onReview}
      />,
    );
    expect(screen.queryByRole("button", { name: /^review$/i })).toBeNull();

    // Admin + unreviewed: Review button visible.
    rerender(
      <DailyStandupRow
        row={row}
        isAdmin
        onSave={vi.fn()}
        onApprove={vi.fn()}
        onReview={onReview}
      />,
    );
    const reviewBtn = screen.getByRole("button", { name: /^review$/i });
    expect(reviewBtn).toBeTruthy();
    fireEvent.click(reviewBtn);
    expect(onReview).toHaveBeenCalledWith("e1");
  });

  it("Review button hidden when entry already reviewed; Reviewed pill shown instead", () => {
    const row: OperationalStandupRosterRow = {
      ...baseRow,
      entry: makeEntry({
        status: "Approved",
        reviewed_at: "2026-05-04T12:00:00Z",
        reviewed_by_detail: { id: 9, uid: "u9", full_name: "Cathy", username: "cathy" },
      }),
    };
    render(
      <DailyStandupRow
        row={row}
        isAdmin
        onSave={vi.fn()}
        onApprove={vi.fn()}
        onReview={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /^review$/i })).toBeNull();
    expect(screen.getByText(/Reviewed/)).toBeTruthy();
    expect(screen.getByText(/Cathy/)).toBeTruthy();
  });
});
