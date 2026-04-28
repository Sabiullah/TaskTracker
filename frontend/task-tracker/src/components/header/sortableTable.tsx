import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { NavTab } from "@/types";

export interface SortableTabProps {
  tab: NavTab;
  isActive: boolean;
  onClick: () => void;
  badge?: number;
}

const pillStyle: React.CSSProperties = {
  marginLeft: 6,
  padding: "1px 7px",
  background: "#dc2626",
  color: "#fff",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1.4,
};

export function SortableTab({ tab, isActive, onClick, badge }: SortableTabProps) {
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
  const showBadge = typeof badge === "number" && badge > 0;
  return (
    <button
      ref={setNodeRef}
      type="button"
      style={style}
      className={`nav-tab${isActive ? " active" : ""}${isDragging ? " dragging-tab" : ""}`}
      onClick={onClick}
      {...attributes}
      {...listeners}
    >
      {tab.icon}
      {tab.label}
      {showBadge && (
        <span aria-label={`${badge} overdue or pending items`} style={pillStyle}>
          {badge}
        </span>
      )}
    </button>
  );
}
