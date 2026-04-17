import { useState, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import Column from "./Column";
import TaskCard from "./TaskCard";
import { COLUMNS } from "@/utils/task";
import { formatMonthLabel } from "@/utils/date";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import type { Task, TaskStatus } from "@/types";

interface BoardProps {
  tasks: Task[];
  onEditTask: (task: Task) => void;
  onDeleteTask: (id: string) => void;
  onMoveTask: (id: string, newStatus: TaskStatus) => void;
  onAddTask: (defaultStatus?: TaskStatus) => void;
  onViewLog: (task: Task) => void;
  selectedMonth: string;
  onMonthChange: (month: string) => void;
  availableMonths: string[];
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
  onViewLog,
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
    ...new Set((availableMonths || []).map((k) => k.split("-")[0])),
  ].sort();

  // Filter month pills by selected year
  const filteredMonths = selectedYear
    ? (availableMonths || []).filter((k) => k.startsWith(selectedYear + "-"))
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
      setActiveTask(visibleTasks.find((t) => t.id === active.id) ?? null);
    },
    [visibleTasks],
  );

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      setActiveTask(null);
      if (!over || active.id === over.id) return;
      const overId = String(over.id);
      const isColumn = COLUMNS.some((c) => c.id === overId);
      const newStatus = isColumn
        ? overId
        : (visibleTasks.find((t) => t.id === overId)?.status ?? null);
      if (newStatus) onMoveTask(String(active.id), newStatus as TaskStatus);
    },
    [visibleTasks, onMoveTask],
  );

  const handleDragCancel = useCallback(() => setActiveTask(null), []);

  return (
    <>
      {/* ── Year + Month filter bar (combined) ── */}
      <div className="month-filter-bar">
        <span className="month-filter-label">Year:</span>
        <button
          className={`month-pill${!selectedYear ? " active" : ""}`}
          onClick={() => handleYearChange("")}
        >
          All
        </button>
        {availableYears.map((yr) => (
          <button
            key={yr}
            className={`month-pill${selectedYear === yr ? " active" : ""}`}
            onClick={() => handleYearChange(selectedYear === yr ? "" : yr)}
          >
            {yr}
          </button>
        ))}
        <span
          style={{
            width: 1,
            height: 18,
            background: "var(--border)",
            margin: "0 6px",
            flexShrink: 0,
          }}
        />
        <span className="month-filter-label">Month:</span>
        <button
          className={`month-pill${!selectedMonth ? " active" : ""}`}
          onClick={() => onMonthChange("")}
        >
          All
        </button>
        {filteredMonths.map((key) => (
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
              tasks={visibleTasks.filter((t) => t.status === col.id)}
              onEditTask={onEditTask}
              onDeleteTask={onDeleteTask}
              onAddTask={(columnId: string) => onAddTask(columnId as TaskStatus)}
              onViewLog={onViewLog}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={{ duration: 180 }}>
          {activeTask ? (
            <TaskCard
              task={activeTask}
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
