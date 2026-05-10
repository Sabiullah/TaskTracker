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
  targetDate: "", expectedDate: "", completedDate: "", remarks: "",
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
        viewerName="Viewer"
        canManageAll
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
        viewerName="Viewer"
        canManageAll
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
        viewerName="Viewer"
        canManageAll
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(/cannot be after the main/i)).toBeTruthy();
  });

  it("locks rows allocated to someone else when viewer is not a manager", () => {
    const subs: SubtaskItem[] = [
      { ...empty, description: "Mine", responsible: "Me" },
      { ...empty, description: "Theirs", responsible: "Other" },
    ];
    const { container } = render(
      <SubtaskTable
        subs={subs}
        categories={[]}
        members={["Me", "Other"]}
        mainTargetDate=""
        viewerName="Me"
        canManageAll={false}
        onChange={() => {}}
      />,
    );
    const lockedRows = container.querySelectorAll("tr.sub-locked");
    expect(lockedRows.length).toBe(1);
    const lockedDescInput = lockedRows[0].querySelector("input[type=text]");
    expect(lockedDescInput?.hasAttribute("disabled")).toBe(true);
  });

  it("renders a Completed column header", () => {
    render(
      <SubtaskTable
        subs={[]}
        categories={[]}
        members={[]}
        mainTargetDate=""
        viewerName="Viewer"
        canManageAll
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("columnheader", { name: /Completed/i })).toBeTruthy();
  });

  it("renders inputs disabled and hides remove button when readOnly", () => {
    const SAMPLE: SubtaskItem = {
      id: "abc",
      description: "BRS",
      category: "BRS",
      responsible: "Alice",
      targetDate: "2026-05-05",
      expectedDate: "",
      completedDate: "",
      remarks: "",
    };
    const onChange = vi.fn();
    render(
      <SubtaskTable
        subs={[SAMPLE]}
        categories={["BRS"]}
        members={["Alice"]}
        mainTargetDate="2027-04-30"
        viewerName="Alice"
        canManageAll={true}
        onChange={onChange}
        readOnly={true}
      />,
    );
    const inputs = screen.getAllByRole("textbox");
    for (const i of inputs) expect((i as HTMLInputElement).disabled).toBe(true);
    const selects = screen.getAllByRole("combobox");
    for (const s of selects) expect((s as HTMLSelectElement).disabled).toBe(true);
    expect(screen.queryByLabelText("Remove")).toBeNull();
    expect(screen.queryByText("+ Add subtask")).toBeNull();
  });

  it("renders inputs enabled and shows add/remove when not readOnly", () => {
    const SAMPLE: SubtaskItem = {
      id: "abc",
      description: "BRS",
      category: "BRS",
      responsible: "Alice",
      targetDate: "2026-05-05",
      expectedDate: "",
      completedDate: "",
      remarks: "",
    };
    const onChange = vi.fn();
    render(
      <SubtaskTable
        subs={[SAMPLE]}
        categories={["BRS"]}
        members={["Alice"]}
        mainTargetDate="2027-04-30"
        viewerName="Alice"
        canManageAll={true}
        onChange={onChange}
      />,
    );
    expect(screen.getByText("+ Add subtask")).toBeTruthy();
    expect(screen.getByLabelText("Remove")).toBeTruthy();
  });
});
