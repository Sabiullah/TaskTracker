// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DailyStandupAddModal } from "@/components/pace/DailyStandupAddModal";

beforeEach(() => {
  cleanup();
});

describe("DailyStandupAddModal", () => {
  it("submits payload with selected employee and date", () => {
    const onSubmit = vi.fn(async () => {});
    const profiles = [{ uid: "p1", full_name: "Alice" }];
    render(
      <DailyStandupAddModal
        date="2026-05-04"
        profiles={profiles}
        onSubmit={onSubmit}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/employee/i), { target: { value: "p1" } });
    fireEvent.change(screen.getByLabelText(/priorities/i), { target: { value: "Ship it" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      profile: "p1",
      standup_date: "2026-05-04",
      priorities: "Ship it",
    }));
  });
});
