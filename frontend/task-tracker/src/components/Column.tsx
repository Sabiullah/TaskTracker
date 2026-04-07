import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import TaskCard from "./TaskCard";
import type { ColumnProps } from "@/types/components";

export default function Column({
  column,
  tasks,
  onEditTask,
  onDeleteTask,
  onAddTask,
}: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <div
      className={`column${isOver ? " drop-over" : ""}`}
      style={{ borderTopColor: column.color }}
    >
      {/* Header */}
      <div className="col-header">
        <div className="col-title">
          <span className="col-dot" style={{ background: column.color }} />
          <h3>{column.title}</h3>
        </div>
        <span className="col-count">{tasks.length}</span>
      </div>

      {/* Cards */}
      <SortableContext
        items={tasks.map((t) => t.id)}
        strategy={verticalListSortingStrategy}
      >
        <div ref={setNodeRef} className="col-cards">
          {tasks.length === 0 ? (
            <div className="col-empty">No tasks here</div>
          ) : (
            tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                statusColor={column.color}
                onEdit={onEditTask}
                onDelete={onDeleteTask}
                isOverlay={false}
              />
            ))
          )}
        </div>
      </SortableContext>

      {/* Add button */}
      <button className="col-add-btn" onClick={() => onAddTask(column.id)}>
        + Add a card
      </button>
    </div>
  );
}
