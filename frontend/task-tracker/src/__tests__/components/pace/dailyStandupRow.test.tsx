// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  cleanup();
});
import { DailyStandupRow } from "@/components/pace/DailyStandupRow";
import type { OperationalStandupRosterRow, OperationalStandupDto } from "@/types/api";

const profileRef = { id: 1, uid: "p1", full_name: "Alice", username: "alice" };

const baseRow: OperationalStandupRosterRow = {
  profile: profileRef,
  entry: null,
  approvals: [],
  can_edit: true,
};

function makeEntry(overrides: Partial<OperationalStandupDto> = {}): OperationalStandupDto {
  return {
    id: 1,
    uid: "e1",
    profile: "p1",
    profile_detail: profileRef,
    standup_date: "2026-05-04",
    breakthrough_type: "" as const,
    priorities: "x",
    collaboration_need: "",
    remarks: "",
    created_by_detail: null,
    approvals: [],
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function pendingApproval(uid: string, orgUid: string, orgName: string): OperationalStandupRosterRow["approvals"][number] {
  return {
    uid,
    org_uid: orgUid,
    org_name: orgName,
    status: "Pending",
    approved_by: null,
    approved_at: null,
    reviewed_by: null,
    reviewed_at: null,
    can_act: true,
  };
}

function approvedApproval(
  uid: string,
  orgUid: string,
  orgName: string,
  approver: { uid: string; full_name: string },
  reviewedAt: string | null = null,
): OperationalStandupRosterRow["approvals"][number] {
  return {
    uid,
    org_uid: orgUid,
    org_name: orgName,
    status: "Approved",
    approved_by: approver,
    approved_at: "2026-05-04T09:00:00Z",
    reviewed_by: null,
    reviewed_at: reviewedAt,
    can_act: true,
  };
}

describe("DailyStandupRow", () => {
  it("placeholder row shows 'Not submitted' and a '+ Add' button (no inputs)", () => {
    render(
      <table><tbody>
        <DailyStandupRow
          row={baseRow}
          isAdmin={false}
          onSave={vi.fn()}
          onApprove={vi.fn()}
          onReview={vi.fn()}
        />
      </tbody></table>,
    );
    expect(screen.getByText(/Not submitted/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /\+ add/i })).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("entry row renders values as static text by default; Edit reveals inputs", () => {
    const row: OperationalStandupRosterRow = {
      ...baseRow,
      entry: makeEntry({ breakthrough_type: "Breakthrough", priorities: "Ship release" }),
    };
    render(
      <table><tbody>
        <DailyStandupRow
          row={row}
          isAdmin={false}
          onSave={vi.fn()}
          onApprove={vi.fn()}
          onReview={vi.fn()}
        />
      </tbody></table>,
    );
    expect(screen.getByText("Ship release")).toBeTruthy();
    expect(screen.getByText("Breakthrough")).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByDisplayValue("Ship release")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(screen.getByDisplayValue("Ship release")).toBeTruthy();
  });

  it("renders one chip per approval; per-org Approve button calls onApprove(uid, orgUid)", () => {
    const onApprove = vi.fn();
    const row: OperationalStandupRosterRow = {
      ...baseRow,
      entry: makeEntry(),
      approvals: [
        approvedApproval("a-4d", "o-4d", "4D", { uid: "m-4d", full_name: "Mike" }),
        pendingApproval("a-ybv", "o-ybv", "YBV"),
      ],
    };
    render(
      <table><tbody>
        <DailyStandupRow
          row={row}
          isAdmin={false}
          onSave={vi.fn()}
          onApprove={onApprove}
          onReview={vi.fn()}
        />
      </tbody></table>,
    );
    // Both org names rendered (chip text contains "<org> <icon> <approver>").
    expect(screen.getAllByText(/4D/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/YBV/).length).toBeGreaterThan(0);
    // YBV is Pending and can_act=true → Approve button surfaces; 4D is already
    // Approved → no Approve button.
    fireEvent.click(screen.getByRole("button", { name: /Approve YBV/i }));
    expect(onApprove).toHaveBeenCalledWith("e1", "o-ybv");
  });

  it("Edit → type → Save calls onSave; row returns to view mode", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const row: OperationalStandupRosterRow = {
      ...baseRow,
      entry: makeEntry({ priorities: "old" }),
    };
    render(
      <table><tbody>
        <DailyStandupRow
          row={row}
          isAdmin={false}
          onSave={onSave}
          onApprove={vi.fn()}
          onReview={vi.fn()}
        />
      </tbody></table>,
    );
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    const saveBtn = screen.getByRole("button", { name: /^save$/i }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    const ta = screen.getByDisplayValue("old");
    fireEvent.change(ta, { target: { value: "new priority" } });
    expect(saveBtn.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(saveBtn);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /^edit$/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
  });

  it("Edit → change → Cancel restores values and exits edit mode", () => {
    const row: OperationalStandupRosterRow = {
      ...baseRow,
      entry: makeEntry({ priorities: "original" }),
    };
    render(
      <table><tbody>
        <DailyStandupRow
          row={row}
          isAdmin={false}
          onSave={vi.fn()}
          onApprove={vi.fn()}
          onReview={vi.fn()}
        />
      </tbody></table>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    const ta = screen.getByDisplayValue("original") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "edited" } });
    expect(screen.getByDisplayValue("edited")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.getByText("original")).toBeTruthy();
    expect(screen.queryByDisplayValue("edited")).toBeNull();
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^edit$/i })).toBeTruthy();
  });

  it("placeholder row: '+ Add' enters edit mode with empty inputs and Save enabled", () => {
    render(
      <table><tbody>
        <DailyStandupRow
          row={baseRow}
          isAdmin={false}
          onSave={vi.fn()}
          onApprove={vi.fn()}
          onReview={vi.fn()}
        />
      </tbody></table>,
    );
    fireEvent.click(screen.getByRole("button", { name: /\+ add/i }));
    expect(screen.getByPlaceholderText(/Top priorities/i)).toBeTruthy();
    const saveBtn = screen.getByRole("button", { name: /^save$/i }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
  });

  it("Review button visible only for admins on Approved+unreviewed approvals", () => {
    const onReview = vi.fn();
    const row: OperationalStandupRosterRow = {
      ...baseRow,
      entry: makeEntry(),
      approvals: [
        approvedApproval("a-4d", "o-4d", "4D", { uid: "m-4d", full_name: "Mike" }),
      ],
    };
    // Non-admin: no Review button.
    const { rerender } = render(
      <table><tbody>
        <DailyStandupRow
          row={row}
          isAdmin={false}
          onSave={vi.fn()}
          onApprove={vi.fn()}
          onReview={onReview}
        />
      </tbody></table>,
    );
    expect(screen.queryByRole("button", { name: /Review 4D/i })).toBeNull();

    // Admin + unreviewed: Review button visible.
    rerender(
      <table><tbody>
        <DailyStandupRow
          row={row}
          isAdmin
          onSave={vi.fn()}
          onApprove={vi.fn()}
          onReview={onReview}
        />
      </tbody></table>,
    );
    const reviewBtn = screen.getByRole("button", { name: /Review 4D/i });
    fireEvent.click(reviewBtn);
    expect(onReview).toHaveBeenCalledWith("e1", "o-4d");
  });

  it("Review button hidden when approval already reviewed", () => {
    const row: OperationalStandupRosterRow = {
      ...baseRow,
      entry: makeEntry(),
      approvals: [
        approvedApproval("a-4d", "o-4d", "4D", { uid: "m-4d", full_name: "Mike" }, "2026-05-04T12:00:00Z"),
      ],
    };
    render(
      <table><tbody>
        <DailyStandupRow
          row={row}
          isAdmin
          onSave={vi.fn()}
          onApprove={vi.fn()}
          onReview={vi.fn()}
        />
      </tbody></table>,
    );
    expect(screen.queryByRole("button", { name: /Review 4D/i })).toBeNull();
  });
});
