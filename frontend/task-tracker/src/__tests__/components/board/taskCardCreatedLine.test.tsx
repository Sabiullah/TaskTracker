// @vitest-environment jsdom
// Pins the user-facing creation line on Board cards: "Created by <name> · <DD Mon>",
// and its graceful omission for legacy rows with no creator.
import { describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { DndContext } from "@dnd-kit/core";
import TaskCard from "@/components/board/TaskCard";
import type { Task } from "@/types";

const base: Task = {
  id: "t1",
  serialNo: 5,
  client: "Acme",
  category: "Audit",
  description: "GST filing",
  status: "TodayTask",
  targetDate: "2026-07-20",
  expectedDate: "",
  completedDate: "",
  responsible: "Bob",
  reportingManager: "Carol",
  remarks: "",
  recurrence: "Onetime",
  organization: "org1",
  createdBy: "u1",
  createdByName: "Aravindh",
  createdAt: "2026-07-18T15:42:00",
  parentId: null,
};

function renderCard(task: Task) {
  return render(
    <DndContext>
      <TaskCard task={task} onEdit={() => {}} onDelete={() => {}} />
    </DndContext>,
  );
}

afterEach(() => cleanup());

describe("TaskCard created line", () => {
  it("shows creator + date when present", () => {
    renderCard(base);
    expect(screen.getByText(/Created by Aravindh · 18 Jul/)).toBeTruthy();
  });

  it("omits the line when creator is missing", () => {
    renderCard({ ...base, createdByName: "" });
    expect(screen.queryByText(/Created by/)).toBeNull();
  });
});
