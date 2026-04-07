import type { Task } from "@/types/task";
import { COLUMNS } from "@/constants";

export default function StatsBar({ tasks }: { tasks: Task[] }) {
  const total = tasks.length;
  const completed = tasks.filter((t: Task) =>
    ["Ontime", "Completed Delay", "Completed"].includes(t.status),
  ).length;
  const overdue = tasks.filter((t: Task) => t.status === "Overdue").length;
  const today = tasks.filter((t: Task) => t.status === "TodayTask").length;
  const tomorrow = tasks.filter((t: Task) => t.status === "Tomorrow").length;
  const pending = tasks.filter((t: Task) => t.status === "Pending").length;
  const pct = total ? Math.round((completed / total) * 100) : 0;

  const items = [
    { label: "Total", val: total, color: "#60a5fa" },
    { label: "Today", val: today, color: "#f59e0b" },
    { label: "Tomorrow", val: tomorrow, color: "#0891b2" },
    { label: "Pending", val: pending, color: "#d97706" },
    { label: "Overdue", val: overdue, color: "#ef4444" },
    { label: "Completed", val: completed, color: "#22c55e" },
    { label: `${pct}% done`, val: null, color: "#34d399" },
  ];

  return (
    <div className="stats-bar">
      {items.map((item) => (
        <div className="stat-item" key={item.label}>
          <span className="stat-dot" style={{ background: item.color }} />
          {item.val !== null && <span className="stat-val">{item.val}</span>}
          <span className="stat-lbl">{item.label}</span>
        </div>
      ))}

      {/* Per-column mini counts (excluding hidden columns) */}
      <div
        style={{
          marginLeft: "auto",
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        {COLUMNS.filter(
          (col) => col.id !== "Future Task/Goals" && col.id !== "Completed",
        ).map((col) => {
          const cnt = tasks.filter((t: Task) => t.status === col.id).length;
          return (
            <span
              key={col.id}
              style={{
                background: col.color,
                color: "#fff",
                borderRadius: 10,
                padding: "1px 7px",
                fontSize: 11,
                fontWeight: 600,
                opacity: cnt === 0 ? 0.45 : 1,
              }}
              title={col.title}
            >
              {cnt}
            </span>
          );
        })}
      </div>
    </div>
  );
}
