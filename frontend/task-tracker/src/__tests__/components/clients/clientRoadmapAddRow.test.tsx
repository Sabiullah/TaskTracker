// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ClientRoadmapAddRow from "@/components/clients/ClientRoadmapAddRow";
import type { MasterItem } from "@/types";
import type { Profile } from "@/types/auth";

afterEach(() => cleanup());

const clients: MasterItem[] = [
  { id: "c-1", name: "Acme", type: "client", org: null, orgs: [], color: null, is_active: true },
  { id: "c-2", name: "OldCo", type: "client", org: null, orgs: [], color: null, is_active: false },
];

const profiles: Profile[] = [
  { id: "u-1", full_name: "Sulthan Alavutheen" } as Profile,
];

function renderRow(onAdd = vi.fn().mockResolvedValue(undefined)) {
  render(
    <table>
      <tbody>
        <ClientRoadmapAddRow clients={clients} profiles={profiles} onAdd={onAdd} />
      </tbody>
    </table>,
  );
  return onAdd;
}

describe("ClientRoadmapAddRow", () => {
  it("disables Add until a client and a title are provided", () => {
    renderRow();
    const addBtn = screen.getByRole("button", { name: "Add" }) as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Client"), { target: { value: "c-1" } });
    expect(addBtn.disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText("New roadmap item…"), {
      target: { value: "Row level security" },
    });
    expect(addBtn.disabled).toBe(false);
  });

  it("hides inactive clients from the picker", () => {
    renderRow();
    const select = screen.getByLabelText("Client") as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toContain("Acme");
    expect(labels).not.toContain("OldCo");
  });

  it("calls onAdd with a trimmed title, the chosen client, and default priority", async () => {
    const onAdd = renderRow();
    fireEvent.change(screen.getByLabelText("Client"), { target: { value: "c-1" } });
    fireEvent.change(screen.getByPlaceholderText("New roadmap item…"), {
      target: { value: "  Vendor analysis  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ client: "c-1", title: "Vendor analysis", priority: "Medium" }),
    );
  });
});
