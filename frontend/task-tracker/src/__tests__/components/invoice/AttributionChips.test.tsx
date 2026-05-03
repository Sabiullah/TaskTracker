// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
