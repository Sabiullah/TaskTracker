// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RosterExcludePanel } from "@/components/pace/RosterExcludePanel";

beforeEach(() => {
  cleanup();
});

describe("RosterExcludePanel", () => {
  it("calls onToggle with member uid", () => {
    const onToggle = vi.fn();
    render(
      <RosterExcludePanel
        memberships={[
          { membership_uid: "m1", user_uid: "u1", user_name: "Alice", excluded: false },
          { membership_uid: "m2", user_uid: "u2", user_name: "Bob", excluded: true },
        ]}
        onToggle={onToggle}
      />,
    );
    // Open the panel first
    fireEvent.click(screen.getByRole("button", { name: /Roster settings/i }));
    fireEvent.click(screen.getByLabelText(/Alice/i));
    expect(onToggle).toHaveBeenCalledWith("m1", true);
  });
});
