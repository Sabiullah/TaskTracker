// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  cleanup();
});
import { DailyStandupRow } from "@/components/pace/DailyStandupRow";
import type { OperationalStandupRosterRow } from "@/types/api";

const baseRow: OperationalStandupRosterRow = {
  profile: { id: 1, uid: "p1", full_name: "Alice", username: "alice" },
  org_uid: "o1",
  org_name: "4D",
  entry: null,
  can_edit: true,
  can_approve: false,
};

describe("DailyStandupRow", () => {
  it("shows 'Not submitted' for placeholder row", () => {
    render(
      <DailyStandupRow
        row={baseRow}
        onSave={vi.fn()}
        onApprove={vi.fn()}
      />,
    );
    expect(screen.getByText(/Not submitted/i)).toBeTruthy();
  });

  it("renders entry priorities when present", () => {
    const row: OperationalStandupRosterRow = {
      ...baseRow,
      entry: {
        id: 1,
        uid: "e1",
        org_uid: "o1",
        profile: "p1",
        profile_detail: baseRow.profile,
        standup_date: "2026-05-04",
        breakthrough_type: "Breakthrough" as const,
        priorities: "Ship release",
        collaboration_need: "",
        remarks: "",
        status: "Pending" as const,
        created_by_detail: null,
        approved_by_detail: null,
        approved_at: null,
        created_at: "",
        updated_at: "",
      },
    };
    render(
      <DailyStandupRow row={row} onSave={vi.fn()} onApprove={vi.fn()} />,
    );
    expect(screen.getByDisplayValue("Ship release")).toBeTruthy();
  });

  it("calls onApprove when Approve clicked on a pending row", () => {
    const onApprove = vi.fn();
    const row: OperationalStandupRosterRow = {
      ...baseRow,
      can_approve: true,
      entry: {
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
        created_at: "",
        updated_at: "",
      },
    };
    render(<DailyStandupRow row={row} onSave={vi.fn()} onApprove={onApprove} />);
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(onApprove).toHaveBeenCalledWith("e1");
  });
});
