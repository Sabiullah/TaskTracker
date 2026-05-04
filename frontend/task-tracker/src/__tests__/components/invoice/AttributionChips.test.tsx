// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import AttributionChips from "@/components/invoice/AttributionChips";

describe("AttributionChips", () => {
  const options = [
    { id: "u1", label: "Audit" },
    { id: "u2", label: "Tax" },
  ];

  it("shows green check at 100%", () => {
    render(
      <AttributionChips
        options={options}
        value={[
          { id: "u1", label: "Audit", contribution_pct: 60 },
          { id: "u2", label: "Tax", contribution_pct: 40 },
        ]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(/✓.*100/)).toBeTruthy();
  });

  it("shows red warning when not 100%", () => {
    render(
      <AttributionChips
        options={options}
        value={[{ id: "u1", label: "Audit", contribution_pct: 50 }]}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(/must equal 100/i)).toBeTruthy();
  });

  it("treats empty list as valid", () => {
    render(
      <AttributionChips options={options} value={[]} onChange={() => {}} />,
    );
    expect(
      screen.getByText(/no.*— entries will be unattributed/i),
    ).toBeTruthy();
  });

  it("calls onCreate and adds chip when '+ Create' is clicked", async () => {
    const onChange = vi.fn();
    const onCreate = vi.fn(async (name: string) => ({
      id: `new-${name}`,
      label: name,
      color: "#abcdef",
    }));
    render(
      <AttributionChips
        options={[]}
        value={[]}
        onChange={onChange}
        onCreate={onCreate}
        placeholder="Type to add"
      />,
    );
    const input = screen.getByPlaceholderText("Type to add");
    fireEvent.change(input, { target: { value: "Audit" } });
    const createBtn = await screen.findByText(/\+ Create "Audit"/);
    fireEvent.click(createBtn);
    await new Promise((r) => setTimeout(r, 0));
    expect(onCreate).toHaveBeenCalledWith("Audit");
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "new-Audit",
        label: "Audit",
        contribution_pct: 100,
      }),
    ]);
  });

  it("does not show + Create when onCreate is not provided", () => {
    render(
      <AttributionChips
        options={[]}
        value={[]}
        onChange={() => {}}
        placeholder="x"
      />,
    );
    const input = screen.getByPlaceholderText("x");
    fireEvent.change(input, { target: { value: "Audit" } });
    expect(screen.queryByText(/\+ Create/)).toBeNull();
  });
});
