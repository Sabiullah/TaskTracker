import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AVATAR_COLORS, RECURRENCE_OPTIONS } from "@/constants";
import type { TaskCardProps } from "@/types/components";

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

function dateStatus(dateStr: string | null | undefined, status: string) {
  if (!dateStr) return "";
  if (["Completed", "Completed Delay"].includes(status)) return "";
  const d = new Date(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  const diff = (d.getTime() - now.getTime()) / 86400000;
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff <= 3) return "due-soon";
  return "";
}

export default function TaskCard({
  task,
  statusColor,
  onEdit,
  onDelete,
  isOverlay,
}: TaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    borderLeftColor: statusColor || "#dfe1e6",
  };

  const ds = dateStatus(task.target_date, task.status);
  const label = formatDate(task.target_date);
  const recOpt = RECURRENCE_OPTIONS.find((r) => r.value === task.recurrence);
  const avatarColor = AVATAR_COLORS[task.responsible] || "#64748b";
  const initials = task.responsible
    ? task.responsible
        .split(" ")
        .map((w: string) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "?";

  const cls = [
    "task-card",
    isDragging ? "dragging" : "",
    isOverlay ? "overlay" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cls}
      {...attributes}
      {...listeners}
    >
      {/* Top row: tags + action buttons */}
      <div className="card-top">
        <div className="card-tags">
          {task.client && <span className="tag tag-client">{task.client}</span>}
          {task.category && (
            <span className="tag tag-category">{task.category}</span>
          )}
          {recOpt && recOpt.value !== "Onetime" && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                padding: "1px 5px",
                borderRadius: 3,
                background: recOpt.color + "18",
                color: recOpt.color,
                border: `1px solid ${recOpt.color}44`,
              }}
            >
              ⟳ {recOpt.label}
            </span>
          )}
        </div>
        {!isOverlay && (
          <div className="card-actions">
            <button
              className="card-btn"
              title="Edit"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onEdit(task);
              }}
            >
              ✎
            </button>
            <button
              className="card-btn del"
              title="Delete"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(task.id);
              }}
            >
              🗑
            </button>
          </div>
        )}
      </div>

      {/* Description */}
      <p
        className="card-desc"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          if (!isOverlay) {
            e.stopPropagation();
            onEdit(task);
          }
        }}
      >
        {task.description || "(no description)"}
      </p>

      {/* Footer: date + assignee */}
      <div className="card-footer">
        <div>
          {label && (
            <span
              className={`card-date ${ds}`}
              title={`Target: ${task.target_date}`}
            >
              📅 {label}
            </span>
          )}
        </div>
        <div className="card-assignee">
          <div
            className="avatar"
            style={{ background: avatarColor }}
            title={task.responsible}
          >
            {initials}
          </div>
          {!isOverlay && (
            <span className="avatar-name">{task.responsible}</span>
          )}
        </div>
      </div>

      {/* S.No badge */}
      {task.s_no && (
        <span
          style={{
            position: "absolute",
            top: 7,
            right: isOverlay ? 8 : 60,
            fontSize: 9,
            color: "var(--txt3)",
            fontWeight: 600,
          }}
        >
          #{task.s_no}
        </span>
      )}
    </div>
  );
}
