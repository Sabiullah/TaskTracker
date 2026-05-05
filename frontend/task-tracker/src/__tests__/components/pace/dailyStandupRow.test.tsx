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
  it("placeholder row shows 'Not submitted' and a '+ Add' button (no inputs)", () => {
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
    expect(screen.getByRole("button", { name: /\+ add/i })).toBeTruthy();
    // No inputs rendered in view mode.
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("entry row renders values as static text by default; Edit reveals inputs", () => {
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
    // View mode: text is rendered, no editable controls.
    expect(screen.getByText("Ship release")).toBeTruthy();
    expect(screen.getByText("Breakthrough")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByDisplayValue("Ship release")).toBeNull();

    // Click Edit → inputs appear.
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(screen.getByDisplayValue("Ship release")).toBeTruthy();
  });

  it("calls onApprove when Approve clicked on a pending row (view mode only)", () => {
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

  it("Edit → type → Save calls onSave; row returns to view mode", async () => {
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
    // Default: view mode, no Save button.
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();

    // Click Edit → inputs appear, Save is present but disabled (not dirty).
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    const saveBtn = screen.getByRole("button", { name: /^save$/i }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    // Type → dirty → Save enabled.
    const ta = screen.getByDisplayValue("old");
    fireEvent.change(ta, { target: { value: "new priority" } });
    expect(saveBtn.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(saveBtn);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    // Back to view mode: Edit button visible again, no inputs, Saved ✓ pill shown briefly.
    expect(screen.getByRole("button", { name: /^edit$/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
  });

  it("Edit → change → Cancel restores values and exits edit mode", () => {
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
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    const ta = screen.getByDisplayValue("original") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "edited" } });
    expect(screen.getByDisplayValue("edited")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    // Out of edit mode: original text shown, no input.
    expect(screen.getByText("original")).toBeTruthy();
    expect(screen.queryByDisplayValue("edited")).toBeNull();
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^edit$/i })).toBeTruthy();
  });

  it("placeholder row: '+ Add' enters edit mode with empty inputs and Save enabled", () => {
    render(
      <DailyStandupRow
        row={baseRow}
        isAdmin={false}
        onSave={vi.fn()}
        onApprove={vi.fn()}
        onReview={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /\+ add/i }));
    // Inputs are now visible.
    expect(screen.getByPlaceholderText(/Top priorities/i)).toBeTruthy();
    // Save is immediately enabled (placeholder treated as dirty).
    const saveBtn = screen.getByRole("button", { name: /^save$/i }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
  });

  it("Review button visible only when isAdmin=true and reviewed_at is null (view mode)", () => {
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
