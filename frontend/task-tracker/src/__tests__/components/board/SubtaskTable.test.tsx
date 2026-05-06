// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  cleanup();
});

import SubtaskTable from "@/components/board/SubtaskTable";
import type { SubtaskItem } from "@/types";

const empty: SubtaskItem = {
  id: null, description: "", category: "", responsible: "",
  targetDate: "", expectedDate: "", remarks: "",
};

describe("SubtaskTable", () => {
  it("renders one row per sub and an Add button", () => {
    const subs: SubtaskItem[] = [
      { ...empty, description: "First" },
      { ...empty, description: "Second" },
    ];
    render(
      <SubtaskTable
        subs={subs}
        categories={[]}
        members={[]}
        mainTargetDate="2026-06-01"
        onChange={() => {}}
      />,
    );
    expect(screen.getAllByRole("row").length).toBeGreaterThanOrEqual(3); // header + 2
    expect(screen.getByText(/\+ Add subtask/i)).toBeTruthy();
  });

  it("calls onChange with appended row when Add is clicked", () => {
    const onChange = vi.fn();
    render(
      <SubtaskTable
        subs={[]}
        categories={[]}
        members={[]}
        mainTargetDate=""
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText(/\+ Add subtask/i));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ id: null })]);
  });

  it("flags a sub target date past the main target date", () => {
    const subs: SubtaskItem[] = [{ ...empty, description: "Late", targetDate: "2026-07-01" }];
    render(
      <SubtaskTable
        subs={subs}
        categories={[]}
        members={[]}
        mainTargetDate="2026-06-01"
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(/cannot be after the main/i)).toBeTruthy();
  });
});
