// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

let confirmSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  cleanup();
  mastersListing = makeMastersListing();
  patchCalls.length = 0;
  confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
});

const makeMastersListing = () => [
  {
    id: 1,
    uid: "active-1",
    name: "Acme",
    type: "client" as const,
    color: "",
    is_active: true,
    sort_order: 0,
    org: null,
    org_uid: null,
    orgs: [],
    parent: null,
    recurrence: "" as const,
    target_day: null,
    created_by_uid: null,
    created_at: "",
    updated_at: "",
  },
  {
    id: 2,
    uid: "inactive-1",
    name: "OldCo",
    type: "client" as const,
    color: "",
    is_active: false,
    sort_order: 0,
    org: null,
    org_uid: null,
    orgs: [],
    parent: null,
    recurrence: "" as const,
    target_day: null,
    created_by_uid: null,
    created_at: "",
    updated_at: "",
  },
];

let mastersListing = makeMastersListing();

const patchCalls: Array<{ url: string; body: unknown }> = [];

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    apiGet: vi.fn(async (url: string) => {
      if (url === "/masters/") return mastersListing;
      if (url === "/orgs/") return [];
      return [];
    }),
    apiPatch: vi.fn(async (url: string, body: unknown) => {
      patchCalls.push({ url, body });
      const uid = url.split("/").filter(Boolean).pop();
      const row = mastersListing.find((m) => m.uid === uid);
      if (!row) throw new Error("not found");
      const next = { ...row, ...(body as object) };
      Object.assign(row, next);
      return next;
    }),
    apiPost: vi.fn(),
    apiDelete: vi.fn(),
    ws: { subscribe: () => () => undefined },
  };
});

vi.mock("@/hooks/useAuth", () => {
  const adminOrg = { uid: "o1", role: "admin", menu_rights: {} };
  return {
    useAuth: () => ({
      isAdminInAny: () => true,
      orgs: [adminOrg],
      defaultOrg: adminOrg,
    }),
  };
});

vi.mock("@/hooks/useOrgs", () => ({
  useOrgs: () => ({
    orgs: [],
    loading: false,
    saving: false,
    saveOrg: vi.fn(),
    deleteOrg: vi.fn(),
  }),
}));

import MastersPage from "@/pages/MastersPage";

describe("MastersPage clients tab — activate/deactivate", () => {
  it("renders an Active pill for active clients and Inactive for inactive ones", async () => {
    render(<MastersPage profile={null} profiles={[]} />);
    await waitFor(() => screen.getByText(/🏢 Clients/));
    fireEvent.click(screen.getByText(/🏢 Clients/));
    await waitFor(() => screen.getByText("Acme"));
    expect(screen.getByText("Acme")).toBeTruthy();
    expect(screen.getByText("OldCo")).toBeTruthy();
    const activePills = screen.getAllByRole("button", { name: /^Active$/ });
    expect(activePills.length).toBe(1);
    const inactivePills = screen.getAllByRole("button", { name: /^Inactive$/ });
    expect(inactivePills.length).toBe(1);
  });

  it("sorts active clients first, then inactive, alphabetical within each", async () => {
    render(<MastersPage profile={null} profiles={[]} />);
    fireEvent.click(screen.getByText(/🏢 Clients/));
    await waitFor(() => screen.getByText("Acme"));
    const cards = document.querySelectorAll(".dm-item-card");
    const names = Array.from(cards).map((c) => c.querySelector("span")?.textContent ?? "");
    expect(names[0]).toContain("Acme");
    expect(names[1]).toContain("OldCo");
  });

  it("clicking Active prompts confirm then PATCHes is_active=false", async () => {
    patchCalls.length = 0;
    render(<MastersPage profile={null} profiles={[]} />);
    fireEvent.click(screen.getByText(/🏢 Clients/));
    await waitFor(() => screen.getByText("Acme"));
    fireEvent.click(screen.getByRole("button", { name: /^Active$/ }));
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(patchCalls).toHaveLength(1));
    expect(patchCalls[0]).toEqual({
      url: "/masters/active-1/",
      body: { is_active: false },
    });
  });

  it("clicking Inactive reactivates without a confirm", async () => {
    patchCalls.length = 0;
    confirmSpy.mockClear();
    render(<MastersPage profile={null} profiles={[]} />);
    fireEvent.click(screen.getByText(/🏢 Clients/));
    await waitFor(() => screen.getByText("OldCo"));
    fireEvent.click(screen.getByRole("button", { name: /^Inactive$/ }));
    expect(confirmSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(patchCalls).toHaveLength(1));
    expect(patchCalls[0]).toEqual({
      url: "/masters/inactive-1/",
      body: { is_active: true },
    });
  });
});
