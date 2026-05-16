// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const getGcalStatusMock = vi.fn();
const getGcalAuthUrlMock = vi.fn();
const disconnectGcalMock = vi.fn();

vi.mock("@/lib/api/gcal", () => ({
  getGcalStatus: () => getGcalStatusMock(),
  getGcalAuthUrl: () => getGcalAuthUrlMock(),
  disconnectGcal: () => disconnectGcalMock(),
}));

import GoogleCalendarCard from "@/components/settings/GoogleCalendarCard";

beforeEach(() => {
  cleanup();
  getGcalStatusMock.mockReset();
  getGcalAuthUrlMock.mockReset();
  disconnectGcalMock.mockReset();
});

describe("GoogleCalendarCard", () => {
  it("renders the Connect button when not connected", async () => {
    getGcalStatusMock.mockResolvedValue({ connected: false });
    render(<GoogleCalendarCard />);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /connect google calendar/i }),
      ).toBeTruthy();
    });
  });

  it("renders the email + Disconnect button when connected", async () => {
    getGcalStatusMock.mockResolvedValue({
      connected: true,
      google_email: "alice@gmail.com",
      scopes: ["https://www.googleapis.com/auth/calendar.events"],
      connected_at: "2026-05-16T10:00:00Z",
      last_refreshed_at: null,
    });
    render(<GoogleCalendarCard />);
    await waitFor(() => {
      expect(screen.getByText(/alice@gmail.com/)).toBeTruthy();
    });
    expect(
      screen.getByRole("button", { name: /disconnect/i }),
    ).toBeTruthy();
  });

  it("Connect click hits the auth URL endpoint and navigates", async () => {
    getGcalStatusMock.mockResolvedValue({ connected: false });
    getGcalAuthUrlMock.mockResolvedValue({
      url: "https://accounts.google.com/o/oauth2/v2/auth?x=1",
    });

    const originalLocation = window.location;
    const setHref = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        set href(v: string) {
          setHref(v);
        },
      },
    });

    render(<GoogleCalendarCard />);
    await waitFor(() => screen.getByRole("button", { name: /connect/i }));
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));

    await waitFor(() => {
      expect(getGcalAuthUrlMock).toHaveBeenCalledTimes(1);
      expect(setHref).toHaveBeenCalledWith(
        "https://accounts.google.com/o/oauth2/v2/auth?x=1",
      );
    });

    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("Disconnect click calls the disconnect endpoint and re-fetches status", async () => {
    getGcalStatusMock
      .mockResolvedValueOnce({
        connected: true,
        google_email: "a@x.com",
        scopes: [],
        connected_at: "2026-05-16T10:00:00Z",
        last_refreshed_at: null,
      })
      .mockResolvedValueOnce({ connected: false });
    disconnectGcalMock.mockResolvedValue({ disconnected: true });

    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<GoogleCalendarCard />);
    await waitFor(() => screen.getByText(/a@x.com/));
    fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));

    await waitFor(() => {
      expect(disconnectGcalMock).toHaveBeenCalledTimes(1);
      expect(
        screen.getByRole("button", { name: /connect google calendar/i }),
      ).toBeTruthy();
    });
  });
});
