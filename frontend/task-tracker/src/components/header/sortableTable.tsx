import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { NavTab } from "@/types";

export interface SortableTabProps {
  tab: NavTab;
  isActive: boolean;
  onClick: () => void;
}

export function SortableTab({ tab, isActive, onClick }: SortableTabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };
  return (
    <button
      ref={setNodeRef}
      style={style}
      className={`nav-tab${isActive ? " active" : ""}${isDragging ? " dragging-tab" : ""}`}
      onClick={onClick}
      {...attributes}
      {...listeners}
    >
      {tab.icon}
      {tab.label}
    </button>
  );
}
