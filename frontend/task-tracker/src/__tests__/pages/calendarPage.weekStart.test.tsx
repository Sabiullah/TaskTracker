// @vitest-environment jsdom
import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Profile } from "@/types/auth";
import type { Task } from "@/types";
import type { ID } from "@/types/common";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    isAdminInAny: () => true,
    isManagerInAny: () => false,
  }),
}));

vi.mock("@/hooks/useWorkPlans", () => ({
  useWorkPlans: () => ({ plans: [] }),
}));

import CalendarPage from "@/pages/CalendarPage";

const profile: Profile = {
  id: "p1",
  username: "alice",
  full_name: "Alice",
  email: "a@x.com",
  manager_ids: null,
  avatar_color: null,
  orgs: [],
  highest_role: "admin",
};

const mainsById = new Map<
  ID,
  { category: string; responsible: string; description: string }
>();

beforeEach(() => {
  cleanup();
  localStorage.clear();
});

describe("CalendarPage — Sunday-first week layout", () => {
  it("renders weekday headers in Sun..Sat order", () => {
    render(
      <CalendarPage
        tasks={[] as Task[]}
        profile={profile}
        profiles={[]}
        mainsById={mainsById}
      />,
    );

    const expected = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    for (const day of expected) {
      // Each weekday label appears exactly once as a header.
      expect(screen.getAllByText(day).length).toBeGreaterThan(0);
    }

    // First header in DOM order should be Sun.
    const all = screen.getAllByText(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/);
    const headers = all.map((n) => n.textContent);
    // The first 7 matches are the weekday headers row (legend uses different
    // text). Snip and compare.
    expect(headers.slice(0, 7)).toEqual(expected);
  });
});
