import { COLUMNS } from "@/utils/task";
import type { Task } from "@/types";

export interface StatsBarProps {
  tasks: Task[];
}

export default function StatsBar({ tasks }: StatsBarProps) {
  const total = tasks.length;
  const completed = tasks.filter((t) =>
    ["Ontime", "Completed Delay", "Completed"].includes(t.status),
  ).length;
  const overdue = tasks.filter((t) => t.status === "Overdue").length;
  const today = tasks.filter((t) => t.status === "TodayTask").length;
  const tomorrow = tasks.filter((t) => t.status === "Tomorrow").length;
  const pending = tasks.filter((t) => t.status === "Pending").length;
  const pct = total ? Math.round((completed / total) * 100) : 0;

  const items = [
    { label: "Total", val: total, bg: "#2563eb" },
    { label: "Today", val: today, bg: "#d97706" },
    { label: "Tomorrow", val: tomorrow, bg: "#0891b2" },
    { label: "Pending", val: pending, bg: "#7c3aed" },
    { label: "Overdue", val: overdue, bg: "#dc2626" },
    { label: "Done", val: completed, bg: "#15803d" },
    { label: `${pct}%`, val: null as number | null, bg: "#0d9488" },
  ];

  return (
    <div className="stats-bar-compact">
      {items.map((item) => (
        <span
          className="stat-chip"
          key={item.label}
          style={{ background: item.bg }}
        >
          {item.val !== null && <strong>{item.val}</strong>}
          {item.label}
        </span>
      ))}

      {/* Per-column mini counts */}
      <div className="stat-mini-counts">
        {COLUMNS.filter(
          (col: { id: string }) =>
            col.id !== "Future Task/Goals" && col.id !== "Completed",
        ).map((col: { id: string; color: string; title: string }) => {
          const cnt = tasks.filter((t) => t.status === col.id).length;
          return (
            <span
              key={col.id}
              style={{
                background: col.color,
                color: "#fff",
                borderRadius: 10,
                padding: "1px 7px",
                fontSize: 10,
                fontWeight: 600,
                opacity: cnt === 0 ? 0.35 : 1,
              }}
              title={col.title}
            >
              {cnt}
            </span>
          );
        })}
      </div>

      {/* Progress bar */}
      <div className="stat-progress">
        <div className="stat-progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
