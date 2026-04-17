import { COLUMNS } from "@/utils/task";
import type { Task } from "@/types";

export interface StatusDistProps {
  tasks: Task[];
  onSelectStatus: (status: string) => void;
}

export default function StatusDist({ tasks, onSelectStatus }: StatusDistProps) {
  const total = tasks.length || 1;
  return (
    <div>
      {COLUMNS.map((col: { id: string; title: string; color: string }) => {
        const cnt = tasks.filter((t) => t.status === col.id).length;
        const pct = Math.round((cnt / total) * 100);
        return (
          <div
            key={col.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 6,
            }}
          >
            <button
              onClick={() => cnt > 0 && onSelectStatus(col.id)}
              style={{
                width: 120,
                fontSize: 11,
                color: cnt > 0 ? "#2563eb" : "#64748b",
                flexShrink: 0,
                background: "none",
                border: "none",
                padding: 0,
                textAlign: "left",
                cursor: cnt > 0 ? "pointer" : "default",
                fontWeight: cnt > 0 ? 600 : 400,
                textDecoration: cnt > 0 ? "underline" : "none",
              }}
            >
              {col.title}
            </button>
            <div
              style={{
                flex: 1,
                height: 8,
                background: "#e5e7eb",
                borderRadius: 4,
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: "100%",
                  background: col.color,
                  borderRadius: 4,
                }}
              />
            </div>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                minWidth: 24,
                textAlign: "right",
              }}
            >
              {cnt}
            </span>
          </div>
        );
      })}
    </div>
  );
}
