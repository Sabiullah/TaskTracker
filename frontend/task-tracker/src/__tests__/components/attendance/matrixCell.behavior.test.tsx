// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import MatrixCell from "@/components/attendance/MatrixCell";

describe("MatrixCell — admin click-to-edit picker", () => {
  it("opens the status picker when admin clicks an HD cell", () => {
    cleanup();
    const onStatusChange = vi.fn();
    render(
      <MatrixCell
        date="2026-05-10"
        payload={{ code: "HD", holiday_name: "Sunday" }}
        editable={true}
        onStatusChange={onStatusChange}
      />,
    );
    // HD cell exists
    expect(screen.getByText("HD")).toBeTruthy();
    fireEvent.click(screen.getByText("HD"));
    // Picker now shows all 5 status options including Holiday
    expect(screen.getByText("Present")).toBeTruthy();
    expect(screen.getByText("Half Day")).toBeTruthy();
    expect(screen.getByText("Absent")).toBeTruthy();
    expect(screen.getByText("Leave")).toBeTruthy();
    expect(screen.getByText("Holiday")).toBeTruthy();
    // Choosing one fires onStatusChange with the right status string
    fireEvent.click(screen.getByText("Present"));
    expect(onStatusChange).toHaveBeenCalledWith("Present");
  });

  it("emits onStatusChange('Holiday') when admin picks Holiday", () => {
    cleanup();
    const onStatusChange = vi.fn();
    render(
      <MatrixCell
        date="2026-05-24"
        payload={{ code: "P" }}
        editable={true}
        onStatusChange={onStatusChange}
      />,
    );
    fireEvent.click(screen.getByText("P"));
    expect(screen.getByText("Holiday")).toBeTruthy();
    fireEvent.click(screen.getByText("Holiday"));
    expect(onStatusChange).toHaveBeenCalledWith("Holiday");
  });

  it("does NOT open the picker when admin clicks an open-punch ('?') cell", () => {
    cleanup();
    const onStatusChange = vi.fn();
    render(
      <MatrixCell
        date="2026-05-10"
        payload={{ code: "?" }}
        editable={true}
        onStatusChange={onStatusChange}
      />,
    );
    fireEvent.click(screen.getByText("?"));
    expect(screen.queryByText("Present")).toBeNull();
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("does NOT show the picker for non-admin viewers", () => {
    cleanup();
    render(
      <MatrixCell
        date="2026-05-10"
        payload={{ code: "HD", holiday_name: "Sunday" }}
        editable={false}
      />,
    );
    fireEvent.click(screen.getByText("HD"));
    expect(screen.queryByText("Present")).toBeNull();
  });
});
