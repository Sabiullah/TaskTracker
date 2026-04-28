// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { SortableTab } from "@/components/header/sortableTable";

function wrap(children: React.ReactNode) {
  return (
    <DndContext>
      <SortableContext items={["t"]}>{children}</SortableContext>
    </DndContext>
  );
}

describe("SortableTab badge", () => {
  it("does not render a pill when badge is undefined", () => {
    render(
      wrap(
        <SortableTab
          tab={{ id: "t", label: "Tab", icon: null }}
          isActive={false}
          onClick={() => {}}
        />,
      ),
    );
    expect(screen.queryByLabelText(/overdue/i)).toBeNull();
  });

  it("does not render a pill when badge is 0", () => {
    render(
      wrap(
        <SortableTab
          tab={{ id: "t", label: "Tab", icon: null }}
          isActive={false}
          onClick={() => {}}
          badge={0}
        />,
      ),
    );
    expect(screen.queryByLabelText(/overdue/i)).toBeNull();
  });

  it("renders the badge count when > 0 with an aria-label", () => {
    render(
      wrap(
        <SortableTab
          tab={{ id: "t", label: "Tab", icon: null }}
          isActive={false}
          onClick={() => {}}
          badge={3}
        />,
      ),
    );
    const pill = screen.getByLabelText("3 overdue or pending items");
    expect(pill.textContent).toBe("3");
  });
});
