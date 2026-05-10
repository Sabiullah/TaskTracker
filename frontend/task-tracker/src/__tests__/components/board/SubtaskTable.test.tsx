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
    const lockedDescInput = lockedRows[0].querySelector("textarea.subtask-textarea");
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

  it("sorts rows by Target date ascending when the Target header is clicked", () => {
    const subs: SubtaskItem[] = [
      { ...empty, description: "Mid", targetDate: "2026-06-01" },
      { ...empty, description: "Late", targetDate: "2026-07-01" },
      { ...empty, description: "Early", targetDate: "2026-05-01" },
    ];
    render(
      <SubtaskTable
        subs={subs}
        categories={[]}
        members={[]}
        mainTargetDate=""
        viewerName="Viewer"
        canManageAll
        onChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("columnheader", { name: /Target/i }));
    const bodyRows = screen.getAllByRole("row").slice(1); // drop header
    const descriptions = bodyRows.map((r) => {
      const ta = r.querySelector("textarea.subtask-textarea");
      return (ta as HTMLTextAreaElement | null)?.value ?? "";
    });
    expect(descriptions).toEqual(["Early", "Mid", "Late"]);
  });

  it("flips to descending on a second click of the same header", () => {
    const subs: SubtaskItem[] = [
      { ...empty, description: "B-row", responsible: "Bob" },
      { ...empty, description: "A-row", responsible: "Alice" },
      { ...empty, description: "C-row", responsible: "Carol" },
    ];
    render(
      <SubtaskTable
        subs={subs}
        categories={[]}
        members={["Alice", "Bob", "Carol"]}
        mainTargetDate=""
        viewerName="Viewer"
        canManageAll
        onChange={() => {}}
      />,
    );
    const ownerHeader = screen.getByRole("columnheader", { name: /Owner/i });
    fireEvent.click(ownerHeader); // asc
    fireEvent.click(ownerHeader); // desc
    const bodyRows = screen.getAllByRole("row").slice(1);
    const descriptions = bodyRows.map((r) => {
      const ta = r.querySelector("textarea.subtask-textarea");
      return (ta as HTMLTextAreaElement | null)?.value ?? "";
    });
    expect(descriptions).toEqual(["C-row", "B-row", "A-row"]);
  });

  it("keeps onChange aligned to the underlying row when editing a sorted view", () => {
    const onChange = vi.fn();
    const subs: SubtaskItem[] = [
      { ...empty, description: "Mid", targetDate: "2026-06-01" },
      { ...empty, description: "Late", targetDate: "2026-07-01" },
      { ...empty, description: "Early", targetDate: "2026-05-01" },
    ];
    render(
      <SubtaskTable
        subs={subs}
        categories={[]}
        members={[]}
        mainTargetDate=""
        viewerName="Viewer"
        canManageAll
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("columnheader", { name: /Target/i }));
    // Row order is now: Early (orig idx 2), Mid (0), Late (1)
    const firstRowDesc = screen
      .getAllByRole("row")[1]
      .querySelector("textarea.subtask-textarea") as HTMLTextAreaElement;
    fireEvent.change(firstRowDesc, { target: { value: "Early-edited" } });
    // Edit must land on the actual underlying index (2 = "Early"), not
    // index 0 in the displayed/sorted view.
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0][0] as SubtaskItem[];
    expect(next[2].description).toBe("Early-edited");
    expect(next[0].description).toBe("Mid");
    expect(next[1].description).toBe("Late");
  });

  it("sorts empty Target dates to the bottom in both directions", () => {
    const subs: SubtaskItem[] = [
      { ...empty, description: "Has-date", targetDate: "2026-06-01" },
      { ...empty, description: "Blank-1", targetDate: "" },
      { ...empty, description: "Earlier", targetDate: "2026-05-01" },
      { ...empty, description: "Blank-2", targetDate: "" },
    ];
    render(
      <SubtaskTable
        subs={subs}
        categories={[]}
        members={[]}
        mainTargetDate=""
        viewerName="Viewer"
        canManageAll
        onChange={() => {}}
      />,
    );
    const targetHeader = screen.getByRole("columnheader", { name: /Target/i });
    fireEvent.click(targetHeader); // asc
    let descriptions = screen
      .getAllByRole("row")
      .slice(1)
      .map((r) => (r.querySelector("textarea.subtask-textarea") as HTMLTextAreaElement | null)?.value ?? "");
    expect(descriptions).toEqual(["Earlier", "Has-date", "Blank-1", "Blank-2"]);
    fireEvent.click(targetHeader); // desc
    descriptions = screen
      .getAllByRole("row")
      .slice(1)
      .map((r) => (r.querySelector("textarea.subtask-textarea") as HTMLTextAreaElement | null)?.value ?? "");
    expect(descriptions).toEqual(["Has-date", "Earlier", "Blank-1", "Blank-2"]);
  });
});
