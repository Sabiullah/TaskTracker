import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { RECURRENCE_OPTIONS } from "@/utils/task";
import { avatarColor, initials as getInitials } from "@/utils/avatar";
import { fmtDate, fmtCreatedDate } from "@/utils/date";
import { dateStatus } from "@/utils/task";
import { taskDisplayDescription } from "@/utils/taskDescription";
import type { Task } from "@/types";

export interface TaskCardMainInfo {
  category: string;
  responsible: string;
}

export interface TaskCardProps {
  task: Task;
  mainInfo?: TaskCardMainInfo;
  statusColor?: string;
  onEdit: (task: Task) => void;
  onDelete: (id: string) => void;
  onViewLog?: (task: Task) => void;
  isOverlay?: boolean;
}

export default function TaskCard({
  task,
  mainInfo,
  statusColor,
  onEdit,
  onDelete,
  onViewLog,
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

  const style: React.CSSProperties & { "--card-accent"?: string } = {
    transform: CSS.Transform.toString(transform),
    transition,
    "--card-accent": statusColor || "transparent",
  };

  const ds = dateStatus(task.targetDate, task.status);
  const label = fmtDate(task.targetDate);
  const recOpt = RECURRENCE_OPTIONS.find(
    (r: { value: string }) => r.value === task.recurrence,
  );
  const color = avatarColor(task.responsible || "");
  const initials = task.responsible ? getInitials(task.responsible) : "?";
  const mainOwnerColor = mainInfo
    ? avatarColor(mainInfo.responsible || "")
    : "";
  const mainOwnerInitials = mainInfo?.responsible
    ? getInitials(mainInfo.responsible)
    : "";

  const cls = [
    "task-card",
    isDragging ? "dragging" : "",
    isOverlay ? "overlay" : "",
    ds === "overdue" ? "card-overdue" : "",
    ds === "today" ? "card-today" : "",
    ds === "due-soon" ? "card-due-soon" : "",
    ds === "ontime" ? "card-ontime" : "",
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
            {onViewLog && (
              <button
                className="card-btn"
                title="Edit Log"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onViewLog(task);
                }}
              >
                📋
              </button>
            )}
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

      {/* Main goal meta — shown on subtask cards so the umbrella goal is visible */}
      {mainInfo && (mainInfo.category || mainInfo.responsible) && (
        <div className="card-main-meta" title="Main goal">
          <span className="card-main-meta-arrow">↳</span>
          {mainInfo.category && (
            <span className="card-main-meta-cat">{mainInfo.category}</span>
          )}
          {mainInfo.responsible && (
            <span className="card-main-meta-owner">
              <span
                className="avatar avatar-mini"
                style={{ background: mainOwnerColor }}
                title={mainInfo.responsible}
              >
                {mainOwnerInitials}
              </span>
              <span className="card-main-meta-owner-name">
                {mainInfo.responsible}
              </span>
            </span>
          )}
        </div>
      )}

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
        {taskDisplayDescription(task) || "(no description)"}
      </p>

      {/* Footer: date + assignee */}
      <div className="card-footer">
        <div>
          {label && (
            <span
              className={`card-date ${ds}`}
              title={`Target: ${task.targetDate}`}
            >
              📅 {label}
            </span>
          )}
          {task.status === "Overdue" && task.expectedDate && (
            <span
              style={{
                display: "block",
                fontSize: 10,
                color: "#f59e0b",
                fontWeight: 600,
                marginTop: 2,
              }}
              title={`Expected: ${task.expectedDate}`}
            >
              🕐 {fmtDate(task.expectedDate)}
            </span>
          )}
        </div>
        <div className="card-assignee">
          <div
            className="avatar"
            style={{ background: color }}
            title={task.responsible}
          >
            {initials}
          </div>
          {!isOverlay && (
            <span className="avatar-name">{task.responsible}</span>
          )}
        </div>
      </div>

      {task.createdByName && task.createdAt && (
        <div
          style={{
            fontSize: 10,
            color: "var(--txt3)",
            marginTop: 4,
          }}
          title={`Created by ${task.createdByName}`}
        >
          Created by {task.createdByName} · {fmtCreatedDate(task.createdAt)}
        </div>
      )}

      {/* S.No badge */}
      {task.serialNo && (
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
          #{task.serialNo}
        </span>
      )}
    </div>
  );
}
