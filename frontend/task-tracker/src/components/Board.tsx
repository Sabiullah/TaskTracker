import { useState, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragStartEvent, DragEndEvent } from "@dnd-kit/core";
import Column from "./Column";
import TaskCard from "./TaskCard";
import { COLUMNS } from "@/constants";
import type { Task } from "@/types/task";
import type { BoardProps } from "@/types/components";

function formatMonthLabel(key: string) {
  const [y, m] = key.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
  });
}

// Columns to hide from the board view
const HIDDEN_COLS = new Set(["Future Task/Goals", "Completed"]);
const VISIBLE_COLUMNS = COLUMNS.filter((c) => !HIDDEN_COLS.has(c.id));

export default function Board({
  tasks,
  onEditTask,
  onDeleteTask,
  onMoveTask,
  onAddTask,
  selectedMonth,
  onMonthChange,
  availableMonths,
}: BoardProps) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [selectedYear, setSelectedYear] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const visibleTasks = tasks;

  // Extract unique years from available months
  const availableYears = [
    ...new Set((availableMonths || []).map((k: string) => k.split("-")[0])),
  ].sort();

  // Filter month pills by selected year
  const filteredMonths = selectedYear
    ? (availableMonths || []).filter((k: string) =>
        k.startsWith(selectedYear + "-"),
      )
    : availableMonths || [];

  // When year changes, clear month if it no longer belongs to new year
  const handleYearChange = (yr: string) => {
    setSelectedYear(yr);
    if (yr && selectedMonth && !selectedMonth.startsWith(yr + "-")) {
      onMonthChange("");
    }
  };

  const handleDragStart = useCallback(
    ({ active }: DragStartEvent) => {
      setActiveTask(visibleTasks.find((t: Task) => t.id === active.id) ?? null);
    },
    [visibleTasks],
  );

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      setActiveTask(null);
      if (!over || String(active.id) === String(over.id)) return;
      const overId = String(over.id);
      const isColumn = COLUMNS.some((c) => c.id === overId);
      const newStatus = isColumn
        ? overId
        : (visibleTasks.find((t: Task) => t.id === overId)?.status ?? null);
      if (newStatus) onMoveTask(String(active.id), newStatus);
    },
    [visibleTasks, onMoveTask],
  );

  const handleDragCancel = useCallback(() => setActiveTask(null), []);

  return (
    <>
      {/* ── Year filter bar ── */}
      <div
        className="month-filter-bar"
        style={{ borderBottom: "none", paddingBottom: 4 }}
      >
        <span className="month-filter-label">Year:</span>
        <button
          className={`month-pill${!selectedYear ? " active" : ""}`}
          onClick={() => handleYearChange("")}
        >
          All
        </button>
        {availableYears.map((yr: string) => (
          <button
            key={yr}
            className={`month-pill${selectedYear === yr ? " active" : ""}`}
            onClick={() => handleYearChange(selectedYear === yr ? "" : yr)}
          >
            {yr}
          </button>
        ))}
      </div>

      {/* ── Month filter bar ── */}
      <div className="month-filter-bar">
        <span className="month-filter-label">Month:</span>
        <button
          className={`month-pill${!selectedMonth ? " active" : ""}`}
          onClick={() => onMonthChange("")}
        >
          All
        </button>
        {filteredMonths.map((key: string) => (
          <button
            key={key}
            className={`month-pill${selectedMonth === key ? " active" : ""}`}
            onClick={() => onMonthChange(selectedMonth === key ? "" : key)}
          >
            {formatMonthLabel(key)}
          </button>
        ))}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="board">
          {VISIBLE_COLUMNS.map((col) => (
            <Column
              key={col.id}
              column={col}
              tasks={visibleTasks.filter((t: Task) => t.status === col.id)}
              onEditTask={onEditTask}
              onDeleteTask={onDeleteTask}
              onAddTask={onAddTask}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={{ duration: 180 }}>
          {activeTask ? (
            <TaskCard
              task={activeTask}
              statusColor={
                COLUMNS.find((c) => c.id === activeTask.status)?.color ||
                "#6b7280"
              }
              isOverlay
              onEdit={() => {}}
              onDelete={() => {}}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    </>
  );
}
